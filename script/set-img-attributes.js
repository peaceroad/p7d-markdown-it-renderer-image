import {
  setImgSize,
  parseFrontmatter,
  getFrontmatter,
  normalizeRelativePath,
  resolveImageBase,
  normalizeResizeValue,
  classifyResizeHint,
  resizeValueReg,
  buildImageExtensionRegExp,
  getScaleSuffixValue,
  normalizeExtensions,
  isHttpUrl,
  isProtocolRelativeUrl,
  isFileUrl,
  hasUrlScheme,
  hasSpecialScheme,
  isAbsolutePath,
  toFileUrl,
  escapeForRegExp,
  stripQueryHash,
  getBasename,
  getImageName,
  applyOutputUrlMode,
} from './img-util.js'
import { defaultSharedOptions, defaultDomOptions, defaultNodeOptions } from './default-options.js'

export { defaultSharedOptions, defaultDomOptions, defaultNodeOptions, classifyResizeHint }

const getAttr = (element, name) => {
  if (!element) return ''
  const value = element.getAttribute ? element.getAttribute(name) : null
  return value == null ? '' : value
}
const hasAttr = (element, name) => {
  if (!element) return false
  if (typeof element.hasAttribute === 'function') return element.hasAttribute(name)
  if (element.attributes && typeof element.attributes.has === 'function') return element.attributes.has(name)
  return element.getAttribute && element.getAttribute(name) != null
}
const setAttrIfChanged = (element, name, value) => {
  if (!element || typeof element.setAttribute !== 'function') return
  const nextValue = String(value)
  if (getAttr(element, name) === nextValue) return
  element.setAttribute(name, nextValue)
}
const removeAttrIfPresent = (element, name) => {
  if (!element || typeof element.removeAttribute !== 'function') return
  if (!hasAttr(element, name)) return
  element.removeAttribute(name)
}
const parseJsonSafe = (value) => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
const originalSrcAttr = 'data-img-src-raw'
const defaultScaleSuffixDataAttr = 'data-img-scale-suffix'
const defaultObservedImgAttributes = Object.freeze(['src', 'title', 'alt'])
const emptyResizeHintInfo = Object.freeze({ state: 'empty', normalizedResizeValue: '' })
const allowedPreviewModes = new Set(['output', 'markdown', 'local'])
const allowedLoadSrcStrategies = new Set(['output', 'raw', 'display'])
const probeCacheByOwner = new WeakMap()
const resizeHintStateByImage = new WeakMap()
const managedSupplementalAttrsByImage = new WeakMap()
const autoHiddenResizeTitleByImage = new WeakMap()
const managedDisplaySrcByImage = new WeakMap()
const createSummary = (total = 0) => ({
  total,
  processed: 0,
  pending: 0,
  sized: 0,
  failed: 0,
  timeout: 0,
  skipped: 0,
})
const emptyProbeResult = Object.freeze({
  status: 'failed',
  naturalWidth: 0,
  naturalHeight: 0,
})
const readPositiveIntAttr = (element, name) => {
  const value = Number(getAttr(element, name))
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value)
}
const safeInvokeHook = (handler, img, info, errorLabel, suppressErrors = false) => {
  if (!handler) return
  try {
    handler(img, info)
  } catch (error) {
    if (!suppressErrors && typeof console !== 'undefined' && console && typeof console.error === 'function') {
      console.error(`[renderer-image(dom)] ${errorLabel} hook failed.`, error)
    }
  }
}
const normalizePrefixMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const entries = []
  for (const [from, to] of Object.entries(value)) {
    if (!from || typeof from !== 'string') continue
    if (typeof to !== 'string') continue
    entries.push([from, to])
  }
  return entries.sort((a, b) => b[0].length - a[0].length)
}
const applyPrefixMap = (value, entries) => {
  const text = String(value || '')
  if (!text || !entries || entries.length === 0) return text
  for (const [from, to] of entries) {
    if (text.startsWith(from)) return to + text.slice(from.length)
  }
  return text
}
const normalizeObserveAttributeFilter = (value) => {
  if (!Array.isArray(value)) return [...defaultObservedImgAttributes]
  const normalized = []
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const attr = entry.trim().toLowerCase()
    if (!attr || seen.has(attr)) continue
    seen.add(attr)
    normalized.push(attr)
  }
  if (normalized.length === 0) return [...defaultObservedImgAttributes]
  return normalized
}
const normalizeNonNegativeNumber = (value, fallback = 0) => {
  if (!Number.isFinite(value) || value < 0) return fallback
  return value
}
const normalizeNonNegativeInt = (value, fallback = 0) => {
  if (!Number.isFinite(value) || value < 0) return fallback
  return Math.floor(value)
}
const hasTagName = (node, lowerName, upperName) => {
  const tag = node && node.tagName
  if (tag === lowerName || tag === upperName) return true
  if (typeof tag !== 'string' || tag.length !== lowerName.length) return false
  return tag.toLowerCase() === lowerName
}
const isImgTag = (node) => {
  return hasTagName(node, 'img', 'IMG')
}
const collectImgFromIterable = (iterable) => {
  const images = []
  for (const node of iterable) {
    if (isImgTag(node)) images.push(node)
  }
  return images
}
const collectImages = (root) => {
  if (!root) return []
  if (Array.isArray(root)) return collectImgFromIterable(root)
  if (isImgTag(root)) return [root]
  if (typeof root.getElementsByTagName === 'function') return Array.from(root.getElementsByTagName('img'))
  if (typeof root.querySelectorAll === 'function') return Array.from(root.querySelectorAll('img'))
  if (typeof root !== 'string' && typeof root[Symbol.iterator] === 'function') return collectImgFromIterable(root)
  return []
}
const resolveOwnerFromItem = (item) => {
  if (!item || (typeof item !== 'object' && typeof item !== 'function')) return null
  if (item.nodeType === 9) return item
  if (item.ownerDocument && typeof item.ownerDocument === 'object') return item.ownerDocument
  if (item.documentElement || item.body) return item
  return null
}
const resolveOwnerFromIterable = (value) => {
  if (!value || typeof value === 'string') return null
  if (Array.isArray(value) || typeof value.length === 'number') {
    for (let index = 0; index < value.length; index += 1) {
      const owner = resolveOwnerFromItem(value[index])
      if (owner) return owner
    }
    return null
  }
  if (typeof value.size === 'number' && value.size > 0 && typeof value.values === 'function') {
    const iterator = value.values()
    if (!iterator || typeof iterator.next !== 'function') return null
    return resolveOwnerFromItem(iterator.next().value)
  }
  return null
}
const resolveCacheOwner = (root) => {
  if (!root || (typeof root !== 'object' && typeof root !== 'function')) return null
  const iterableOwner = resolveOwnerFromIterable(root)
  if (iterableOwner) return iterableOwner
  if (root.nodeType === 9) return root
  if (root.ownerDocument && typeof root.ownerDocument === 'object') return root.ownerDocument
  if (root.documentElement || root.body) return root
  return root
}
const resolveMetaDocument = (root) => {
  const owner = resolveOwnerFromItem(root) || resolveOwnerFromIterable(root)
  if (owner && typeof owner.querySelector === 'function') return owner
  if (typeof document !== 'undefined' && document && typeof document.querySelector === 'function') {
    return document
  }
  return null
}
const resolveMetaObserverTarget = (root) => {
  const doc = resolveMetaDocument(root)
  if (!doc) return null
  const rootNode = root?.documentElement || root?.body || root
  if (doc === rootNode || doc.documentElement === rootNode) return null
  if (doc.head && doc.head !== rootNode) return doc.head
  const metaTag = typeof doc.querySelector === 'function'
    ? doc.querySelector('meta[name="markdown-frontmatter"]')
    : null
  if (metaTag?.parentNode && metaTag.parentNode !== rootNode) return metaTag.parentNode
  return null
}
const createProbeCacheState = () => ({
  entries: new Map(),
  inFlight: new Map(),
})
const normalizeProbeTimeoutKeyPart = (value) => {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return String(Math.floor(value))
}
const getProbeCacheKeys = (loadSrc, timeoutMs) => {
  const normalizedSrc = String(loadSrc || '')
  const timeoutPart = normalizeProbeTimeoutKeyPart(timeoutMs)
  return {
    successKey: `success:${normalizedSrc}`,
    negativeKey: `negative:${timeoutPart}:${normalizedSrc}`,
    inFlightKey: `flight:${timeoutPart}:${normalizedSrc}`,
  }
}
const getProbeCacheState = (context, root, images = null) => {
  if (!context || !context.opt) return null
  if (context.opt.probeCacheMaxEntries <= 0) {
    if (!context.probeRuntimeState) context.probeRuntimeState = createProbeCacheState()
    return context.probeRuntimeState
  }
  let owner = context.probeCacheOwner
  if (!owner) {
    owner = resolveOwnerFromIterable(images)
    if (!owner) owner = resolveCacheOwner(root)
    if (owner) context.probeCacheOwner = owner
  }
  if (owner && (typeof owner === 'object' || typeof owner === 'function')) {
    let state = probeCacheByOwner.get(owner)
    if (!state) {
      state = createProbeCacheState()
      probeCacheByOwner.set(owner, state)
    }
    return state
  }
  if (!context.probeCacheState) context.probeCacheState = createProbeCacheState()
  return context.probeCacheState
}
const getCachedProbeResult = (state, keys, ttlConfig, now) => {
  if (!state || !keys || !ttlConfig) return null
  const readEntry = (key) => {
    if (!key) return null
    const cached = state.entries.get(key)
    if (!cached) return null
    const ttlMs = cached.kind === 'success'
      ? ttlConfig.successTtlMs
      : ttlConfig.negativeTtlMs
    const createdAt = cached.createdAt
    if (!Number.isFinite(createdAt) || !Number.isFinite(ttlMs) || ttlMs <= 0 || (createdAt + ttlMs) <= now) {
      state.entries.delete(key)
      return null
    }
    state.entries.delete(key)
    state.entries.set(key, cached)
    return cached.result
  }
  return readEntry(keys.successKey) || readEntry(keys.negativeKey)
}
const setCachedProbeResult = (state, key, result, maxEntries, now) => {
  if (!state || !key || maxEntries <= 0) return
  state.entries.delete(key)
  state.entries.set(key, {
    createdAt: now,
    kind: result?.status === 'sized' ? 'success' : 'negative',
    result,
  })
  while (state.entries.size > maxEntries) {
    const oldestKey = state.entries.keys().next().value
    if (typeof oldestKey === 'undefined') break
    state.entries.delete(oldestKey)
  }
}
const sharedContextUtils = Object.freeze({
  setImgSize,
  normalizeRelativePath,
  normalizeResizeValue,
  classifyResizeHint,
  resizeValueReg,
  normalizeExtensions,
  isHttpUrl,
  isProtocolRelativeUrl,
  isFileUrl,
  hasUrlScheme,
  hasSpecialScheme,
  stripQueryHash,
  getBasename,
  getImageName,
  applyOutputUrlMode,
})
const rendererBooleanOptionKeys = Object.freeze([
  'scaleSuffix',
  'resize',
  'lazyLoad',
  'asyncDecode',
  'resolveSrc',
  'setDomSrc',
  'enableSizeProbe',
  'awaitSizeProbes',
  'suppressNoopWarning',
  'autoHideResizeTitle',
  'keepPreviousDimensionsDuringResizeEdit',
])
const rendererStringOptionKeys = Object.freeze([
  'previewMode',
  'loadSrcStrategy',
  'urlImageBase',
  'outputUrlMode',
  'checkImgExtensions',
  'resizeDataAttr',
  'previewOutputSrcAttr',
  'suppressErrors',
])
const rendererNumberOptionKeys = Object.freeze([
  'sizeProbeTimeoutMs',
  'observeDebounceMs',
  'probeCacheMaxEntries',
  'probeCacheTtlMs',
  'probeNegativeCacheTtlMs',
])
const rendererFunctionOptionKeys = Object.freeze([
  'loadSrcResolver',
  'onImageProcessed',
  'onResizeHintEditingStateChange',
])
const rendererObjectOptionKeys = Object.freeze([
  'loadSrcMap',
  'loadSrcPrefixMap',
])
const rendererArrayOptionKeys = Object.freeze([
  'observeAttributeFilter',
])
const isBooleanOption = (value) => typeof value === 'boolean'
const isStringOption = (value) => typeof value === 'string'
const isNumberOption = (value) => Number.isFinite(value)
const isFunctionOption = (value) => typeof value === 'function'
const isObjectOption = (value) => value && typeof value === 'object' && !Array.isArray(value)
const isArrayOption = (value) => Array.isArray(value)
const rendererOptionSpecs = Object.freeze([
  [rendererBooleanOptionKeys, isBooleanOption],
  [rendererStringOptionKeys, isStringOption],
  [rendererNumberOptionKeys, isNumberOption],
  [rendererFunctionOptionKeys, isFunctionOption],
  [rendererObjectOptionKeys, isObjectOption],
  [rendererArrayOptionKeys, isArrayOption],
])
const applyTypedRendererOptions = (targetOpt, rendererSettings, optionOverrides, keys, isValidValue) => {
  for (const key of keys) {
    if (optionOverrides.has(key)) continue
    const value = rendererSettings[key]
    if (isValidValue(value)) targetOpt[key] = value
  }
}
const applyRendererOptions = (targetOpt, rendererSettings, optionOverrides) => {
  if (!rendererSettings || typeof rendererSettings !== 'object') return
  for (const [keys, isValidValue] of rendererOptionSpecs) {
    applyTypedRendererOptions(targetOpt, rendererSettings, optionOverrides, keys, isValidValue)
  }
}

