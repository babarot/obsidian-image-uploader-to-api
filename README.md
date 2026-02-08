# Image Uploader to API

An [Obsidian](https://obsidian.md) plugin that uploads images to any API endpoint when you drag & drop or paste them, and inserts the public URL as Markdown.

## Features

- **Drag & Drop** — Drop images into the editor to upload automatically
- **Paste** — Paste images from clipboard (Cmd/Ctrl+V) to upload
- **Any API** — Works with any image hosting API (custom server, Imgur, Cloudflare Images, etc.)
- **Configurable Headers** — Add any HTTP headers (API keys, auth tokens, etc.)
- **Configurable Response Parsing** — Extract the image URL from any JSON response structure using dot-notation
- **Multiple Images** — Upload multiple images at once in parallel
- **Upload Indicator** — Shows `![Uploading...]()` placeholder while uploading

## Supported Formats

`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.avif`, `.ico`

Non-image files are left to Obsidian's default behavior.

## Settings

| Setting | Description |
|---|---|
| **API Endpoint** | The URL to POST the image to |
| **File Field Name** | The `multipart/form-data` field name for the file (e.g. `file`, `image`) |
| **Image URL Path** | Dot-notation path to extract the URL from the JSON response (e.g. `url`, `data.link`) |
| **HTTP Headers** | Key-value pairs sent with the request (e.g. `X-API-Key`, `Authorization`) |

## Examples

### Custom Upload API

| Setting | Value |
|---|---|
| API Endpoint | `https://example.com/api/upload` |
| File Field Name | `file` |
| Image URL Path | `url` |
| Headers | `X-API-Key` = `your-api-key` |

Response: `{"url": "https://example.com/files/image.png", "size": 204800}`

### Imgur

| Setting | Value |
|---|---|
| API Endpoint | `https://api.imgur.com/3/image` |
| File Field Name | `image` |
| Image URL Path | `data.link` |
| Headers | `Authorization` = `Client-ID your-client-id` |

## Installation

### From Community Plugins (Recommended)

1. Open **Settings** → **Community plugins** → **Browse**
2. Search for "Image Uploader to API"
3. Click **Install**, then **Enable**

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/babarot/obsidian-image-uploader/releases)
2. Create a folder `image-uploader-to-api` in your vault's `.obsidian/plugins/` directory
3. Place the downloaded files into that folder
4. Enable the plugin in **Settings** → **Community plugins**

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

[MIT](LICENSE)
