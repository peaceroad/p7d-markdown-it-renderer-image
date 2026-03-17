# Local File Harness

This directory contains a small `file://` smoke harness for repository development.

Open:

- `preview.html`

If you changed `script/default-options.js`, `script/img-util.js`, or `script/set-img-attributes.js`, rebuild the bundle first:

```bash
node example/build-preview-bundle.mjs
```

Notes:

- `preview.html` renders a small gallery of fixed markdown samples and applies the DOM helper bundle from `preview-bundle.js`.
- The sample markdown uses `{{LMD}}` as a display placeholder and resolves it to the current `example/` directory at render time.
- On `file://` pages, `enableSizeProbe` is auto-set to `false` unless explicitly overridden. The shipped samples force it on where width/height or resize output would otherwise be omitted.
- This harness is for development/debugging and is not part of the published package files.