export const createContext = async (markdownCont = '', option = {}, root = null) => {
  const opt = { ...defaultDomOptions }
  const safeOption = option && typeof option === 'object' ? { ...option } : null
  const seedOption = safeOption ? { ...safeOption } : {}
  if (safeOption && Object.prototype.hasOwnProperty.call(safeOption, 'noUpscale')) {
    delete safeOption.noUpscale
    delete seedOption.noUpscale
  }
  if (safeOption) Object.assign(opt, safeOption)
  const optionOverrides = new Set(safeOption ? Object.keys(safeOption) : [])

  const readMetaFrontmatter = () => {
    if (!opt.readMeta) return null
    const base = resolveMetaDocument(root)
    if (!base || typeof base.querySelector !== 'function') return null
    const metaTag = base.querySelector('meta[name="markdown-frontmatter"]')
    if (!metaTag) return null
    const content = metaTag.getAttribute('content')
    if (!content) return null
    let parsed = parseJsonSafe(content)
    if (!parsed && content.includes('&quot;')) {
      parsed = parseJsonSafe(content.replace(/&quot;/g, '"'))
    }
    return parsed && typeof parsed === 'object' ? parsed : null
  }

  let frontmatter = {}
  if (markdownCont) frontmatter = parseFrontmatter(markdownCont)

  const meta = readMetaFrontmatter()
  let extensionSettings = null
  if (meta) {
    if (meta._extensionSettings && typeof meta._extensionSettings === 'object') {
      extensionSettings = meta._extensionSettings
    }
    const { _extensionSettings, ...frontmatterFromMeta } = meta
    if (Object.keys(frontmatterFromMeta).length > 0) {
      frontmatter = { ...frontmatter, ...frontmatterFromMeta }
    }
  }

  const currentOpt = { ...opt }
  const suppressErrorsOverridden = optionOverrides.has('suppressErrors')
    || (extensionSettings?.rendererImage
      && Object.prototype.hasOwnProperty.call(extensionSettings.rendererImage, 'suppressErrors'))
  const enableSizeProbeOverridden = optionOverrides.has('enableSizeProbe')
    || (extensionSettings?.rendererImage
      && Object.prototype.hasOwnProperty.call(extensionSettings.rendererImage, 'enableSizeProbe'))
  if (extensionSettings) {
    if (extensionSettings.notSetImageElementAttributes || extensionSettings.disableRendererImage) {
      return { skip: true, opt: currentOpt }
    }
    if (extensionSettings.rendererImage) {
      applyRendererOptions(currentOpt, extensionSettings.rendererImage, optionOverrides)
    }
  }
  if (!['none', 'all', 'local', 'remote'].includes(currentOpt.suppressErrors)) {
    console.warn(`[renderer-image(dom)] Invalid suppressErrors value: ${currentOpt.suppressErrors}. Using 'none'.`)
    currentOpt.suppressErrors = 'none'
  }
  const isFileProtocol = typeof location !== 'undefined' && location && location.protocol === 'file:'
  if (!suppressErrorsOverridden && isFileProtocol && currentOpt.suppressErrors === 'none') {
    currentOpt.suppressErrors = 'local'
  }
  if (isFileProtocol && !enableSizeProbeOverridden) {
    currentOpt.enableSizeProbe = false
  }
  if (!allowedPreviewModes.has(currentOpt.previewMode)) {
    console.warn(`[renderer-image(dom)] Invalid previewMode: ${currentOpt.previewMode}. Using 'output'.`)
    currentOpt.previewMode = 'output'
  }
  if (currentOpt.loadSrcStrategy === 'final') currentOpt.loadSrcStrategy = 'output'
  if (!allowedLoadSrcStrategies.has(currentOpt.loadSrcStrategy)) {
    console.warn(`[renderer-image(dom)] Invalid loadSrcStrategy: ${currentOpt.loadSrcStrategy}. Using 'output'.`)
    currentOpt.loadSrcStrategy = 'output'
  }
  if (!Number.isFinite(currentOpt.sizeProbeTimeoutMs) || currentOpt.sizeProbeTimeoutMs < 0) {
    currentOpt.sizeProbeTimeoutMs = 0
  }
  currentOpt.observeDebounceMs = normalizeNonNegativeNumber(currentOpt.observeDebounceMs, 0)
  currentOpt.probeCacheMaxEntries = normalizeNonNegativeInt(currentOpt.probeCacheMaxEntries, 0)
  currentOpt.probeCacheTtlMs = normalizeNonNegativeNumber(currentOpt.probeCacheTtlMs, 0)
  currentOpt.probeNegativeCacheTtlMs = normalizeNonNegativeNumber(currentOpt.probeNegativeCacheTtlMs, 0)
  currentOpt.observeAttributeFilter = normalizeObserveAttributeFilter(currentOpt.observeAttributeFilter)
  if (typeof currentOpt.enableSizeProbe !== 'boolean') {
    currentOpt.enableSizeProbe = true
  }
  const resolveSrcEnabled = currentOpt.resolveSrc

  const resolvedFrontmatter = getFrontmatter(frontmatter) || {}
  const { url, urlimage, urlimagebase, lid, lmd, imageDir, hasImageDir, imageScale, imageScaleResizeValue } = resolvedFrontmatter
  const imageBase = resolveSrcEnabled
    ? resolveImageBase({
      url,
      urlimage,
      urlimagebase: urlimagebase || currentOpt.urlImageBase,
    })
    : ''
  const lidPattern = resolveSrcEnabled && lid
    ? new RegExp('^(?:\\.\\/)?' + escapeForRegExp(lid).replace(/\//g, '\\/'))
    : null
  let adjustedLmd = ''
  if (resolveSrcEnabled && lmd) {
    adjustedLmd = String(lmd).replace(/\\/g, '/')
    if (!isProtocolRelativeUrl(adjustedLmd) && !isFileUrl(adjustedLmd) && !hasUrlScheme(adjustedLmd) && !hasSpecialScheme(adjustedLmd)) {
      if (isAbsolutePath(adjustedLmd)) {
        adjustedLmd = toFileUrl(adjustedLmd)
      }
    }
    if (adjustedLmd && !adjustedLmd.endsWith('/')) adjustedLmd += '/'
  }
  const resizeDataAttr = typeof currentOpt.resizeDataAttr === 'string' && currentOpt.resizeDataAttr.trim()
    ? currentOpt.resizeDataAttr
    : ''
  const resizeOriginDataAttr = resizeDataAttr ? `${resizeDataAttr}-origin` : ''
  const outputSrcAttr = typeof currentOpt.previewOutputSrcAttr === 'string' && currentOpt.previewOutputSrcAttr.trim()
    ? currentOpt.previewOutputSrcAttr
    : ''
  const imgExtReg = buildImageExtensionRegExp(currentOpt.checkImgExtensions)
  const loadSrcResolver = typeof currentOpt.loadSrcResolver === 'function' ? currentOpt.loadSrcResolver : null
  const loadSrcMap = currentOpt.loadSrcMap && typeof currentOpt.loadSrcMap === 'object'
    ? currentOpt.loadSrcMap
    : null
  const loadSrcPrefixEntries = normalizePrefixMap(currentOpt.loadSrcPrefixMap)
  const onImageProcessed = typeof currentOpt.onImageProcessed === 'function' ? currentOpt.onImageProcessed : null

  return {
    opt: currentOpt,
    seedOption,
    observedImgAttributes: new Set(currentOpt.observeAttributeFilter),
    probeCacheOwner: null,
    imageBase,
    lidPattern,
    adjustedLmd,
    imgExtReg,
    resizeDataAttr,
    resizeOriginDataAttr,
    scaleSuffixDataAttr: defaultScaleSuffixDataAttr,
    outputSrcAttr,
    loadSrcResolver,
    loadSrcMap,
    loadSrcPrefixEntries,
    imageDir,
    hasImageDir,
    imageScale,
    imageScaleResizeValue,
    onImageProcessed,
    utils: sharedContextUtils,
  }
}

export const applyImageTransforms = async (root, contextOrOptions = {}, markdownCont = '') => {
  if (!root) throw new Error('[renderer-image(dom)] root element is required')
  const context = contextOrOptions && contextOrOptions.opt
    ? contextOrOptions
    : await createContext(markdownCont, contextOrOptions, root)
  if (context.skip) return createSummary()

  const {
    opt: currentOpt,
    imageBase,
    lidPattern,
    adjustedLmd,
    imgExtReg,
    resizeDataAttr,
    resizeOriginDataAttr,
    scaleSuffixDataAttr,
    outputSrcAttr,
    loadSrcResolver,
    loadSrcMap,
    loadSrcPrefixEntries,
    imageDir,
    hasImageDir,
    imageScale,
    imageScaleResizeValue,
    onImageProcessed,
    utils,
  } = context
  const {
    setImgSize,
    normalizeRelativePath,
    classifyResizeHint,
    resizeValueReg,
    isHttpUrl,
    isProtocolRelativeUrl,
    isFileUrl,
    hasSpecialScheme,
    stripQueryHash,
    getBasename,
    getImageName,
    applyOutputUrlMode,
  } = utils

  const images = collectImages(root)
  const summary = createSummary(images.length)
  if (images.length === 0) return summary
  const probeCacheState = getProbeCacheState(context, root, images)
  const inFlightProbeState = probeCacheState?.inFlight || new Map()
  const probeCacheMaxEntries = currentOpt.probeCacheMaxEntries
  const probeCacheTtlMs = currentOpt.probeCacheTtlMs
  const probeNegativeCacheTtlMs = currentOpt.probeNegativeCacheTtlMs
  const suppressErrorMode = currentOpt.suppressErrors
  const suppressAllErrors = suppressErrorMode === 'all'
  const resolveSrcEnabled = currentOpt.resolveSrc
  const outputUrlMode = currentOpt.outputUrlMode
  const previewMode = currentOpt.previewMode
  const usesStoredOriginalSrc = previewMode !== 'output' && currentOpt.setDomSrc
  const loadSrcStrategy = currentOpt.loadSrcStrategy
  const hasLoadSrcPrefixMap = loadSrcPrefixEntries.length > 0
  const setDomSrc = currentOpt.setDomSrc
  const resizeEnabled = currentOpt.resize
  const scaleSuffixEnabled = currentOpt.scaleSuffix
  const noUpscaleEnabled = currentOpt.noUpscale
  const autoHideResizeTitle = currentOpt.autoHideResizeTitle
  const asyncDecodeEnabled = currentOpt.asyncDecode
  const lazyLoadEnabled = currentOpt.lazyLoad
  const keepPreviousDimensionsDuringResizeEdit = !!(resizeEnabled && currentOpt.keepPreviousDimensionsDuringResizeEdit)
  const enableSizeProbe = currentOpt.enableSizeProbe
  const awaitSizeProbes = currentOpt.awaitSizeProbes
  const hasImageProcessedHook = !!onImageProcessed
  const onResizeHintEditingStateChange = typeof currentOpt.onResizeHintEditingStateChange === 'function'
    ? currentOpt.onResizeHintEditingStateChange
    : null
  const hasResizeHintEditingStateHook = !!(resizeEnabled && onResizeHintEditingStateChange)
  const tracksResizeHintState = !!(resizeEnabled && (keepPreviousDimensionsDuringResizeEdit || hasResizeHintEditingStateHook))
  const suppressLocalByMode = suppressErrorMode === 'local'
  const suppressRemoteByMode = suppressErrorMode === 'remote'

  const emitImageProcessed = (img, status, width, height, loadSrc, finalSrc, displaySrc) => {
    if (!hasImageProcessedHook) return
    safeInvokeHook(onImageProcessed, img, {
      status,
      width,
      height,
      loadSrc,
      finalSrc,
      displaySrc,
    }, 'onImageProcessed', suppressAllErrors)
  }
  const emitResizeHintEditingStateChange = (img, info) => {
    if (!hasResizeHintEditingStateHook) return
    safeInvokeHook(onResizeHintEditingStateChange, img, info, 'onResizeHintEditingStateChange', suppressAllErrors)
  }
  const rememberResizeHintState = (img, state, sizeSrc) => {
    if (!tracksResizeHintState || !img) return
    resizeHintStateByImage.set(img, {
      state,
      sizeSrc: sizeSrc || '',
      width: readPositiveIntAttr(img, 'width'),
      height: readPositiveIntAttr(img, 'height'),
    })
  }
  const applyProbeResultToImage = (img, imgName, resizeTitleForSize, loadSrc, finalSrc, displaySrc, probeResult) => {
    let status = probeResult?.status || 'failed'
    let width = 0
    let height = 0

    if (status === 'sized') {
      const naturalWidth = probeResult?.naturalWidth || 0
      const naturalHeight = probeResult?.naturalHeight || 0
      if (!naturalWidth || !naturalHeight) {
        status = 'failed'
      } else {
        const sized = setImgSize(
          imgName,
          { width: naturalWidth, height: naturalHeight },
          scaleSuffixEnabled,
          resizeEnabled,
          resizeTitleForSize,
          imageScale,
          noUpscaleEnabled
        )
        width = sized.width
        height = sized.height
        setAttrIfChanged(img, 'width', width)
        setAttrIfChanged(img, 'height', height)
      }
    }

    emitImageProcessed(img, status, width, height, loadSrc, finalSrc, displaySrc)
    return status
  }
  const loadImageProbeResult = (loadSrc, suppressLoadErrors) => {
    const timeoutMs = currentOpt.sizeProbeTimeoutMs
    return new Promise((resolve) => {
      let settled = false
      let timeoutId = null
      const done = (status, naturalWidth = 0, naturalHeight = 0) => {
        if (settled) return
        settled = true
        if (timeoutId) clearTimeout(timeoutId)
        resolve({
          status,
          naturalWidth,
          naturalHeight,
        })
      }

      const originalImage = new Image()
      originalImage.onload = () => {
        if (settled) return
        if (!originalImage.naturalWidth || !originalImage.naturalHeight) {
          done('failed')
          return
        }
        done('sized', originalImage.naturalWidth, originalImage.naturalHeight)
      }
      originalImage.onerror = () => {
        if (settled) return
        if (!suppressLoadErrors) {
          console.error(`[renderer-image(dom)] Can't load image: ${loadSrc}`)
        }
        done('failed')
      }

      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          done('timeout')
        }, timeoutMs)
      }

      try {
        originalImage.setAttribute('src', loadSrc)
        if (originalImage.complete) {
          originalImage.onload()
        }
      } catch (error) {
        if (!suppressLoadErrors) console.error(`[renderer-image(dom)] ${loadSrc}`, error)
        done('failed')
      }
    })
  }
  const resolveProbeResult = (loadSrc, suppressLoadErrors) => {
    if (!loadSrc) return Promise.resolve(emptyProbeResult)
    const cacheKeys = getProbeCacheKeys(loadSrc, currentOpt.sizeProbeTimeoutMs)
    if (probeCacheState && probeCacheMaxEntries > 0) {
      const cacheCheckAt = Date.now()
      const cached = getCachedProbeResult(probeCacheState, cacheKeys, {
        successTtlMs: probeCacheTtlMs,
        negativeTtlMs: probeNegativeCacheTtlMs,
      }, cacheCheckAt)
      if (cached) return Promise.resolve(cached)
    }
    const inFlight = inFlightProbeState.get(cacheKeys.inFlightKey)
    if (inFlight) return inFlight

    const promise = loadImageProbeResult(loadSrc, suppressLoadErrors)
      .then((result) => {
        if (probeCacheState && probeCacheMaxEntries > 0) {
          const cacheWriteAt = Date.now()
          setCachedProbeResult(
            probeCacheState,
            result.status === 'sized' ? cacheKeys.successKey : cacheKeys.negativeKey,
            result,
            probeCacheMaxEntries,
            cacheWriteAt
          )
        }
        return result
      })
      .finally(() => {
        inFlightProbeState.delete(cacheKeys.inFlightKey)
      })
    inFlightProbeState.set(cacheKeys.inFlightKey, promise)
    return promise
  }
  const probeImage = (img, loadSrc, sizeSrc, resizeTitleForSize, finalSrc, displaySrc) => {
    const imgName = getImageName(sizeSrc)
    const isRemoteForError = isHttpUrl(loadSrc) || isProtocolRelativeUrl(loadSrc)
    const suppressLoadErrors = suppressAllErrors
      || (isRemoteForError ? suppressRemoteByMode : suppressLocalByMode)

    return resolveProbeResult(loadSrc, suppressLoadErrors)
      .then((probeResult) => applyProbeResultToImage(
        img,
        imgName,
        resizeTitleForSize,
        loadSrc,
        finalSrc,
        displaySrc,
        probeResult
      ))
  }
  const markSkippedImage = (img, loadSrc, finalSrc, displaySrc) => {
    summary.skipped += 1
    emitImageProcessed(img, 'skipped', 0, 0, loadSrc, finalSrc, displaySrc)
  }

  const tasks = awaitSizeProbes ? [] : null

  for (const img of images) {
    if (!img) continue
    if (typeof img.isConnected === 'boolean' && !img.isConnected) {
      summary.skipped += 1
      continue
    }
    summary.processed += 1

    const currentSrcAttr = getAttr(img, 'src')
    const storedOriginalSrc = usesStoredOriginalSrc ? getAttr(img, originalSrcAttr) : ''
    const managedDisplaySrc = usesStoredOriginalSrc ? (managedDisplaySrcByImage.get(img) || '') : ''
    const useStored = usesStoredOriginalSrc && storedOriginalSrc && managedDisplaySrc === currentSrcAttr
    const srcRaw = useStored ? storedOriginalSrc : currentSrcAttr
    const srcBase = stripQueryHash(srcRaw)
    const srcSuffix = srcRaw.slice(srcBase.length)
    const isLocalSrc = !isHttpUrl(srcRaw)
      && !isProtocolRelativeUrl(srcRaw)
      && !isFileUrl(srcRaw)
      && !hasSpecialScheme(srcRaw)

    let src = srcBase
    let finalSrc = ''
    let loadSrc = ''
    let localDisplaySrc = ''

    if (resolveSrcEnabled) {
      if (isLocalSrc) {
        if (lidPattern) src = src.replace(lidPattern, '')

        const localNormalized = normalizeRelativePath(src)
        if (adjustedLmd) {
          localDisplaySrc = adjustedLmd + localNormalized + srcSuffix
          loadSrc = localDisplaySrc
        }

        let nextSrc = localNormalized
        if (imageBase && !localNormalized.startsWith('/')) {
          if (hasImageDir) {
            nextSrc = getBasename(nextSrc)
            if (imageDir) nextSrc = `${imageDir}${nextSrc}`
          }
          nextSrc = `${imageBase}${nextSrc}`
        }
        src = normalizeRelativePath(nextSrc)
      }
    }
    finalSrc = applyOutputUrlMode(src + srcSuffix, outputUrlMode)

    if (!resolveSrcEnabled || !adjustedLmd || !isLocalSrc) {
      loadSrc = finalSrc
    }

    let displaySrc = finalSrc
    if (previewMode === 'markdown' && isLocalSrc) {
      displaySrc = storedOriginalSrc || srcRaw
    }
    if (previewMode === 'local' && isLocalSrc) {
      displaySrc = localDisplaySrc || storedOriginalSrc || srcRaw
    }

    if (loadSrcStrategy === 'raw') {
      loadSrc = srcRaw
    } else if (loadSrcStrategy === 'display') {
      loadSrc = displaySrc
    }
    if (hasLoadSrcPrefixMap) {
      loadSrc = applyPrefixMap(loadSrc, loadSrcPrefixEntries)
    }
    if (loadSrcResolver) {
      try {
        const resolved = loadSrcResolver(srcRaw, {
          finalSrc,
          loadSrc,
          isLocalSrc,
          isRemote: isHttpUrl(loadSrc) || isProtocolRelativeUrl(loadSrc),
        })
        if (typeof resolved === 'string' && resolved) {
          loadSrc = resolved
        }
      } catch (error) {
        if (!suppressAllErrors) {
          console.error('[renderer-image(dom)] loadSrcResolver hook failed.', error)
        }
      }
    } else if (loadSrcMap) {
      const mapped = loadSrcMap[srcRaw] || loadSrcMap[finalSrc]
      if (typeof mapped === 'string' && mapped) {
        loadSrc = mapped
      }
    }

    if (previewMode !== 'output') {
      if (srcRaw) setAttrIfChanged(img, originalSrcAttr, srcRaw)
      if (outputSrcAttr && finalSrc) setAttrIfChanged(img, outputSrcAttr, finalSrc)
    } else {
      removeAttrIfPresent(img, originalSrcAttr)
      if (outputSrcAttr) removeAttrIfPresent(img, outputSrcAttr)
      managedDisplaySrcByImage.delete(img)
    }

    if (setDomSrc) {
      setAttrIfChanged(img, 'src', displaySrc)
      if (previewMode !== 'output') managedDisplaySrcByImage.set(img, displaySrc)
      else managedDisplaySrcByImage.delete(img)
    } else {
      managedDisplaySrcByImage.delete(img)
    }

    const previousResizeHintStateInfo = tracksResizeHintState
      ? (resizeHintStateByImage.get(img) || null)
      : null
    if (!resizeEnabled) {
      resizeHintStateByImage.delete(img)
    }

    const alt = img.alt
    if (alt) setAttrIfChanged(img, 'alt', alt)
    let titleAttr = getAttr(img, 'title')
    const autoHiddenResizeTitle = autoHiddenResizeTitleByImage.get(img) || null
    if (autoHiddenResizeTitle && titleAttr && titleAttr !== autoHiddenResizeTitle.title) {
      autoHiddenResizeTitleByImage.delete(img)
    }
    const storedTitle = resizeDataAttr ? getAttr(img, resizeDataAttr) : ''
    const storedResizeOrigin = resizeOriginDataAttr ? getAttr(img, resizeOriginDataAttr) : ''
    let storedResizeValue = ''
    if (storedTitle) {
      const normalizedStored = String(storedTitle).trim().replace('％', '%').toLowerCase()
      if (resizeValueReg.test(normalizedStored)) storedResizeValue = normalizedStored
    }
    if (!titleAttr && autoHiddenResizeTitle) {
      const restoreAllowed = !resizeEnabled || !autoHideResizeTitle
      const matchesStoredResize = !storedResizeValue || storedResizeValue === autoHiddenResizeTitle.resizeValue
      if (!matchesStoredResize) {
        autoHiddenResizeTitleByImage.delete(img)
      } else if (restoreAllowed) {
        titleAttr = autoHiddenResizeTitle.title
        setAttrIfChanged(img, 'title', titleAttr)
      }
    }
    const resizeHintInfo = resizeEnabled
      ? classifyResizeHint(titleAttr)
      : emptyResizeHintInfo
    const resizeHintState = resizeHintInfo.state
    const titleResizeValue = resizeEnabled && resizeHintState === 'valid'
      ? resizeHintInfo.normalizedResizeValue
      : ''
    if (hasResizeHintEditingStateHook) {
      const previousState = previousResizeHintStateInfo ? previousResizeHintStateInfo.state : null
      if (previousState !== resizeHintState) {
        const previousSize = previousResizeHintStateInfo
          && previousResizeHintStateInfo.width > 0
          && previousResizeHintStateInfo.height > 0
          ? {
            width: previousResizeHintStateInfo.width,
            height: previousResizeHintStateInfo.height,
          }
          : null
        emitResizeHintEditingStateChange(img, {
          state: resizeHintState,
          previousState,
          title: titleAttr,
          normalizedResizeValue: resizeHintState === 'valid' ? resizeHintInfo.normalizedResizeValue : '',
          previousSize,
        })
      }
    }
    const resizeValue = titleResizeValue || (!titleAttr ? storedResizeValue : '')
    const resizeTitleForSize = titleResizeValue
      ? titleAttr
      : (!titleAttr && storedResizeValue ? `resize:${storedResizeValue}` : '')
    const effectiveResizeValue = titleResizeValue
      || imageScaleResizeValue
      || (!titleAttr ? storedResizeValue : '')
    const effectiveResizeOrigin = imageScaleResizeValue
      ? 'imagescale'
      : (!titleAttr && storedResizeValue && storedResizeOrigin === 'imagescale'
        ? storedResizeOrigin
        : '')

    const removeTitle = autoHideResizeTitle && !!titleResizeValue
    if (removeTitle) {
      autoHiddenResizeTitleByImage.set(img, {
        title: titleAttr,
        resizeValue,
      })
      if (resizeDataAttr && resizeValue) setAttrIfChanged(img, resizeDataAttr, resizeValue)
      removeAttrIfPresent(img, 'title')
    } else if (titleAttr) {
      setAttrIfChanged(img, 'title', titleAttr)
      autoHiddenResizeTitleByImage.delete(img)
    }
    if (resizeDataAttr) {
      if (effectiveResizeValue) {
        setAttrIfChanged(img, resizeDataAttr, effectiveResizeValue)
      } else if ((titleAttr && !removeTitle) || (storedTitle && !storedResizeValue) || (!titleAttr && !storedResizeValue)) {
        removeAttrIfPresent(img, resizeDataAttr)
      }
    }
    if (resizeOriginDataAttr) {
      if (effectiveResizeValue && effectiveResizeOrigin) {
        setAttrIfChanged(img, resizeOriginDataAttr, effectiveResizeOrigin)
      } else {
        removeAttrIfPresent(img, resizeOriginDataAttr)
      }
    }
    if (!removeTitle && !titleAttr && !storedResizeValue) {
      autoHiddenResizeTitleByImage.delete(img)
    }
    let managedSupplementalState = managedSupplementalAttrsByImage.get(img)
    if (!managedSupplementalState) {
      managedSupplementalState = { decoding: false, loading: false }
    }
    const syncManagedAttr = (attrName, enabled, expectedValue, stateKey) => {
      const currentValue = getAttr(img, attrName)
      if (enabled) {
        if (!currentValue) {
          setAttrIfChanged(img, attrName, expectedValue)
          managedSupplementalState[stateKey] = true
          return
        }
        if (managedSupplementalState[stateKey] && currentValue !== expectedValue) {
          managedSupplementalState[stateKey] = false
        }
        return
      }
      if (managedSupplementalState[stateKey]) {
        if (currentValue === expectedValue) {
          removeAttrIfPresent(img, attrName)
        }
        managedSupplementalState[stateKey] = false
      }
    }
    syncManagedAttr('decoding', asyncDecodeEnabled, 'async', 'decoding')
    syncManagedAttr('loading', lazyLoadEnabled, 'lazy', 'loading')
    if (managedSupplementalState.decoding || managedSupplementalState.loading) {
      managedSupplementalAttrsByImage.set(img, managedSupplementalState)
    } else {
      managedSupplementalAttrsByImage.delete(img)
    }

    const sizeSrc = finalSrc || srcRaw || loadSrc
    const scaleSuffixValue = scaleSuffixEnabled ? getScaleSuffixValue(getImageName(sizeSrc)) : ''
    if (scaleSuffixDataAttr) {
      if (scaleSuffixValue) setAttrIfChanged(img, scaleSuffixDataAttr, scaleSuffixValue)
      else removeAttrIfPresent(img, scaleSuffixDataAttr)
    }
    let shouldKeepPendingDimensions = false
    if (
      keepPreviousDimensionsDuringResizeEdit
      && resizeHintState === 'pending'
      && previousResizeHintStateInfo
      && previousResizeHintStateInfo.sizeSrc === sizeSrc
    ) {
      const currentWidth = readPositiveIntAttr(img, 'width')
      const currentHeight = readPositiveIntAttr(img, 'height')
      shouldKeepPendingDimensions = currentWidth > 0 && currentHeight > 0
    }
    if (shouldKeepPendingDimensions) {
      markSkippedImage(img, loadSrc, finalSrc, displaySrc)
      rememberResizeHintState(img, resizeHintState, sizeSrc)
      continue
    }
    if (!sizeSrc || !imgExtReg.test(sizeSrc)) {
      markSkippedImage(img, loadSrc, finalSrc, displaySrc)
      rememberResizeHintState(img, resizeHintState, sizeSrc)
      continue
    }
    if (!enableSizeProbe) {
      markSkippedImage(img, loadSrc, finalSrc, displaySrc)
      rememberResizeHintState(img, resizeHintState, sizeSrc)
      continue
    }

    const promise = probeImage(img, loadSrc, sizeSrc, resizeTitleForSize, finalSrc, displaySrc).then((status) => {
      if (status === 'sized') summary.sized += 1
      else if (status === 'timeout') summary.timeout += 1
      else if (status === 'failed') summary.failed += 1
      else summary.skipped += 1
      rememberResizeHintState(img, resizeHintState, sizeSrc)
      return status
    })
    summary.pending += 1
    if (tasks) tasks.push(promise)
    else promise.catch(() => {})
  }

  if (tasks) {
    await Promise.allSettled(tasks)
    summary.pending = 0
  }

  return summary
}

