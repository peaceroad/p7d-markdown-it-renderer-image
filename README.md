# p7d-markdown-it-renderer-image

A markdown-it image plugin plus a browser DOM helper.

- Node plugin: rewrites image `src`, sets `width`/`height`, and can add `loading`/`decoding`.
- DOM helper: applies the same logic to preview HTML and supports live observation.

## Install

```bash
npm i @peaceroad/markdown-it-renderer-image
```

## Quick Start

### Node (markdown-it)

```js
import fs from 'fs'
import mdit from 'markdown-it'
import mditRendererImage from '@peaceroad/markdown-it-renderer-image'

const mdFile = '/tmp/doc.md'
const mdText = fs.readFileSync(mdFile, 'utf-8')

const md = mdit().use(mditRendererImage, { mdPath: mdFile })
console.log(md.render(mdText))
```

`mdPath` accepts a markdown file path or a directory path.

You can also pass `mdPath` at render time:

```js
md.render(mdText, { mdPath: mdFile })
```

For frontmatter-driven URL resolution on Node, the runtime precedence is:

1. `env.frontmatter` passed to `md.render(src, env)`
2. `md.frontmatter` or `md.meta` only when the current markdown source begins with YAML frontmatter

`md.env.frontmatter` is not part of the supported contract.

### Browser / Preview DOM

```html
<script type="module">
import { runInPreview, applyImageTransformsToString } from '@peaceroad/markdown-it-renderer-image/script/set-img-attributes.js'

const { observer } = await runInPreview({
  root: document,
  markdownCont,
  readMeta: true,
  observe: true,
})

const transformed = await applyImageTransformsToString(htmlSource, { readMeta: true }, markdownCont)

observer?.disconnect()
</script>
```

## Runtime Notes

- In browser builds, package-root import resolves to the DOM helper (named exports + no-op default export).
- The default export in the DOM helper is intentionally a no-op and returns a resolved Promise.
- `createContext()` reads YAML frontmatter from `markdownCont` (first argument).
- DOM and Node frontmatter normalization accepts legacy flat keys, dotted keys, and simple nested object forms.
- With `readMeta: true`, DOM helper additionally reads `meta[name="markdown-frontmatter"]` (JSON).

## Common Presets

### 1) VS Code live preview (low load)

```js
await runInPreview({
  root: document,
  markdownCont,
  readMeta: true,
  observe: true,
  previewMode: 'output',
  enableSizeProbe: false,
  observeDebounceMs: 200,
})
```

### 2) Output parity between Node and DOM

- DOM: `previewMode: 'output'`, `setDomSrc: true`
- Node: `resolveSrc: true`

### 3) Keep markdown `src` for display, probe from mapped URL

```js
await runInPreview({
  root: document,
  markdownCont,
  previewMode: 'markdown',
  loadSrcStrategy: 'raw',
  loadSrcPrefixMap: { '/img/': 'http://localhost:3000/img/' },
})
```

## Options

### Shared (Node + DOM)

- `scaleSuffix` (default: `false`): Scale by filename suffix (`@2x`, `300dpi`, `300ppi`).
- `resize` (default: `false`): Resize by title hint (for example `resize:50%`, `resize:200px`).
- `conditionalResize` (default: `null`): Fallback auto-resize policy applied only when neither title resize nor `images.scale` / `imagescale` is active. Example: `{ enabled: true, orientation: 'portrait', minHeight: 560, minWidth: 560, targetWidth: 300 }`.
- `autoHideResizeTitle` (default: `true`): Remove title when it is a resize hint.
- `resizeDataAttr` (default: `'data-img-resize'`): Store normalized effective resize metadata (`title` resize or `imagescale`). When enabled, `${resizeDataAttr}-origin` is also emitted for `imagescale`-derived values (`''` disables both).
- `lazyLoad` (default: `false`): Add `loading="lazy"`.
- `asyncDecode` (default: `false`): Add `decoding="async"`.
- `checkImgExtensions` (default: `'png,jpg,jpeg,gif,webp'`): Extensions eligible for sizing (query/hash ignored).
- `resolveSrc` (default: `true`): Resolve output `src` using frontmatter / `urlImageBase`.
- `urlImageBase` (default: `''`): Fallback when frontmatter has no `urlimagebase`.
- `outputUrlMode` (default: `'absolute'`): `absolute` | `protocol-relative` | `path-only`.
- `suppressErrors` (default: `'none'`): `none` | `all` | `local` | `remote`.

