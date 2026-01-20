# p7d-markdown-it-renderer-image

A markdown-it plugin plus a browser DOM helper to set `img` attributes (width/height, loading, decoding) and optionally rewrite `src` using frontmatter.

## Use

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
import fs from 'fs'
import mdit from 'markdown-it'
import mditRendererImage from '@peaceroad/markdown-it-renderer-image'

const mdFile = '/tmp/markdown.md'
const md = mdit().use(mditRendererImage)
const mdCont = fs.readFileSync(mdFile, 'utf-8')

console.log(md.render(mdCont, { mdPath: mdFile }))
```

Frontmatter-based rewriting on Node:

```js
import fs from 'fs'
import mdit from 'markdown-it'
import mditRendererImage from '@peaceroad/markdown-it-renderer-image'

const mdFile = '/tmp/markdown.md'
const md = mdit().use(mditRendererImage)
const mdCont = fs.readFileSync(mdFile, 'utf-8')

const frontmatter = { url: 'https://example.com/page' }
const html = md.render(mdCont, { mdPath: mdFile, frontmatter })
console.log(html)
```

### Browser / DOM usage

```html
<script type="module">
import setImgAttributes from '<package>/script/set-img-attributes.js'

await setImgAttributes(markdownCont, {
  readMeta: true, // read frontmatter from <meta>
  observe: true,  // watch DOM mutations
})
</script>
```

`setImgAttributes` reads YAML frontmatter from the first argument (markdown text). Pass `null`/`''` if you want to skip YAML parsing and rely on `readMeta` (JSON stored in `meta[name="markdown-frontmatter"]`).

Bundlers can import the same entry point. The DOM script relies on `./img-util.js`, so bundle it or make sure the import base URL resolves correctly.

Example (bundler or app code that rerenders HTML):

```js
import setImgAttributes from '@peaceroad/markdown-it-renderer-image/script/set-img-attributes.js'

txt.addEventListener('input', async () => {
  const markdownCont = txt.value
  html.innerHTML = renderedHtml

  await setImgAttributes(markdownCont, {
    readMeta: true,
    observe: true,
  })
})
```

## Options (summary)

### Node plugin options (defaults)

- `scaleSuffix` (false): scale by `@2x`, `300dpi`, `300ppi` suffixes.
- `resize` (false): resize by title hint.
- `autoHideResizeTitle` (true): remove title when resize hint is used.
- `resizeDataAttr` (`data-img-resize`): store resize hint when title is removed (set `''` to disable).
- `lazyLoad` (false): add `loading="lazy"`.
- `asyncDecode` (false): add `decoding="async"`.
- `checkImgExtensions` (`png,jpg,jpeg,gif,webp`): extensions to size.
- `modifyImgSrc` (true): enable frontmatter-based `src` rewriting (no-op without frontmatter or `urlImageBase`).
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
- `observe` (false): watch DOM mutations and re-run processing.

`readMeta`/`observe` are opt-in to avoid extra DOM work in normal pages; enable them for live preview scenarios (e.g., VS Code).

## Options (details)

### Modify output image `src` attribute from frontmatter or options

When `modifyImgSrc: true` (default), image `src` is rewritten using frontmatter keys.

Frontmatter is used only when `modifyImgSrc: true`. If frontmatter (and `urlImageBase`) is missing, `src` is left untouched.

Frontmatter keys:

- `url`: page base URL.
- `urlimage`: image base URL (absolute) or image directory (relative/empty). alias: `urlImage`.
- `urlimagebase`: base URL used with the path from `url`. alias: `urlImageBase`.
- `lid`: local image directory prefix to strip from relative `src` so the remaining subpath can be reused in the final URL.
- `lmd`: local media directory for DOM size loading.
- `imagescale`: scale factor applied to all images (e.g. `60%` or `0.6`). alias: `imageScale`.

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

`imagescale` is applied after `scaleSuffix` and title-based resize. Order:

1) Read original size
2) Apply `scaleSuffix` (e.g. `@2x`)
3) Apply title resize (`resize: true`)
4) Apply `imagescale` (global scale)

Example: 400x300 image with `@2x`, title `resize:50%`, and `imagescale: 0.5`
-> 400x300 -> 200x150 -> 100x75 -> 50x38

#### Local sizing in DOM (`lmd`)

In browsers, local file access is restricted. For local sizing in the DOM script, provide `lmd` (local markdown directory) as a path or a Webview URI:

```yaml
---
lmd: C:\Users\User\Documents\manuscript
---
```

In VS Code, pass a Webview URI (e.g., `asWebviewUri`) instead of a raw `file://` path.

Only `.html`, `.htm`, `.xhtml` are treated as file names when deriving the path from `url` (used by `urlimagebase`).

- `url: https://example.com/page` -> `/page/`
- `url: https://example.com/page/index.html` -> `/page/`
- `url: https://example.com/v1.2/` -> `/v1.2/`

#### `outputUrlMode`

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

When `autoHideResizeTitle: true` (default), titles with resize hints are removed (Node/DOM). Set `autoHideResizeTitle: false` to keep titles even when resize hints are used. Resize hints are preserved in `resizeDataAttr` by default (`data-img-resize`); set `resizeDataAttr: ''` to disable.

Default behavior example (when `resize: true`):

```js
const md = mdit().use(mditRendererImage, { resize: true })

md.render('![Figure](cat.jpg "resize:50%")', { mdPath: mdPat })
// <img ... width="200" height="150" data-img-resize="resize:50%">
```

If you render HTML with the Node plugin and then run the DOM script, keep `resizeDataAttr: 'data-img-resize'` (default) so the resize hint survives title removal. If you do not need DOM reprocessing, set `resizeDataAttr: ''` to avoid extra attributes.

### Advanced/legacy options

- `hideTitle`: legacy alias for `autoHideResizeTitle` (internal; avoid new usage).
- `imgSrcPrefix`: rewrites only the origin of the resolved base URL (advanced; avoid new usage). Example: base `https://example.com/assets/` + `imgSrcPrefix: https://cdn.example.com/` -> `https://cdn.example.com/assets/`.
- `suppressLoadErrors`: legacy alias for `suppressErrors` (`true` -> `all`, `false` -> `none`).

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
- The DOM script uses a dynamic import for `./img-util.js`; bundle it or ensure the base URL resolves correctly.
