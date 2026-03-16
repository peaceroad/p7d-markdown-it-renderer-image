# markdown-it-renderer-image - Workflow Notes

## index.js (markdown-it plugin, Node)
1. Initialize options (resolveSrc on by default, remote sizing on by default, cache, suppressErrors, outputUrlMode, urlImageBase).
2. Prepare extension regex (query/hash ignored).
3. Use `md.core.ruler.after('replacements')` to walk inline tokens and process each `image` token (no renderer override).
   - Read `srcRaw`/`title`; split base + query/hash.
   - If `resolveSrc` and frontmatter (or `urlImageBase` option) exist: parse frontmatter, strip `lid`, build image base (`urlimage` absolute > `urlimagebase` + url path > `url`), treat relative `urlimage` as an image directory (basename only), normalize; keep query/hash.
   - Node frontmatter precedence: `env.frontmatter` first; otherwise use `md.frontmatter` / `md.meta` only when the current source starts with YAML frontmatter. Do not rely on `md.env.frontmatter`.
   - Apply `outputUrlMode` to final URL.
   - Set final `src`/`alt`/`title`. Emit effective resize metadata in `resizeDataAttr` (default `data-img-resize`); emit `${resizeDataAttr}-origin` only for `imagescale`-derived values. Title is removed only when `autoHideResizeTitle` + `resize` + resize-pattern match. Emit `data-img-scale-suffix` when filename scale suffix metadata is available. Optional `decoding`/`loading`.
   - If extension allowed: resolve path (remote vs local via mdPath, which can be a file path or a directory), warn once when mdPath missing, skip remote if `disableRemoteSize`.
   - Load dimensions via `image-size` (local) or `sync-fetch` + `image-size` (remote); respect `remoteMaxBytes` when content-length is present. Per-render cache; global sets de-duplicate errors/warnings. `cacheMax` 0 disables cache.
   - Apply `setImgSize` (scaleSuffix, resize via title, imagescale, noUpscale always on) and set width/height.
4. Frontmatter resolution and base URL are cached per render to avoid recompute.

## script/set-img-attributes.js (browser)
1. Exports `classifyResizeHint`, `createContext`, `applyImageTransforms`, `applyImageTransformsToString`, `startObserver`, and `runInPreview`.
   - Also exports `defaultSharedOptions`, `defaultDomOptions`, `defaultNodeOptions` for shared defaults.
   - `runInPreview({ root, markdownCont, observe, ... })` is a high-level helper for preview usage (create context + apply + optional observer).
   - Default export is a no-op shim returning `Promise.resolve()`; `suppressNoopWarning` silences the browser warning.
2. `createContext(markdownCont, options, root)` parses options and YAML frontmatter (`url`/`urlimage`/`urlimagebase`/`lid`/`lmd`/`imagescale`, lowercase only) and optionally reads `meta[name="markdown-frontmatter"]` when `readMeta: true` (merging `_extensionSettings.rendererImage` unless disabled).
3. `applyImageTransforms(root, contextOrOptions)`:
   - `root` accepts a document/container, a single `<img>`, or an iterable of `<img>` elements.
   - Applies path rewriting when `resolveSrc: true`, using image base (`urlimage` absolute > `urlimagebase` + url path > `url`, with `urlImageBase` option as fallback). Relative `urlimage` is treated as an image directory (basename only).
   - `lmd` handling: keep existing URL schemes; if `lmd` is an absolute local path, convert to `file:///` with URL-encoded segments and a trailing slash; relative `lmd` stays relative.
   - `previewMode`: `output` | `markdown` | `local`. When not `output`, store final URL in `previewOutputSrcAttr` and cache original `src` in `data-img-src-raw`.
   - `setDomSrc: false` keeps `img.src` untouched while still running size probes.
   - `enableSizeProbe: false` skips size probing entirely (no network or image load).
   - `keepPreviousDimensionsDuringResizeEdit: true` keeps existing width/height while title is in a `pending` resize state (`src` unchanged + size attrs present).
   - `loadSrcStrategy` chooses the probe source (`output` | `raw` | `display`).
   - `loadSrcPrefixMap` rewrites probe URLs by prefix (JSON-friendly).
   - `loadSrcResolver` / `loadSrcMap` can override the measurement source (`loadSrc`) for size calculation.
   - Optional probe cache across apply runs: `probeCacheMaxEntries` (bounded cache size), `probeCacheTtlMs` (success TTL), `probeNegativeCacheTtlMs` (failed/timeout TTL). Success cache is keyed by effective `loadSrc`; failed/timeout cache and in-flight probe requests are keyed by `loadSrc` plus current `sizeProbeTimeoutMs`.
   - Returns a summary object `{ total, processed, pending, sized, failed, timeout, skipped }` and optionally calls `onImageProcessed(img, info)` per image.
   - `onResizeHintEditingStateChange(img, info)` is called on resize-hint state transitions only (`previousState` is `null` on first emit).
   - Uses `awaitSizeProbes` and `sizeProbeTimeoutMs` to control async sizing.
