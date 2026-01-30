# markdown-it-renderer-image - Workflow Notes

## index.js (markdown-it plugin, Node)
1. Initialize options (resolveSrc on by default, remote sizing on by default, cache, suppressErrors, outputUrlMode, urlImageBase).
2. Prepare extension regex (query/hash ignored).
3. For each `image` token:
   - Read `srcRaw`/`title`; split base + query/hash.
   - If `resolveSrc` and frontmatter (or `urlImageBase` option) exist: parse frontmatter, strip `lid`, build image base (`urlimage` absolute > `urlimagebase` + url path > `url`), treat relative `urlimage` as an image directory (basename only), normalize; keep query/hash.
   - Apply `outputUrlMode` to final URL.
   - Set final `src`/`alt`/`title` (title removed only when `autoHideResizeTitle` + `resize` + resize-pattern match). When removed, preserve the resize hint in `resizeDataAttr` (default `data-img-resize`, set `''` to disable). Optional `decoding`/`loading`.
   - If extension allowed: resolve path (remote vs local via mdPath), warn once when mdPath missing, skip remote if `disableRemoteSize`.
   - Load dimensions via `image-size` (local) or `sync-fetch` + `image-size` (remote); respect `remoteMaxBytes` when content-length is present. Per-render cache; global sets de-duplicate errors/warnings. `cacheMax` 0 disables cache.
   - Apply `setImgSize` (scaleSuffix, resize via title, imagescale, noUpscale always on) and set width/height.
4. Frontmatter resolution and base URL are cached per render to avoid recompute.

## script/set-img-attributes.js (browser)
1. Exports `createContext`, `applyImageTransforms`, `applyImageTransformsToString`, and `startObserver`.
2. `createContext(markdownCont, options, root)` parses options and YAML frontmatter (`url`/`urlimage`/`urlimagebase`/`lid`/`lmd`/`imagescale`, lowercase only) and optionally reads `meta[name="markdown-frontmatter"]` when `readMeta: true` (merging `_extensionSettings.rendererImage` unless disabled).
3. `applyImageTransforms(root, contextOrOptions)`:
   - Applies path rewriting when `resolveSrc: true`, using image base (`urlimage` absolute > `urlimagebase` + url path > `url`, with `urlImageBase` option as fallback). Relative `urlimage` is treated as an image directory (basename only).
   - `lmd` handling: keep existing URL schemes; if `lmd` is an absolute local path, convert to `file:///` with URL-encoded segments and a trailing slash; relative `lmd` stays relative.
   - `previewMode`: `output` | `markdown` | `local`. When not `output`, store final URL in `previewOutputSrcAttr` and cache original `src` in `data-img-src-raw`.
   - `setDomSrc: false` keeps `img.src` untouched while still running size probes.
   - `enableSizeProbe: false` skips size probing entirely (no network or image load).
   - `loadSrcResolver` / `loadSrcMap` can override the measurement source (`loadSrc`) for size calculation.
   - Returns a summary object `{ total, processed, pending, sized, failed, timeout, skipped }` and optionally calls `onImageProcessed(img, info)` per image.
   - Uses `awaitSizeProbes` and `sizeProbeTimeoutMs` to control async sizing.
4. `applyImageTransformsToString(html, contextOrOptions)` uses `DOMParser` to transform an HTML string and returns the updated HTML.
5. `startObserver(root, contextOrOptions)` runs a MutationObserver and re-applies transforms; returns `{ disconnect }`.

## Utilities (script/img-util.js)
- Frontmatter parsing, path normalization, resize/scaleSuffix regexes, image base resolution, and size adjustment (`setImgSize`).
- URL path extraction treats only `.html`, `.htm`, `.xhtml` as file names; other dotted segments are kept as directories.
- Shared URL helpers (scheme checks, basename, extension regex, `applyOutputUrlMode`) are centralized here and used by both Node and DOM.
- `safeDecodeUri` avoids decoding `%2F/%5C` to keep path segmentation stable while still handling non-ASCII filenames.
- Utility helpers treat non-string inputs as empty values to avoid runtime TypeErrors.

## Testing
- `npm test` for Node-side plugin + YAML frontmatter tests.
- `npm run test:script` for browser-side DOM handling tests (includes `resizeDataAttr` and title removal coverage).

## Concerns / notes
- VS Code Webview blocks `file://`; pass `lmd` as a Webview URI from the extension (e.g., `asWebviewUri`) instead of a raw path.
- The DOM module imports `./img-util.js`; ensure the base URL is compatible or bundle it for Webview use.
- Remote sizing in `index.js` uses synchronous fetch; if enabled in an extension host, it can block UI. Prefer `disableRemoteSize: true` in VS Code.
- `remoteMaxBytes` only applies when content-length is present; large remote downloads can still occur without it.
- Relative `urlimage` enforces basename-only for relative `src` when a base URL is used.
- `outputUrlMode: path-only` assumes same-origin and will drop the domain.
- `previewMode: 'markdown'` keeps the markdown `src` for display; in VS Code Webview, relative paths may not resolve, so use `previewMode: 'output'` there.
- On `file://` pages, the DOM script auto-sets `suppressErrors: 'local'` and disables `enableSizeProbe` unless explicitly overridden to reduce noisy local load errors.

## Browser Notes
- Safari Technology Preview 222: `<figcaption>` inside `<figure>` contributes to `<img>` accessible name only when no `alt`, ARIA, or `title` is present (295746@main / 150597445).
