import { Editor, MarkdownView, Notice, Plugin, PluginSettingTab, App, Setting, requestUrl } from "obsidian";

interface HeaderEntry {
	key: string;
	value: string;
}

interface ImageUploaderSettings {
	apiEndpoint: string;
	headers: HeaderEntry[];
	fileFieldName: string;
	imageUrlPath: string;
}

const DEFAULT_SETTINGS: ImageUploaderSettings = {
	apiEndpoint: "",
	headers: [],
	fileFieldName: "file",
	imageUrlPath: "",
};

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "ico"];

function isImageFile(file: File): boolean {
	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTENSIONS.includes(ext);
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

	private dropHandler = (evt: DragEvent): void => {
		const files = evt.dataTransfer?.files;
		if (!files || files.length === 0) return;

		const imageFiles = Array.from(files).filter(isImageFile);
		if (imageFiles.length === 0) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		evt.preventDefault();
		evt.stopPropagation();

		this.uploadFiles(imageFiles, view.editor);
	};

	private pasteHandler = (evt: ClipboardEvent): void => {
		const files = evt.clipboardData?.files;
		if (!files || files.length === 0) return;

		const imageFiles = Array.from(files).filter(isImageFile);
		if (imageFiles.length === 0) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		evt.preventDefault();
		evt.stopPropagation();

		this.uploadFiles(imageFiles, view.editor);
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

	private uploadFiles(files: File[], editor: Editor) {
		for (const file of files) {
			this.uploadFile(file, editor);
		}
	}

	private async uploadFile(file: File, editor: Editor) {
		const placeholder = `![Uploading ${file.name}...]()`;
		editor.replaceSelection(placeholder);

		try {
			const url = await this.upload(file);
			const content = editor.getValue();
			const newContent = content.replace(placeholder, `![](${url})`);
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

		containerEl.createEl("h2", { text: "Upload API Settings" });

		new Setting(containerEl)
			.setName("API Endpoint")
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
			.setName("File Field Name")
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
			.setName("Image URL Path")
			.setDesc(createFragment((el) => {
				el.appendText("Dot-notation path to extract the image URL from the JSON response");
				el.createEl("br");
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

		// Headers section
		containerEl.createEl("h2", { text: "HTTP Headers" });

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
					.setButtonText("Add Header")
					.setCta()
					.onClick(async () => {
						this.plugin.settings.headers.push({ key: "", value: "" });
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}
}
