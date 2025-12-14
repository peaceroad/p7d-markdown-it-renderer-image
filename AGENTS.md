# markdown-it-renderer-image – Workflow Notes

## index.js (markdown-it plugin, Node)
1. Initialize options (remote sizing on, remoteTimeout 5000ms, remoteMaxBytes 16MB, cacheMax 64, suppressErrors none, hideTitle true).
2. Prepare extension regex (query/hash ignored).
3. For each `image` token:
   - Read `srcRaw`/`title`; split base + query/hash.
   - If `modifyImgSrc` and frontmatter exist: parse, strip `lid`, prepend `url` if relative, normalize path; keep query/hash. `file://` handled via local converter (no `url` module).
   - Set final `src`/`alt`/`title` (title removed only when `hideTitle` + `resize` + resize-pattern match), optional `decoding`/`loading`.
   - If extension allowed: resolve path (remote vs local via mdPath), warn once when mdPath missing, skip remote if `disableRemoteSize`.
   - Load dimensions via `image-size` (local) or `sync-fetch` + `image-size` (remote); respect `remoteMaxBytes` when content-length is present. Per-render cache; global sets de-duplicate errors/warnings. `cacheMax` 0 disables cache.
   - Apply `setImgSize` (scaleSuffix, resize via title) and set width/height.

## script/set-img-attributes.js (browser)
1. Parse options (modifyImgSrc on by default, resize/scaleSuffix off, hideTitle true, suppressLoadErrors false).
2. Parse YAML frontmatter (if provided) for `url`/`lid`/`lmd`.
3. For each DOM `img`:
   - Read `srcRaw`; compute base + query/hash.
   - If `modifyImgSrc`: strip `lid`, apply `lmd` for loading path, prepend `url`, normalize; set final `src` on the element.
   - Set `alt`, `title` (or remove if hideTitle and resize/title match); apply `loading`/`decoding` defaults if absent.
   - Choose loadSrc: `lmd`-prefixed path if provided, else final `src`; load into an Image.
   - On load, if extension matches, use naturalWidth/Height with `setImgSize` (scaleSuffix, resize via title) to set width/height. Extension match ignores query/hash.
   - `suppressLoadErrors` silences image load errors. Use this file in browsers; `index.js` is Node-oriented.

## Utilities (script/img-util.js)
- Frontmatter parsing, path normalization, resize/scaleSuffix regexes, and size adjustment (`setImgSize`).

## Testing
- `npm test` for Node-side plugin + YAML frontmatter tests.
- `npm run test:script` for browser-side DOM handling tests.

## Browser Notes
- Safari Technology Preview 222: `<figcaption>` inside `<figure>` contributes to `<img>` accessible name only when no `alt`, ARIA, or `title` is present (295746@main / 150597445).
