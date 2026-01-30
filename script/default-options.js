const defaultSharedOptions = Object.freeze({
  scaleSuffix: false, // scale by @2x or dpi/ppi suffix
  resize: false, // resize by title hint
  lazyLoad: false, // add loading="lazy"
  asyncDecode: false, // add decoding="async"
  checkImgExtensions: 'png,jpg,jpeg,gif,webp', // size only these extensions
  resolveSrc: true, // resolve final src using frontmatter
  urlImageBase: '', // fallback base when frontmatter lacks urlimagebase
  outputUrlMode: 'absolute', // absolute | protocol-relative | path-only
  autoHideResizeTitle: true, // remove title when resize hint used
  resizeDataAttr: 'data-img-resize', // store resize hint when title removed
  noUpscale: true, // internal: prevent final size from exceeding original pixels
  suppressErrors: 'none', // 'none' | 'all' | 'local' | 'remote'
})

const defaultDomOptions = Object.freeze({
  ...defaultSharedOptions,
  previewMode: 'output', // output | markdown | local
  previewOutputSrcAttr: 'data-img-output-src', // store final src when previewMode !== output
  setDomSrc: true, // write img.src in DOM
  loadSrcResolver: null, // override loadSrc for size measurement
  loadSrcMap: null, // map markdown src to loadSrc for size measurement
  enableSizeProbe: true, // run image size probing
  awaitSizeProbes: true, // await image load for size calculation
  sizeProbeTimeoutMs: 3000, // timeout for size probe (0 disables)
  onImageProcessed: null, // per-image callback
  readMeta: false, // read meta[name="markdown-frontmatter"]
})

const defaultNodeOptions = Object.freeze({
  ...defaultSharedOptions,
  mdPath: '', // markdown file path for local sizing
  disableRemoteSize: false, // skip remote sizing
  remoteTimeout: 5000, // sync fetch timeout (ms)
  remoteMaxBytes: 16 * 1024 * 1024, // skip large remote images when content-length
  cacheMax: 64, // per-render image data cache size
})

export { defaultSharedOptions, defaultDomOptions, defaultNodeOptions }
