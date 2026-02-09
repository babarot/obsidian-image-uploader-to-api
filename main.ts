import { Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, App, Setting, requestUrl } from "obsidian";

interface HeaderEntry {
	key: string;
	value: string;
}

type PdfHandling = "default" | "upload" | "ask";

interface ImageUploaderSettings {
	apiEndpoint: string;
	headers: HeaderEntry[];
	fileFieldName: string;
	imageUrlPath: string;
	pdfHandling: PdfHandling;
}

const DEFAULT_SETTINGS: ImageUploaderSettings = {
	apiEndpoint: "",
	headers: [],
	fileFieldName: "file",
	imageUrlPath: "",
	pdfHandling: "default",
};

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "ico"];

function isPdfFile(file: File): boolean {
	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	return ext === "pdf";
}

function isImageFile(file: File): boolean {
	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTENSIONS.includes(ext);
}

class PdfUploadModal extends Modal {
	private resolve: (value: boolean) => void;

	constructor(app: App, resolve: (value: boolean) => void) {
		super(app);
		this.resolve = resolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("p", { text: "How do you want to handle this PDF?" });

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		buttonContainer
			.createEl("button", { text: "Upload to API", cls: "mod-cta" })
			.addEventListener("click", () => {
				this.resolve(true);
				this.close();
			});

		buttonContainer
			.createEl("button", { text: "Save locally" })
			.addEventListener("click", () => {
				this.resolve(false);
				this.close();
			});
	}

	onClose() {
		this.resolve(false);
		this.contentEl.empty();
	}
}

