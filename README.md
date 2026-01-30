# p7d-markdown-it-renderer-image

A markdown-it plugin plus a browser DOM helper to set `img` attributes (width/height, loading, decoding) and optionally resolve `src` using frontmatter.

## Quick start

### Node usage (markdown-it)

```js
import fs from 'fs'
import mdit from 'markdown-it'
import mditRendererImage from '@peaceroad/markdown-it-renderer-image'

const mdFile = '/tmp/markdown.md'
const md = mdit().use(mditRendererImage, { mdPath: mdFile })
const mdCont = fs.readFileSync(mdFile, 'utf-8')

console.log(md.render(mdCont))
```

You can also pass `mdPath` via the render env:

```js
const md = mdit().use(mditRendererImage)
console.log(md.render(mdCont, { mdPath: mdFile }))
```

Frontmatter-based rewriting on Node:

```js
const frontmatter = { url: 'https://example.com/page' }
const html = md.render(mdCont, { mdPath: mdFile, frontmatter })
console.log(html)
```

### Browser / DOM usage

```html
<script type="module">
import { createContext, applyImageTransforms, startObserver } from '<package>/script/set-img-attributes.js'

const context = await createContext(markdownCont, {
  readMeta: true, // read frontmatter from <meta>
})

// Apply once
await applyImageTransforms(document, context)

// Or observe mutations
startObserver(document, context)
</script>
```

Notes:
- The DOM helper provides named functions; the default export is a no-op compatibility shim.
- In browser builds, importing the package root resolves to the DOM helper (named exports + no-op default). Use the script path if you want to be explicit.
- `createContext` reads YAML frontmatter from the first argument (markdown text). Pass `null`/`''` to skip YAML parsing and rely on `readMeta` (JSON in `meta[name="markdown-frontmatter"]`).
- The DOM script imports `./img-util.js` as a module; bundle it or ensure the base URL resolves correctly.

Example (bundler or app code that rerenders HTML):

```js
import { createContext, applyImageTransforms } from '@peaceroad/markdown-it-renderer-image/script/set-img-attributes.js'

txt.addEventListener('input', async () => {
  const markdownCont = txt.value
  html.innerHTML = renderedHtml

  const context = await createContext(markdownCont, { readMeta: true }, html)
  await applyImageTransforms(html, context, markdownCont)
})
```

### Node vs DOM parity

To make Node and DOM results match (final `src` + `width/height`):

- DOM: `previewMode: 'output'` and `setDomSrc: true`
- Node: `resolveSrc: true`

Intentional differences:

- DOM: `previewMode` can separate display `src` from final output URL (Node has no equivalent).
- DOM: `setDomSrc: false` can skip DOM `src` rewriting while still sizing (Node has no equivalent).
- Node: `mdPath`, `disableRemoteSize`, `remoteTimeout` control local/remote sizing (DOM has no equivalent).

## Options (summary)

### Node plugin options (defaults)

- `scaleSuffix` (false): scale by `@2x`, `300dpi`, `300ppi` suffixes.
- `resize` (false): resize by title hint.
- `autoHideResizeTitle` (true): remove title when resize hint is used.
- `resizeDataAttr` (`data-img-resize`): store resize hint when title is removed (set `''` to disable).
- `lazyLoad` (false): add `loading="lazy"`.
- `asyncDecode` (false): add `decoding="async"`.
- `checkImgExtensions` (`png,jpg,jpeg,gif,webp`): extensions to size.
- `resolveSrc` (true): resolve final `src` using frontmatter (no-op without frontmatter or `urlImageBase`).
- `mdPath` (empty): markdown file path for local sizing.
- `disableRemoteSize` (false): skip remote sizing.
- `remoteTimeout` (5000): sync fetch timeout in ms.
- `remoteMaxBytes` (16MB): skip large remote images when content-length is present.
- `cacheMax` (64): per-render cache size (0 disables cache).
- `suppressErrors` (`none`): `none` | `all` | `local` | `remote`.
- `urlImageBase` (empty): fallback base when frontmatter lacks `urlimagebase`.
- `outputUrlMode` (`absolute`): `absolute` | `protocol-relative` | `path-only`.

### DOM script options (defaults)

Same as Node options except remote sizing options, plus:

- `readMeta` (false): read `meta[name="markdown-frontmatter"]` (JSON).
- `previewMode` (`output`): `output` | `markdown` | `local`.
  - `output`: display final URL (default).
  - `markdown`: display the original markdown `src` (best for drag & drop/blob mapping).
  - `local`: display a local file URL when `lmd` is an absolute path.
- `previewOutputSrcAttr` (`data-img-output-src`): attribute name to store the final URL when `previewMode !== output` (set `''` to disable).
- `loadSrcResolver` (null): function to override the measurement source (`loadSrc`) for size calculation (DOM only).
- `loadSrcMap` (null): map of `src` -> `loadSrc` overrides for size calculation (DOM only).
- `setDomSrc` (true): when false, leaves `img.src` untouched (size probing still runs).
- `enableSizeProbe` (true): when false, skips size probing entirely (no network or image load).
- `awaitSizeProbes` (true): wait for image load before resolving `applyImageTransforms`.
- `sizeProbeTimeoutMs` (3000): timeout for size probes (0 disables).
- `onImageProcessed` (null): per-image callback `(imgEl, info) => {}`.

`readMeta` is opt-in to avoid extra DOM work in normal pages; enable it for live preview scenarios (e.g., VS Code). When running a page from `file://`, the DOM script defaults `suppressErrors` to `local` unless you explicitly set `suppressErrors`, to reduce noisy console errors from local image probes.

## Options (details)

### Resolve output image `src` from frontmatter or options

When `resolveSrc: true` (default), image `src` is resolved using frontmatter keys.

Frontmatter is used only when `resolveSrc: true`. If frontmatter (and `urlImageBase`) is missing, `src` is left untouched.

Frontmatter keys (lowercase only):

- `url`: page base URL.
- `urlimage`: image base URL (absolute) or image directory (relative/empty).
- `urlimagebase`: base URL used with the path from `url`.
- `lid`: local image directory prefix to strip from relative `src` so the remaining subpath can be reused in the final URL.
- `lmd`: local media directory for DOM size loading. If it is an absolute path without a scheme, it is converted to a `file:///` URL with encoded segments; relative paths are kept as-is.
- `imagescale`: scale factor applied to all images (e.g. `60%` or `0.6`, values above 100% are capped).

Base selection order:

1) `urlimage` when it is absolute (has a domain or starts with `//`).
2) `urlimagebase` (frontmatter) or `urlImageBase` (option) + path from `url`.
3) `url`.

If `urlimage` is relative (no domain), it becomes an image directory inserted between base and filename, and only the basename from `src` is used. Use `urlimage:` (empty) or `urlimage: .` to force basename-only without adding a directory.

Examples:

```yaml
---
url: https://example.com/page
urlimage: images
---
![A cat.](cat.jpg)
# -> https://example.com/page/images/cat.jpg (relative urlimage uses basename-only)
```

```yaml
---
urlimage: https://image.example.com/assets/
---
![A cat.](cat.jpg)
# -> https://image.example.com/assets/cat.jpg
```

```yaml
---
url: https://example.com/page
urlimagebase: https://image.example.com/assets/
urlimage: images
---
![A cat.](cat.jpg)
# -> https://image.example.com/assets/page/images/cat.jpg
```

`lid` removes only the matching prefix and keeps the remaining subpath:

```yaml
---
lid: image
---
![](image/cat.jpg)         # -> cat.jpg
![](image/chapter/cat.jpg) # -> chapter/cat.jpg
```

Example of a global scale factor:

```yaml
---
imagescale: 60%
---
![](cat.jpg) # -> width/height scaled to 60%
```

`imagescale` is applied after `scaleSuffix` and only when no title resize hint is present (resize takes priority). Values above 100% are capped. Order:

1) Read original size
2) Apply `scaleSuffix` (e.g. `@2x`)
3) Apply title resize (`resize: true`) if present
4) Apply `imagescale` (global scale) only when step 3 is not used

Example: 400x300 image with `@2x`, title `resize:50%`, and `imagescale: 0.5`
-> 400x300 -> 200x150 -> 100x75 (imagescale skipped)

### Local sizing in DOM (`lmd`)

In browsers, local file access is restricted. For local sizing in the DOM script, provide `lmd` (local markdown directory) as a path or a Webview URI:

```yaml
---
lmd: C:\Users\User\Documents\manuscript
---
```

In VS Code, pass a Webview URI (e.g., `asWebviewUri`) instead of a raw `file://` path.

### Preview modes in DOM