export const startObserver = async (root, contextOrOptions = {}, markdownCont = '') => {
  if (!root) throw new Error('[renderer-image(dom)] root element is required')
  if (typeof MutationObserver !== 'function') {
    return { disconnect: () => {} }
  }
  const contextSeedOptions = contextOrOptions && contextOrOptions.opt
    ? (contextOrOptions.seedOption || contextOrOptions.opt)
    : contextOrOptions

  let context = contextOrOptions && contextOrOptions.opt
    ? contextOrOptions
    : await createContext(markdownCont, contextSeedOptions, root)

  let disposed = false
  let frameScheduled = false
  let frameHandle = null
  let frameUsesTimeout = false
  let debounceHandle = null
  let running = false
  let pending = false
  let pendingAll = false
  const pendingImages = new Set()
  const rootNode = root.documentElement || root.body || root
  const metaObserverTarget = resolveMetaObserverTarget(root)
  const observerOptionsBase = {
    childList: true,
    subtree: true,
    attributes: true,
  }
  let observer = null
  let observerAttributeFilter = []
  let observedImgAttributes = context?.observedImgAttributes instanceof Set
    ? context.observedImgAttributes
    : new Set(normalizeObserveAttributeFilter(context?.opt?.observeAttributeFilter))
  let observeDebounceMs = normalizeNonNegativeNumber(context?.opt?.observeDebounceMs, 0)
  const hasSameObserverFilter = (current, next) => {
    if (current.length !== next.length) return false
    const currentSet = new Set(current)
    for (const item of next) {
      if (!currentSet.has(item)) return false
    }
    return true
  }
  const getObserverAttributeFilter = () => {
    const filter = Array.from(observedImgAttributes)
    if (context?.opt?.readMeta && !filter.includes('content')) filter.push('content')
    return filter
  }
  const observeTarget = (target) => {
    if (!target) return
    observer.observe(target, {
      ...observerOptionsBase,
      attributeFilter: observerAttributeFilter,
    })
  }
  const observeTargets = () => {
    observeTarget(rootNode)
    if (context?.opt?.readMeta && metaObserverTarget && metaObserverTarget !== rootNode) {
      observeTarget(metaObserverTarget)
    }
  }
  const reconnectObserverIfNeeded = () => {
    if (!observer) return
    const nextFilter = getObserverAttributeFilter()
    if (hasSameObserverFilter(observerAttributeFilter, nextFilter)) return
    observerAttributeFilter = nextFilter
    observer.disconnect()
    observeTargets()
  }
  const refreshObserverConfig = () => {
    observedImgAttributes = context?.observedImgAttributes instanceof Set
      ? context.observedImgAttributes
      : new Set(normalizeObserveAttributeFilter(context?.opt?.observeAttributeFilter))
    observeDebounceMs = normalizeNonNegativeNumber(context?.opt?.observeDebounceMs, 0)
  }

  const runProcess = async () => {
    if (disposed) return
    if (running) {
      pending = true
      return
    }
    running = true
    try {
      do {
        if (disposed) break
        pending = false
        const useAll = pendingAll
        const targets = useAll ? root : Array.from(pendingImages)
        pendingAll = false
        pendingImages.clear()
        if (!useAll && targets.length === 0) continue
        if (!context || !context.opt) {
          context = await createContext(markdownCont, contextSeedOptions, root)
          refreshObserverConfig()
          reconnectObserverIfNeeded()
        }
        await applyImageTransforms(targets, context)
      } while (pending)
    } finally {
      running = false
    }
  }

  const scheduleFrameProcess = () => {
    if (disposed || frameScheduled) return
    frameScheduled = true
    const run = () => {
      frameScheduled = false
      frameHandle = null
      if (disposed) return
      runProcess().catch((error) => {
        if (context?.opt?.suppressErrors !== 'all') {
          console.error('[renderer-image(dom)] MutationObserver processing failed.', error)
        }
      })
    }
    if (typeof requestAnimationFrame === 'function') {
      frameUsesTimeout = false
      frameHandle = requestAnimationFrame(run)
    } else {
      frameUsesTimeout = true
      frameHandle = setTimeout(run, 50)
    }
  }
  const scheduleProcess = () => {
    if (disposed) return
    if (observeDebounceMs > 0) {
      if (debounceHandle) clearTimeout(debounceHandle)
      debounceHandle = setTimeout(() => {
        debounceHandle = null
        scheduleFrameProcess()
      }, observeDebounceMs)
      return
    }
    scheduleFrameProcess()
  }

  const isElementNode = (node) => node && node.nodeType === 1
  const isMetaNode = (node) => {
    if (!context?.opt?.readMeta || !isElementNode(node)) return false
    return hasTagName(node, 'meta', 'META') && node.getAttribute('name') === 'markdown-frontmatter'
  }
  const isImageNode = (node) => isElementNode(node) && isImgTag(node)

  const collectImagesFromNodes = (nodes) => {
    if (!nodes) return
    for (const node of nodes) {
      if (!isElementNode(node)) continue
      if (isImageNode(node)) {
        pendingImages.add(node)
        continue
      }
      if (node.querySelectorAll) {
        const images = typeof node.getElementsByTagName === 'function'
          ? node.getElementsByTagName('img')
          : node.querySelectorAll('img')
        for (const image of images) pendingImages.add(image)
      }
    }
  }

  const hasMetaInNodes = (nodes) => {
    if (!context?.opt?.readMeta || !nodes) return false
    for (const node of nodes) {
      if (!isElementNode(node)) continue
      if (isMetaNode(node)) return true
      if (node.querySelector && node.querySelector('meta[name="markdown-frontmatter"]')) return true
    }
    return false
  }

  observer = new MutationObserver((mutations) => {
    if (disposed) return
    let shouldSchedule = false
    let metaChanged = false
    for (const mutation of mutations) {
      if (!mutation) continue
      if (mutation.type === 'attributes') {
        const target = mutation.target
        const attributeName = typeof mutation.attributeName === 'string'
          ? mutation.attributeName.toLowerCase()
          : ''
        if (isImageNode(target) && observedImgAttributes.has(attributeName)) {
          pendingImages.add(target)
          shouldSchedule = true
          continue
        }
        if (isMetaNode(target) && attributeName === 'content') {
          metaChanged = true
          shouldSchedule = true
          continue
        }
        continue
      }
      if (mutation.type !== 'childList') continue
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        collectImagesFromNodes(mutation.addedNodes)
        if (pendingImages.size > 0) shouldSchedule = true
        if (hasMetaInNodes(mutation.addedNodes)) {
          metaChanged = true
          shouldSchedule = true
        }
      }
      if (mutation.removedNodes && mutation.removedNodes.length > 0) {
        if (hasMetaInNodes(mutation.removedNodes)) {
          metaChanged = true
          shouldSchedule = true
        }
      }
    }
    if (metaChanged) {
      pendingAll = true
      pendingImages.clear()
      context = null
    }
    if (shouldSchedule) scheduleProcess()
  })

  observerAttributeFilter = getObserverAttributeFilter()
  observeTargets()

  return {
    disconnect: () => {
      disposed = true
      observer.disconnect()
      if (debounceHandle) {
        clearTimeout(debounceHandle)
        debounceHandle = null
      }
      if (frameHandle != null) {
        if (frameUsesTimeout) {
          clearTimeout(frameHandle)
        } else if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(frameHandle)
        }
        frameHandle = null
      }
      pendingImages.clear()
    },
  }
}