function getByPath(obj: unknown, path: string): unknown {
	const keys = path.split(".");
	let current: unknown = obj;
	for (const key of keys) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

export default class ImageUploaderPlugin extends Plugin {
	settings: ImageUploaderSettings = DEFAULT_SETTINGS;

	private shouldIntercept = (file: File): boolean => {
		if (isImageFile(file)) return true;
		if (isPdfFile(file) && this.settings.pdfHandling !== "default") return true;
		return false;
	};

	private askPdfUpload(): Promise<boolean> {
		return new Promise((resolve) => {
			new PdfUploadModal(this.app, resolve).open();
		});
	}

	private async savePdfLocally(file: File, editor: Editor) {
		const arrayBuffer = await file.arrayBuffer();
		const activeFile = this.app.workspace.getActiveFile();
		const path = await this.app.fileManager.getAvailablePathForAttachment(file.name, activeFile?.path);
		const created = await this.app.vault.createBinary(path, arrayBuffer);
		editor.replaceSelection(`![[${created.name}]]`);
	}

	private handleFiles(evt: Event, fileList: FileList | undefined | null): void {
		if (!fileList || fileList.length === 0) return;

		const allFiles = Array.from(fileList);
		const intercepted = allFiles.filter(this.shouldIntercept);
		if (intercepted.length === 0) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		evt.preventDefault();
		evt.stopPropagation();

		const images = intercepted.filter(isImageFile);
		const pdfs = intercepted.filter(isPdfFile);

		void (async () => {
			if (images.length > 0) {
				await this.uploadFiles(images, view.editor);
			}
			for (const pdf of pdfs) {
				let shouldUpload = this.settings.pdfHandling === "upload";
				if (this.settings.pdfHandling === "ask") {
					shouldUpload = await this.askPdfUpload();
				}
				if (shouldUpload) {
					await this.uploadFile(pdf, view.editor);
				} else {
					await this.savePdfLocally(pdf, view.editor);
				}
			}
		})();
	}

	private dropHandler = (evt: DragEvent): void => {
		this.handleFiles(evt, evt.dataTransfer?.files);
	};

	private pasteHandler = (evt: ClipboardEvent): void => {
		this.handleFiles(evt, evt.clipboardData?.files);
	};

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ImageUploaderSettingTab(this.app, this));

		this.registerDomEvent(document, "drop", this.dropHandler, true);
		this.registerDomEvent(document, "paste", this.pasteHandler, true);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async uploadFiles(files: File[], editor: Editor) {
		for (const file of files) {
			await this.uploadFile(file, editor);
		}
	}

	private async uploadFile(file: File, editor: Editor) {
		const placeholder = `![Uploading ${file.name}...]()`;
		editor.replaceSelection(placeholder);

		try {
			const url = await this.upload(file);
			const content = editor.getValue();
			const markdown = isImageFile(file) ? `![](${url})` : `[${file.name}](${url})`;
			const newContent = content.replace(placeholder, markdown);
			editor.setValue(newContent);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Image upload failed: ${message}`);

			const content = editor.getValue();
			editor.setValue(content.replace(placeholder, ""));
		}
	}

	private async upload(file: File): Promise<string> {
		const arrayBuffer = await file.arrayBuffer();

		const headers: Record<string, string> = {};
		for (const entry of this.settings.headers) {
			if (entry.key.trim()) {
				headers[entry.key.trim()] = entry.value;
			}
		}

		const fieldName = this.settings.fileFieldName.trim() || "file";

		const boundary = "----ObsidianUploader" + Date.now().toString(36);
		const encoder = new TextEncoder();

		const partHeader = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${file.name}"\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`;
		const partFooter = `\r\n--${boundary}--\r\n`;

		const headerBytes = encoder.encode(partHeader);
		const footerBytes = encoder.encode(partFooter);
		const fileBytes = new Uint8Array(arrayBuffer);

		const body = new Uint8Array(headerBytes.length + fileBytes.length + footerBytes.length);
		body.set(headerBytes, 0);
		body.set(fileBytes, headerBytes.length);
		body.set(footerBytes, headerBytes.length + fileBytes.length);

		headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;

		const response = await requestUrl({
			url: this.settings.apiEndpoint,
			method: "POST",
			headers,
			body: body.buffer,
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Server responded with status ${response.status}`);
		}

		const data = response.json;
		const url = getByPath(data, this.settings.imageUrlPath);
		if (!url || typeof url !== "string") {
			throw new Error(`Could not extract URL from response using path "${this.settings.imageUrlPath}"`);
		}

		return url;
	}
}

class ImageUploaderSettingTab extends PluginSettingTab {
	plugin: ImageUploaderPlugin;

	constructor(app: App, plugin: ImageUploaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Upload API settings")
			.setHeading();

		new Setting(containerEl)
			.setName("API endpoint")
			.setDesc("The URL of the upload API")
			.addText((text) =>
				text
					.setPlaceholder("https://example.com/api/upload")
					.setValue(this.plugin.settings.apiEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.apiEndpoint = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("File field name")
			.setDesc("The form field name for the uploaded file (e.g. file, image)")
			.addText((text) =>
				text
					.setPlaceholder("file")
					.setValue(this.plugin.settings.fileFieldName)
					.onChange(async (value) => {
						this.plugin.settings.fileFieldName = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Image URL path")
			.setDesc(createFragment((el) => {
				el.appendText("Dot-notation path to extract the image URL from the JSON response, e.g. ");
				el.createEl("code", { text: "url" });
				el.appendText(", ");
				el.createEl("code", { text: "data.link" });
				el.appendText(", ");
				el.createEl("code", { text: "response.data.url" });
			}))
			.addText((text) =>
				text
					.setPlaceholder("url")
					.setValue(this.plugin.settings.imageUrlPath)
					.onChange(async (value) => {
						this.plugin.settings.imageUrlPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("PDF handling")
			.setDesc("Choose how PDF files are handled when dropped or pasted.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("default", "Save locally (default)")
					.addOption("upload", "Always upload to API")
					.addOption("ask", "Ask each time")
					.setValue(this.plugin.settings.pdfHandling)
					.onChange(async (value) => {
						this.plugin.settings.pdfHandling = value as PdfHandling;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("HTTP headers")
			.setHeading();

		for (let i = 0; i < this.plugin.settings.headers.length; i++) {
			const entry = this.plugin.settings.headers[i];
			const setting = new Setting(containerEl)
				.setName(`Header ${i + 1}`);

			setting.addText((text) =>
				text
					.setPlaceholder("Header name")
					.setValue(entry.key)
					.onChange(async (value) => {
						this.plugin.settings.headers[i].key = value;
						await this.plugin.saveSettings();
					})
			);

			setting.addText((text) =>
				text
					.setPlaceholder("Value")
					.setValue(entry.value)
					.onChange(async (value) => {
						this.plugin.settings.headers[i].value = value;
						await this.plugin.saveSettings();
					})
			);

			setting.addExtraButton((btn) =>
				btn
					.setIcon("trash")
					.setTooltip("Remove")
					.onClick(async () => {
						this.plugin.settings.headers.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
			);
		}

		new Setting(containerEl)
			.addButton((btn) =>
				btn
					.setButtonText("Add header")
					.setCta()
					.onClick(async () => {
						this.plugin.settings.headers.push({ key: "", value: "" });
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}
}