When `previewMode` is `markdown` or `local`, the DOM script stores the final URL in `previewOutputSrcAttr` (default `data-img-output-src`) so you can copy/export HTML with the CDN URL. The original markdown `src` is cached in `data-img-src-raw` to keep reprocessing stable; `lmd` is still used for size measurement when available. In VS Code Webview, relative `src` may not resolve, so use `previewMode: 'output'` there.

If you need to measure sizes from Blob URLs (e.g., drag-and-drop files), pass `loadSrcResolver` or `loadSrcMap` so the DOM script uses those URLs only for measurement without changing the displayed `src`. Functions cannot be provided via `readMeta` JSON, so use direct options for `loadSrcResolver`.

Only `.html`, `.htm`, `.xhtml` are treated as file names when deriving the path from `url` (used by `urlimagebase`).

- `url: https://example.com/page` -> `/page/`
- `url: https://example.com/page/index.html` -> `/page/`
- `url: https://example.com/v1.2/` -> `/v1.2/`

### `outputUrlMode`

Applied at the end:

- `protocol-relative`: `https://a/b` -> `//a/b`
- `path-only`: `https://a/b` -> `/b` (same-origin only)

### Modify output width/height attributes from filename suffixes

When `scaleSuffix: true`, scales dimensions by:

- `@2x` (half size)
- `_300dpi` / `_300ppi` (convert to 96dpi)

This is identified by `imageFileName.match(/[@._-]([0-9]+)(x|dpi|ppi)$/)`

Example:

```js
const md = mdit().use(mditRendererImage, { scaleSuffix: true })
md.render('![A cat](cat@2x.jpg)', { mdPath: mdFile })
// <img ... width="200" height="150"> //cat.jpg is 400px wide and 300px high.
```

### Modify output width/height attributes from title resize hints

When `resize: true`, resizes dimensions by title patterns. Example:

```js
const md = mdit().use(mditRendererImage, { resize: true })

md.render('![A cat](cat.jpg "Resize:50%")', { mdPath: mdPat })
// <img ... width="200" height="150"> //cat.jpg is 400px wide and 300px high.
```

Title patterns include:

- `Resize:50%`
- `リサイズ：50%`
- `サイズ変更：50%`

This is identified by `imgTitle.match(/(?:(?:(?:大きさ|サイズ)の?変更|リサイズ|resize(?:d to)?) *[:：]? *([0-9]+)([%％]|px)|([0-9]+)([%％]|px)[にへ](?:(?:大きさ|サイズ)を?変更|リサイズ))/i)`

For `px` values, the number is treated as the target width and height is scaled to preserve aspect ratio (e.g. 400x300 with `resize:200px` -> 200x150). The final size is capped at the original image dimensions (no upscaling).

When `autoHideResizeTitle: true` (default), titles with resize hints are removed (Node/DOM). Set `autoHideResizeTitle: false` to keep titles even when resize hints are used. Resize hints are preserved in `resizeDataAttr` by default (`data-img-resize`) using normalized values like `50%` or `200px`; set `resizeDataAttr: ''` to disable.

Default behavior example (when `resize: true`):

```js
const md = mdit().use(mditRendererImage, { resize: true })

md.render('![Figure](cat.jpg "resize:50%")', { mdPath: mdPat })
// <img ... width="200" height="150" data-img-resize="50%">
```

If you render HTML with the Node plugin and then run the DOM script, keep `resizeDataAttr: 'data-img-resize'` (default) so the resize hint survives title removal. If you do not need DOM reprocessing, set `resizeDataAttr: ''` to avoid extra attributes.

### Set `loading` and `decoding` attributes

- `lazyLoad: true` -> `loading="lazy"`
- `asyncDecode: true` -> `decoding="async"`

### Check image extensions

Only files matching `checkImgExtensions` are sized. Query/hash is ignored.

## Remote images (Node)

Remote sizing is synchronous. For extension hosts (e.g., VS Code), set `disableRemoteSize: true` and let the DOM script size remote images.

## Testing

- `npm test` (Node plugin + frontmatter tests)
- `npm run test:script` (DOM script tests)

## VS Code / Webview notes

- Webview blocks `file://`. Pass `lmd` as a Webview URI (`asWebviewUri`) if you need local sizing in the DOM.
- The DOM script imports `./img-util.js` as a module; bundle it or ensure the base URL resolves correctly.