/**
 * High-level helper for live previews.
 * Creates context, applies transforms once, and optionally starts observation.
 */
export const runInPreview = async (setup = {}) => {
  const safeSetup = setup && typeof setup === 'object' ? setup : {}
  const root = safeSetup.root
  if (!root) throw new Error('[renderer-image(dom)] runInPreview requires root.')

  const markdownCont = typeof safeSetup.markdownCont === 'string' ? safeSetup.markdownCont : ''
  const observe = !!safeSetup.observe
  const providedContext = safeSetup.context && safeSetup.context.opt ? safeSetup.context : null

  const option = { ...safeSetup }
  delete option.root
  delete option.markdownCont
  delete option.observe
  delete option.context

  const context = providedContext || await createContext(markdownCont, option, root)
  const summary = await applyImageTransforms(root, context)
  const observer = observe ? await startObserver(root, context, markdownCont) : null
  return { context, summary, observer }
}

/**
 * Applies image transforms to an HTML string using DOMParser.
 * Useful for source views or processing HTML without mounting it to the main DOM.
 */
export const applyImageTransformsToString = async (htmlString, contextOrOptions = {}, markdownCont = '') => {
  if (typeof DOMParser === 'undefined') {
    throw new Error('[renderer-image(dom)] DOMParser is not available.')
  }
  const parser = new DOMParser()
  const doc = parser.parseFromString(String(htmlString || ''), 'text/html')
  await applyImageTransforms(doc.body, contextOrOptions, markdownCont)
  return doc.body.innerHTML
}

let warnedDefaultExport = false
const shouldSuppressNoopWarning = (option) => {
  if (option && option.suppressNoopWarning) return true
  if (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production') return true
  return false
}
const mditRendererImageBrowser = (_md, _option) => {
  if (warnedDefaultExport || shouldSuppressNoopWarning(_option)) return Promise.resolve()
  if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
    console.warn('[renderer-image(dom)] Default export is a no-op in the browser. Use createContext/applyImageTransforms/startObserver/runInPreview instead.')
  }
  warnedDefaultExport = true
  return Promise.resolve()
}

export default mditRendererImageBrowser