Notes:
- Final size is always capped to original dimensions (no upscaling behavior).
- `conditionalResize.orientation` accepts `portrait` or `landscape` and is evaluated from measured image dimensions (`height > width` or `width > height`).
- `conditionalResize` requires exactly one of `targetWidth` or `targetHeight`.
- `outputUrlMode: 'path-only'` assumes same-origin URL usage.

### Node-only

- `mdPath` (default: `''`): Markdown file path or directory for local image sizing.
- `disableRemoteSize` (default: `false`): Skip remote image sizing.
- `remoteTimeout` (default: `5000`): `sync-fetch` timeout (ms).
- `remoteMaxBytes` (default: `16MB`): Skip remote image when `content-length` exceeds this value.
- `cacheMax` (default: `64`): Per-render size cache entries (`0` disables).

### DOM-only

- `readMeta` (default: `false`): Read `meta[name="markdown-frontmatter"]` JSON.
- `previewMode` (default: `'output'`): `output` | `markdown` | `local`.
- `previewOutputSrcAttr` (default: `'data-img-output-src'`): Stores final output URL when preview mode is not `output` (`''` disables).
- `observeAttributeFilter` (default: `['src','title','alt']`): Image attributes watched by MutationObserver.
- `observeDebounceMs` (default: `0`): Quiet-period debounce before re-processing.
- `setDomSrc` (default: `true`): Write display URL to `img.src`.
- `loadSrcStrategy` (default: `'output'`): Probe source: `output` | `raw` | `display`.
- `loadSrcPrefixMap` (default: `null`): Prefix remap for probe URL.
- `loadSrcResolver` (default: `null`): Function override for probe URL.
- `loadSrcMap` (default: `null`): Static map override for probe URL.
- `enableSizeProbe` (default: `true`): Enable browser image probing for dimensions.
- `awaitSizeProbes` (default: `true`): Await all probe promises before returning summary.
- `sizeProbeTimeoutMs` (default: `3000`): Probe timeout (`0` disables timeout).
- `probeCacheMaxEntries` (default: `0`): Cross-run probe cache size (`0` disables).
- `probeCacheTtlMs` (default: `0`): Success cache TTL (ms).
- `probeNegativeCacheTtlMs` (default: `0`): Failure/timeout cache TTL (ms).
- `keepPreviousDimensionsDuringResizeEdit` (default: `false`): While resize title is in a `pending` state, keep current `width`/`height` when `src` is unchanged and size attrs already exist.
- `onImageProcessed` (default: `null`): Hook: `(imgEl, info) => {}`.
- `onResizeHintEditingStateChange` (default: `null`): Hook called on resize hint state transitions: `(imgEl, { state, previousState, title, normalizedResizeValue, previousSize }) => {}`.
- `suppressNoopWarning` (default: `false`): Silence browser default-export warning.

Additional DOM behavior:
- On `file://` pages, if not explicitly overridden:
  - `suppressErrors` is auto-set to `local`
  - `enableSizeProbe` is auto-set to `false`
- `loadSrcStrategy: 'final'` is accepted as a backward-compatible alias of `'output'`.

## Frontmatter Resolution Workflow

When `resolveSrc: true`, frontmatter normalization accepts these logical fields:

- `page.url` with flat compatibility alias `url`
- `images.baseUrl` with flat compatibility alias `urlimagebase`
- `images.stripLocalPrefix` with flat compatibility alias `lid`
- `local.markdownDir` with flat compatibility alias `lmd`
- `images.scale` with flat compatibility alias `imagescale`
- `images.dirUrl` with flat compatibility alias `urlimage` for an absolute public image directory URL

Supported aliases are resolved in this order:

1. dotted keys
2. nested object keys
3. flat compatibility aliases

Conflicting values emit a warning. `images.dirUrl` and `urlimage` must be absolute; invalid values are ignored.
Relative or empty `urlimage` values are not treated as subdirectory hints anymore.

Node precedence:
- Prefer `env.frontmatter` when provided.
- Fall back to `md.frontmatter` / `md.meta` only for the current render when the markdown source itself starts with YAML frontmatter.
- This avoids leaking metadata from a previous render on a reused `md` instance.

Base URL selection order:

1. Absolute `images.dirUrl` or `urlimage`
2. `images.baseUrl` / `urlimagebase` + path extracted from `page.url` / `url`
3. `page.url` / `url`

