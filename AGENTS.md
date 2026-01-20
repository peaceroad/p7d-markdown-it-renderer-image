# markdown-it-renderer-image - Workflow Notes

## index.js (markdown-it plugin, Node)
1. Initialize options (modifyImgSrc on by default, remote sizing on by default, cache, suppressErrors, outputUrlMode, urlImageBase).
2. Prepare extension regex (query/hash ignored).
3. For each `image` token:
   - Read `srcRaw`/`title`; split base + query/hash.
   - If `modifyImgSrc` and frontmatter (or `urlImageBase`) exist: parse frontmatter (supports `urlImage`/`urlImageBase` aliases), strip `lid`, build image base (`urlimage` absolute > `urlimagebase`/`urlImageBase` + url path > `url`), treat relative `urlimage` as an image directory (basename only), normalize; keep query/hash. `imgSrcPrefix` replaces the base origin.
   - Apply `outputUrlMode` to final URL.
   - Set final `src`/`alt`/`title` (title removed only when `autoHideResizeTitle` + `resize` + resize-pattern match). When removed, preserve the resize hint in `resizeDataAttr` (default `data-img-resize`, set `''` to disable). Optional `decoding`/`loading`.
   - If extension allowed: resolve path (remote vs local via mdPath), warn once when mdPath missing, skip remote if `disableRemoteSize`.
   - Load dimensions via `image-size` (local) or `sync-fetch` + `image-size` (remote); respect `remoteMaxBytes` when content-length is present. Per-render cache; global sets de-duplicate errors/warnings. `cacheMax` 0 disables cache.
   - Apply `setImgSize` (scaleSuffix, resize via title, imagescale, noUpscale always on) and set width/height.
4. Frontmatter resolution and base URL are cached per render to avoid recompute.

## script/set-img-attributes.js (browser)
1. Parse options (modifyImgSrc on by default, resize/scaleSuffix off, autoHideResizeTitle true, resizeDataAttr defaults to `data-img-resize`, suppressErrors `none`, readMeta/observe off by default).
2. Parse YAML frontmatter (if provided) for `url`/`urlimage`/`urlimagebase`/`lid`/`lmd`/`imagescale` (alias `imageScale`). When `readMeta: true`, read `meta[name="markdown-frontmatter"]` and apply `_extensionSettings.rendererImage` plus frontmatter keys (skip if `notSetImageElementAttributes` or `disableRendererImage` is true).
3. For each DOM `img`:
   - Read `srcRaw`; compute base + query/hash.
   - If `modifyImgSrc`: strip `lid`; build `loadSrc` from `lmd` + normalized local path (before base); prepend image base (`urlimage` absolute > `urlimagebase`/`urlImageBase` + url path > `url`) for final `src` when relative, normalize; if `urlimage` is relative, insert it as an image directory and use basename-only; apply `outputUrlMode`; keep query/hash; set final `src` on the element.
   - `lmd` handling: keep existing URL schemes (http/https/file/vscode-*/data/blob); otherwise treat `lmd` as a local path and prepend `file:///` and a trailing slash.
   - Set `alt`, `title` (or remove if autoHideResizeTitle and resize/title match); when removed, store the resize hint in `resizeDataAttr` for later DOM updates; when title is kept or non-resize, clear `resizeDataAttr`; apply `loading`/`decoding` defaults if absent.
   - Choose loadSrc: `lmd`-prefixed path if provided, else final `src`; load into an Image.
   - On load, if extension matches, use naturalWidth/Height with `setImgSize` (scaleSuffix, resize via title, imagescale, noUpscale always on) to set width/height. Extension match ignores query/hash.
   - `suppressErrors` silences image load errors (legacy alias: `suppressLoadErrors`). Use this file in browsers; `index.js` is Node-oriented.
4. When `observe: true`, uses MutationObserver to re-run processing on DOM and meta changes (live previews).

## Utilities (script/img-util.js)
- Frontmatter parsing, path normalization, resize/scaleSuffix regexes, image base resolution, and size adjustment (`setImgSize`).
- URL path extraction treats only `.html`, `.htm`, `.xhtml` as file names; other dotted segments are kept as directories.

## Testing
- `npm test` for Node-side plugin + YAML frontmatter tests.
- `npm run test:script` for browser-side DOM handling tests (includes `resizeDataAttr` and title removal coverage).

## Concerns / notes
- VS Code Webview blocks `file://`; pass `lmd` as a Webview URI from the extension (e.g., `asWebviewUri`) instead of a raw path.
- Dynamic import of `./img-util.js` can fail in Webview unless the script is loaded with a compatible base URL or bundled.
- Remote sizing in `index.js` uses synchronous fetch; if enabled in an extension host, it can block UI. Prefer `disableRemoteSize: true` in VS Code.
- `remoteMaxBytes` only applies when content-length is present; large remote downloads can still occur without it.
- Relative `urlimage` enforces basename-only for relative `src` when a base URL is used.
- `outputUrlMode: path-only` assumes same-origin and will drop the domain.
- `imgSrcPrefix` rewrites the base origin; it is easy to misconfigure when combined with `urlimage`/`urlimagebase`.
- `hideTitle` is a legacy internal alias for `autoHideResizeTitle` (avoid new usage).

## Browser Notes
- Safari Technology Preview 222: `<figcaption>` inside `<figure>` contributes to `<img>` accessible name only when no `alt`, ARIA, or `title` is present (295746@main / 150597445).