4. `applyImageTransformsToString(html, contextOrOptions)` uses `DOMParser` to transform an HTML string and returns the updated HTML.
5. `startObserver(root, contextOrOptions)` runs a MutationObserver and re-applies transforms; returns `{ disconnect }`.
   - `observeAttributeFilter` customizes which image attributes are observed (default `src/title/alt`).
   - `observeDebounceMs` adds quiet-period debounce in addition to existing rAF batching.
   - When `readMeta` changes observer-related options, observer registration is refreshed to keep attributeFilter behavior consistent.
   - If a prebuilt context is passed, observer re-creation uses the original option seed (`context.seedOption`) so runtime meta options are not accidentally frozen as explicit overrides.

## Output Metadata (`data-*`)
- `data-img-resize` stores the effective resize value that contributed to sizing output. It may come from a title resize hint or from frontmatter `imagescale`.
- `data-img-resize-origin` is emitted only when `data-img-resize` came from `imagescale`; title-derived resize metadata omits the origin attribute by default.
- `data-img-scale-suffix` stores canonical filename scale suffix metadata such as `2x`, `300dpi`, or `300ppi`. Keep it separate from resize metadata because suffix scaling can combine with title resize or `imagescale`.
- In DOM preview flows, `data-img-src-raw` keeps the original markdown `src` when `previewMode !== 'output'`, while `previewOutputSrcAttr` stores the rewritten output URL for inspection/use by preview integrations.

## Utilities (script/img-util.js)
- Frontmatter parsing, path normalization, resize classification (`classifyResizeHint`), resize/scaleSuffix regexes, image base resolution, and size adjustment (`setImgSize`).
- Frontmatter normalization removes only a leading `./` (not arbitrary single-character prefixes).
- URL path extraction treats only `.html`, `.htm`, `.xhtml` as file names; other dotted segments are kept as directories.
- Shared URL helpers (scheme checks, basename, extension regex, `applyOutputUrlMode`) are centralized here and used by both Node and DOM.
- `safeDecodeUri` avoids decoding `%2F/%5C` to keep path segmentation stable while still handling non-ASCII filenames.
- URL/scheme helper regexes are module-level constants to avoid per-call re-allocation on hot paths.
- Utility helpers treat non-string inputs as empty values to avoid runtime TypeErrors.

## Testing
- `npm test` for Node-side plugin + YAML frontmatter tests.
- `npm run test:script` for browser-side DOM handling tests (includes resize metadata/origin and title removal coverage).

## Concerns / notes
- VS Code Webview blocks `file://`; pass `lmd` as a Webview URI from the extension (e.g., `asWebviewUri`) instead of a raw path.
- The DOM module imports `./img-util.js`; ensure the base URL is compatible or bundle it for Webview use.
- Remote sizing in `index.js` uses synchronous fetch; if enabled in an extension host, it can block UI. Prefer `disableRemoteSize: true` in VS Code.
- `remoteMaxBytes` only applies when content-length is present; large remote downloads can still occur without it.
- Relative `urlimage` enforces basename-only for relative `src` when a base URL is used.
- `outputUrlMode: path-only` assumes same-origin and will drop the domain.
- `previewMode: 'markdown'` keeps the markdown `src` for display; in VS Code Webview, relative paths may not resolve, so use `previewMode: 'output'` there.
- On `file://` pages, the DOM script auto-sets `suppressErrors: 'local'` and disables `enableSizeProbe` unless explicitly overridden to reduce noisy local load errors.
- VS Code preview + DOM observer/probe can show timing-sensitive layout issues after live `resize:` title edits (e.g., width constrained but height appears too large). Treat this as an interaction issue (Webview layout timing + observer/probe flow), not a confirmed single-side bug.
- Current extension-side workaround (kept enabled): use `onImageProcessed` to enforce responsive style when unset (`img.style.height = "auto"`, `img.style.maxWidth = "100%"`) while keeping `enableSizeProbe: true`.
- If the issue recurs, collect: `observeDebounceMs` A/B (`0` vs `250`), `onImageProcessed` logs (`width`, `height`, `data-img-resize`, `style.height`), and a minimal reproducible sample.