Rules:
- `lid` strips a local prefix from relative `src`.
- Query/hash are preserved.

Only `.html`, `.htm`, `.xhtml` are treated as file names when deriving URL path from `url`.

## Size Calculation Workflow

Order:

1. Read intrinsic dimensions
2. Apply `scaleSuffix` (if enabled)
3. Apply title resize (`resize`) if present
4. Apply `imagescale` only when step 3 is not used
5. Apply `conditionalResize` only when steps 3 and 4 are not used
6. Cap to original size (no upscaling)

Metadata emitted to HTML:
- `data-img-resize`: effective normalized resize value (`50%`, `320px`, ...)
- `data-img-resize-origin`: emitted only for `imagescale`
- `data-img-scale-suffix`: canonical filename suffix when `scaleSuffix` applies (`2x`, `300dpi`, `300ppi`)

`conditionalResize` does not emit resize metadata attributes by itself; it only affects final `width` / `height`.

## DOM Probe Source Workflow

Probe URL (`loadSrc`) is decided in this order:

1. Base from `loadSrcStrategy` (`output`/`raw`/`display`)
2. Apply `loadSrcPrefixMap` (if set)
3. Override by `loadSrcResolver` (if provided) or `loadSrcMap`

Probe cache behavior:
- `probeCacheMaxEntries > 0` enables cache.
- Success results are cached by effective `loadSrc` and use `probeCacheTtlMs`.
- Failure/timeout results are policy-aware: they use `probeNegativeCacheTtlMs` at read time and are keyed by `loadSrc` plus current `sizeProbeTimeoutMs`.
- In-flight probe requests for the same `loadSrc` plus current `sizeProbeTimeoutMs` are deduplicated, even when persistent cache entries are disabled.

## Observer Workflow (DOM)

`startObserver()`:
- Watches DOM mutations and re-applies transforms.
- Uses `observeAttributeFilter` as event gate.
- Adds `content` to observer attributeFilter when `readMeta: true`.
- Supports rAF batching and optional quiet-period debounce (`observeDebounceMs`).
- On meta changes, context is rebuilt and observer filter is refreshed.

## API Summary (DOM Helper)

- `classifyResizeHint(title)` -> `{ state, normalizedResizeValue }`
- `createContext(markdownCont, options, root)`
- `applyImageTransforms(root, contextOrOptions, markdownCont?)`
- `applyImageTransformsToString(html, contextOrOptions, markdownCont?)`
- `startObserver(root, contextOrOptions, markdownCont?)`
- `runInPreview({ root, markdownCont, observe, context, ...options })`

## Resize Hint Classification (DOM)

- `classifyResizeHint(title)` returns `state: 'valid' | 'pending' | 'invalid' | 'empty'`.
- `normalizedResizeValue` is non-empty only for `state === 'valid'`.

## Remote Images on Node

Node remote sizing uses synchronous fetch (`sync-fetch`).

Recommendations for extension hosts (for example VS Code):
- Prefer `disableRemoteSize: true`.
- Let DOM helper handle preview sizing.

Important limit:
- `remoteMaxBytes` is effective only when `content-length` is present.
- Protocol-relative remote images (`//cdn.example.com/cat.jpg`) are measured with `https:` first and then `http:` if HTTPS fails. The emitted `src` itself is not rewritten by this fallback.

## Testing

- `npm test` (Node plugin + YAML/frontmatter tests)
- `npm run test:script` (DOM helper tests)

## VS Code / Webview Notes

- Webview blocks raw `file://` access.
- For local probing in Webview, provide `lmd` as a webview URI (for example via `asWebviewUri`).
- If `previewMode: 'markdown'` is used in Webview, relative paths may not resolve; prefer `previewMode: 'output'` there.

## With `@peaceroad/markdown-it-figure-with-p-caption`

Do not overload title with both caption text and resize hints.

- If title is used for resize hints: keep caption in paragraph/alt.
- If title is used for caption: disable auto title hiding (`autoHideResizeTitle: false`) or avoid resize hints in title.

## Performance Checklist

- Node:
  - Disable remote sizing in extension hosts: `disableRemoteSize: true`
  - Keep `cacheMax > 0` for repeated images in same render
- DOM:
  - For editing-heavy preview: `enableSizeProbe: false`
  - If probing is needed: tune `observeDebounceMs` and probe cache TTLs
  - If only metadata transform is needed: `setDomSrc: false`
