import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import fetch from 'sync-fetch'
import { imageDimensionsFromData } from 'image-dimensions'
import { defaultNodeOptions } from './script/default-options.js'
import { getSvgDimensionsFromData } from './script/svg-dimensions.js'
import {
  setImgSize,
  getFrontmatter,
  normalizeRelativePath,
  resolveImageBase,
  normalizeResizeValue,
  normalizeConditionalResize,
  normalizeOutputUrlMode,
  buildImageExtensionRegExp,
  getImageName,
  getScaleSuffixInfo,
  isHttpUrl,
  isProtocolRelativeUrl,
  isFileUrl,
  hasUriScheme,
  stripQueryHash,
  applyOutputUrlMode,
  safeDecodeUri,
} from './script/img-util.js'

export { defaultSharedOptions, defaultDomOptions, defaultNodeOptions } from './script/default-options.js'
export { classifyResizeHint } from './script/img-util.js'

const globalFailedImgLoads = new Set()
const globalMissingMdPathWarnings = new Set()
const emptyImgData = Object.freeze({})
const globalLogSetMaxEntries = 2048
const yamlFrontmatterFence = '---\n'
const defaultScaleSuffixDataAttr = 'data-img-scale-suffix'
const rendererImageInstalledKey = Symbol.for('@peaceroad/markdown-it-renderer-image/installed')
const initialImageHeaderBytes = 64 * 1024
const localImageHeaderMaxBytes = 512 * 1024
const svgExtensionReg = /\.svg$/i

const parseImageDimensions = (data) => {
  const dimensions = imageDimensionsFromData(data)
  if (!dimensions) return null
  if (
    !Number.isSafeInteger(dimensions.width)
    || !Number.isSafeInteger(dimensions.height)
    || dimensions.width <= 0
    || dimensions.height <= 0
  ) {
    throw new TypeError('Unsupported or invalid image data')
  }
  return dimensions
}
const getImageDimensionParser = (src) => (
  svgExtensionReg.test(stripQueryHash(src))
    ? getSvgDimensionsFromData
    : parseImageDimensions
)
const getImageDimensions = (data, parseDimensions) => {
  const initialData = data.byteLength > initialImageHeaderBytes
    ? data.subarray(0, initialImageHeaderBytes)
    : data
  const dimensions = parseDimensions(initialData)
    || (initialData === data ? null : parseDimensions(data))
  if (!dimensions) throw new TypeError('Unsupported or invalid image data')
  return dimensions
}
const readImageBytes = (file, bytes, offset, targetLength) => {
  while (offset < targetLength) {
    const bytesRead = fs.readSync(file, bytes, offset, targetLength - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return offset
}
const getLocalImageDimensions = (src) => {
  const parseDimensions = getImageDimensionParser(src)
  const file = fs.openSync(src, 'r')
  try {
    const fileSize = fs.fstatSync(file).size
    const maxByteLength = Math.min(fileSize, localImageHeaderMaxBytes)
    if (maxByteLength <= 0) throw new TypeError('Empty image data')

    const initialLength = Math.min(maxByteLength, initialImageHeaderBytes)
    let bytes = Buffer.allocUnsafe(initialLength)
    let offset = readImageBytes(file, bytes, 0, initialLength)
    let dimensions = parseDimensions(bytes.subarray(0, offset))
    if (!dimensions && offset === initialLength && initialLength < maxByteLength) {
      const expandedBytes = Buffer.allocUnsafe(maxByteLength)
      bytes.copy(expandedBytes, 0, 0, offset)
      bytes = expandedBytes
      offset = readImageBytes(file, bytes, offset, maxByteLength)
      dimensions = parseDimensions(bytes.subarray(0, offset))
    }
    if (!dimensions) throw new TypeError('Unsupported or invalid image data')
    return dimensions
  } finally {
    fs.closeSync(file)
  }
}

const getRemoteFetchTargets = (value) => {
  if (!isProtocolRelativeUrl(value)) return [value]
  return [`https:${value}`, `http:${value}`]
}
const getRemoteFailureMessage = (src, failure) => {
  const triedMultipleSchemes = isProtocolRelativeUrl(src)
  if (!triedMultipleSchemes && failure?.type === 'status') {
    return `[renderer-image] Can't load image (HTTP ${failure.status}): ${src}`
  }
  if (triedMultipleSchemes) {
    return `[renderer-image] Can't load image: ${src} (tried https and http)`
  }
  return `[renderer-image] Can't load image: ${src}`
}
const getRemoteImgData = (src, timeout, remoteMaxBytes) => {
  const targets = getRemoteFetchTargets(src)
  const parseDimensions = getImageDimensionParser(src)
  let lastFailure = null
  for (const target of targets) {
    try {
      const response = fetch(target, timeout ? { timeout } : undefined)
      const responseStatus = typeof response?.status === 'number' ? response.status : 200
      if (responseStatus < 200 || responseStatus >= 300) {
        lastFailure = { type: 'status', status: responseStatus }
        continue
      }
      const contentLength = Number(response?.headers?.get?.('content-length'))
      if (Number.isFinite(contentLength) && remoteMaxBytes && contentLength > remoteMaxBytes) {
        return { type: 'too-large', contentLength }
      }
      try {
        const buffer = response.buffer()
        if (remoteMaxBytes && buffer.length > remoteMaxBytes) {
          return { type: 'too-large', contentLength: buffer.length }
        }
        return { type: 'success', data: getImageDimensions(buffer, parseDimensions) }
      } catch {
        lastFailure = { type: 'decode' }
      }
    } catch {
      lastFailure = { type: 'fetch' }
    }
  }
  return lastFailure || { type: 'fetch' }
}
const addToBoundedSet = (set, key, maxEntries = globalLogSetMaxEntries) => {
  if (!set || set.has(key)) return
  set.add(key)
  if (maxEntries > 0 && set.size > maxEntries) {
    const oldest = set.values().next().value
    if (typeof oldest !== 'undefined') set.delete(oldest)
  }
}
const shouldLogLoadError = (cacheKey, failedSet, suppressLoadErrors, suppressByType) => (
  !suppressLoadErrors
  && !suppressByType
  && !failedSet.has(cacheKey)
  && !globalFailedImgLoads.has(cacheKey)
)
const markLoadErrorLogged = (cacheKey, failedSet) => {
  failedSet.add(cacheKey)
  addToBoundedSet(globalFailedImgLoads, cacheKey)
}
const setCache = (cache, key, value, maxEntries) => {
  if (maxEntries === 0) return
  cache.set(key, value)
  if (maxEntries && cache.size > maxEntries) {
    const firstKey = cache.keys().next().value
    cache.delete(firstKey)
  }
}
const normalizeNonNegativeNumberOption = (value, fallback, name, integer = false) => {
  if (Number.isFinite(value) && value >= 0) {
    return integer ? Math.floor(value) : value
  }
  console.warn(`[renderer-image] Invalid ${name} value: ${value}. Using ${fallback}.`)
  return fallback
}
const hasOwnEnumerableKeys = (value) => {
  if (!value || typeof value !== 'object') return false
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true
  }
  return false
}
const sourceStartsWithFrontmatter = (value) => {
  return typeof value === 'string' && (value === '---' || value.startsWith(yamlFrontmatterFence))
}
const resolveRenderFrontmatter = (state, md) => {
  const env = state?.env
  if (env && Object.prototype.hasOwnProperty.call(env, 'frontmatter')) {
    return env.frontmatter
  }
  // Fall back to md-scoped metadata only for documents that actually look like
  // they carry YAML frontmatter in this render, to avoid cross-render leakage.
  if (!sourceStartsWithFrontmatter(state?.src)) return null
  if (hasOwnEnumerableKeys(md?.frontmatter)) return md.frontmatter
  if (hasOwnEnumerableKeys(md?.meta)) return md.meta
  return null
}

const resolveMdDir = (value) => {
  if (!value) return ''
  let text = String(value)
  if (isFileUrl(text)) {
    try {
      text = fileURLToPath(text)
    } catch {
      return ''
    }
  }
  try {
    const stat = fs.statSync(text)
    return stat.isDirectory() ? text : path.dirname(text)
  } catch {
    // fall back to heuristics when the path does not exist
  }
  if (/[\\/]$/.test(text)) return text.replace(/[\\/]+$/, '')
  if (path.extname(text)) return path.dirname(text)
  return text
}

const getLocalImgSrc = (imgSrc, mdDir) => {
  if (!imgSrc) return ''
  if (isFileUrl(imgSrc)) {
    try {
      return fileURLToPath(imgSrc)
    } catch {
      return ''
    }
  }
  if (mdDir === '') return ''
  const cleanSrc = stripQueryHash(imgSrc)
  const decodedSrc = safeDecodeUri(cleanSrc)
  return path.resolve(mdDir, decodedSrc.replace(/[/\\]/g, path.sep))
}

const getImgData = (src, isRemote, timeout, cache, cacheMax, failedSet, suppressLoadErrors, suppressLocalErrors, suppressRemoteErrors, remoteMaxBytes) => {
  const cacheKey = `${isRemote ? 'remote' : 'local'}:${src}`
  if (cacheMax !== 0) {
    const cached = cache.get(cacheKey)
    if (cached !== undefined) return cached
  }
  if (isRemote) {
    const remoteResult = getRemoteImgData(src, timeout, remoteMaxBytes)
    if (remoteResult.type === 'too-large') {
      if (shouldLogLoadError(cacheKey, failedSet, suppressLoadErrors, suppressRemoteErrors)) {
        console.error(`[renderer-image] Skip image (too large: ${remoteResult.contentLength} bytes): ${src}`)
        markLoadErrorLogged(cacheKey, failedSet)
      }
      setCache(cache, cacheKey, emptyImgData, cacheMax)
      return emptyImgData
    }
    if (remoteResult.type !== 'success') {
      if (shouldLogLoadError(cacheKey, failedSet, suppressLoadErrors, suppressRemoteErrors)) {
        console.error(getRemoteFailureMessage(src, remoteResult))
        markLoadErrorLogged(cacheKey, failedSet)
      }
      setCache(cache, cacheKey, emptyImgData, cacheMax)
      return emptyImgData
    }
    const data = remoteResult.data
    setCache(cache, cacheKey, data, cacheMax)
    return data
  }
  try {
    const data = getLocalImageDimensions(src)
    setCache(cache, cacheKey, data, cacheMax)
    return data
  } catch {
    if (shouldLogLoadError(cacheKey, failedSet, suppressLoadErrors, suppressLocalErrors)) {
      console.error("[renderer-image] Can't load image: " + src)
      markLoadErrorLogged(cacheKey, failedSet)
    }
    setCache(cache, cacheKey, emptyImgData, cacheMax)
    return emptyImgData
  }
}


const mditRendererImage = (md, option) => {
  const safeOption = option && typeof option === 'object' ? { ...option } : null
  if (safeOption && Object.prototype.hasOwnProperty.call(safeOption, 'noUpscale')) {
    throw new Error('[renderer-image] noUpscale option was removed. Image sizes are always capped to intrinsic dimensions.')
  }
  if (md?.[rendererImageInstalledKey]) {
    console.warn('[renderer-image] Plugin already installed on this markdown-it instance. Create a new instance to use different options.')
    return
  }

  const opt = { ...defaultNodeOptions }
  if (safeOption) Object.assign(opt, safeOption)

  if (!['none', 'all', 'local', 'remote'].includes(opt.suppressErrors)) {
    console.warn(`[renderer-image] Invalid suppressErrors value: ${opt.suppressErrors}. Using 'none'.`)
    opt.suppressErrors = 'none'
  }
  opt.outputUrlMode = normalizeOutputUrlMode(opt.outputUrlMode, (message) => {
    console.warn(`[renderer-image] ${message}`)
  })
  opt.cacheMax = normalizeNonNegativeNumberOption(opt.cacheMax, defaultNodeOptions.cacheMax, 'cacheMax', true)
  opt.remoteTimeout = normalizeNonNegativeNumberOption(opt.remoteTimeout, defaultNodeOptions.remoteTimeout, 'remoteTimeout')
  opt.remoteMaxBytes = normalizeNonNegativeNumberOption(opt.remoteMaxBytes, defaultNodeOptions.remoteMaxBytes, 'remoteMaxBytes')

  const imgExtReg = buildImageExtensionRegExp(opt.checkImgExtensions)
  const remoteSizeEnabled = !opt.disableRemoteSize
  const hasOptMdPath = !!opt.mdPath
  const resolvedOptMdDir = hasOptMdPath ? resolveMdDir(opt.mdPath) : ''
  const suppressErrorMode = opt.suppressErrors
  const suppressLoadErrors = suppressErrorMode === 'all'
  const suppressLocalErrors = suppressErrorMode === 'local' || suppressLoadErrors
  const suppressRemoteErrors = suppressErrorMode === 'remote' || suppressLoadErrors
  const resolveSrcEnabled = opt.resolveSrc
  const outputUrlMode = opt.outputUrlMode
  const hasOptUrlImageBase = !!opt.urlImageBase
  const resizeEnabled = opt.resize
  const autoHideResizeTitle = opt.autoHideResizeTitle
  const asyncDecodeEnabled = opt.asyncDecode
  const lazyLoadEnabled = opt.lazyLoad
  const cacheMax = opt.cacheMax
  const remoteTimeout = opt.remoteTimeout
  const remoteMaxBytes = opt.remoteMaxBytes
  const scaleSuffixEnabled = opt.scaleSuffix
  const conditionalResize = normalizeConditionalResize(opt.conditionalResize, (message) => {
    console.warn(`[renderer-image] ${message}`)
  })
  const resizeDataAttr = typeof opt.resizeDataAttr === 'string' && opt.resizeDataAttr.trim()
    ? opt.resizeDataAttr
    : ''
  const resizeOriginDataAttr = resizeDataAttr ? `${resizeDataAttr}-origin` : ''

  const removeTokenAttr = (token, name) => {
    const index = token.attrIndex(name)
    if (index >= 0) token.attrs.splice(index, 1)
  }

  Object.defineProperty(md, rendererImageInstalledKey, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })

  const processImageToken = (token, fmContext, ensureRenderState, ensureRenderMdDir) => {
    const srcRaw = token.attrGet('src') || ''
    const srcBase = stripQueryHash(srcRaw)
    const srcSuffix = srcRaw.slice(srcBase.length)
    let src = srcBase
    const titleRaw = token.attrGet('title')
    const isProtocolRelative = isProtocolRelativeUrl(srcBase)
    const hasScheme = !isProtocolRelative && hasUriScheme(srcBase)
    const isRemote = isProtocolRelative || (hasScheme && isHttpUrl(srcBase))
    const isFile = hasScheme && isFileUrl(srcBase)
    const isLocal = !isProtocolRelative && !hasScheme

    const {
      parsedFrontmatter,
      imageScale,
      imageScaleResizeValue,
      shouldParseFrontmatter,
      imageBase,
    } = fmContext

    if (resolveSrcEnabled && src && shouldParseFrontmatter) {
      const { lid } = parsedFrontmatter
      if (isLocal) {
        if (lid) {
          if (src.startsWith(lid)) {
            src = src.substring(lid.length)
          } else if (src.startsWith('./') && ('.' + src).startsWith(lid)) {
            src = ('.' + src).substring(lid.length)
          }
        }
        if (imageBase && !src.startsWith('/')) {
          src = `${imageBase}${src}`
        }
        src = normalizeRelativePath(src)
      }
    }

    const resolvedSrc = src + srcSuffix
    const finalSrc = applyOutputUrlMode(safeDecodeUri(resolvedSrc), outputUrlMode)
    const titleResizeValue = resizeEnabled ? normalizeResizeValue(titleRaw) : ''

    const isValidExt = imgExtReg.test(srcBase)
    let imgName = ''
    let scaleSuffixInfo = null
    if (scaleSuffixEnabled) {
      imgName = getImageName(srcBase)
      scaleSuffixInfo = getScaleSuffixInfo(imgName)
    }
    const scaleSuffixValue = scaleSuffixInfo?.value || ''
    if (scaleSuffixValue) token.attrSet(defaultScaleSuffixDataAttr, scaleSuffixValue)
    else removeTokenAttr(token, defaultScaleSuffixDataAttr)

    if (isValidExt) {
      const warningKey = srcBase || srcRaw
      let srcPath = ''
      if (isRemote) {
        if (remoteSizeEnabled) {
          srcPath = srcRaw
        }
      } else if (isLocal || isFile) {
        srcPath = getLocalImgSrc(srcBase, isLocal ? ensureRenderMdDir() : '')
      }

      if (!srcPath && isLocal) {
        const { missingMdPathWarnings } = ensureRenderState()
        if (!missingMdPathWarnings.has(warningKey) && !globalMissingMdPathWarnings.has(warningKey)) {
          console.warn(`[renderer-image] Set mdPath in options or env to read local image dimensions: ${srcRaw}`)
          missingMdPathWarnings.add(warningKey)
          addToBoundedSet(globalMissingMdPathWarnings, warningKey)
        }
      }

      let imgData = emptyImgData
      if (srcPath) {
        const { imgDataCache, failedImgLoads } = ensureRenderState()
        imgData = getImgData(
          srcPath,
          isRemote,
          remoteTimeout,
          imgDataCache,
          cacheMax,
          failedImgLoads,
          suppressLoadErrors,
          suppressLocalErrors,
          suppressRemoteErrors,
          remoteMaxBytes
        )
      }

      if (imgData?.width !== undefined) {
        const { width, height } = setImgSize(
          imgName,
          imgData,
          scaleSuffixEnabled,
          resizeEnabled,
          titleRaw,
          imageScale,
          conditionalResize,
          scaleSuffixInfo,
          titleResizeValue
        )
        token.attrSet('width', width)
        token.attrSet('height', height)
      }
    }

    token.attrSet('src', finalSrc)
    token.attrSet('alt', token.content || '')

    const effectiveResizeValue = titleResizeValue || imageScaleResizeValue || ''
    const effectiveResizeOrigin = !titleResizeValue && imageScaleResizeValue ? 'imagescale' : ''
    const removeTitle = autoHideResizeTitle && !!titleResizeValue
    if (titleRaw && !removeTitle) {
      token.attrSet('title', titleRaw)
    } else if (removeTitle) {
      removeTokenAttr(token, 'title')
    }
    if (resizeDataAttr) {
      if (effectiveResizeValue) token.attrSet(resizeDataAttr, effectiveResizeValue)
      else removeTokenAttr(token, resizeDataAttr)
    }
    if (resizeOriginDataAttr) {
      if (effectiveResizeOrigin) token.attrSet(resizeOriginDataAttr, effectiveResizeOrigin)
      else removeTokenAttr(token, resizeOriginDataAttr)
    }
    if (asyncDecodeEnabled) token.attrSet('decoding', 'async')
    if (lazyLoadEnabled) token.attrSet('loading', 'lazy')
  }

  md.core.ruler.after('replacements', 'renderer_image', (state) => {
    const tokens = state.tokens || []
    let renderState = null
    let fmContext = null
    let renderMdDir = resolvedOptMdDir
    let renderMdDirResolved = hasOptMdPath

    const ensureRenderState = () => {
      if (renderState) return renderState
      renderState = {
        imgDataCache: new Map(),
        failedImgLoads: new Set(),
        missingMdPathWarnings: new Set(),
      }
      return renderState
    }

    const ensureRenderMdDir = () => {
      if (renderMdDirResolved) return renderMdDir
      const envMdPath = state?.env?.mdPath
      renderMdDir = envMdPath ? resolveMdDir(envMdPath) : ''
      renderMdDirResolved = true
      return renderMdDir
    }

    const ensureFrontmatterContext = () => {
      if (fmContext) return fmContext
      const frontmatter = resolveRenderFrontmatter(state, md)
      const hasFrontmatter = hasOwnEnumerableKeys(frontmatter)
      const shouldParseFrontmatter = hasFrontmatter || hasOptUrlImageBase
      const parsedFrontmatter = hasFrontmatter
        ? (getFrontmatter(frontmatter || {}, {
          onWarning: (message) => console.warn(`[renderer-image] ${message}`),
        }) || {})
        : {}
      const imageScale = shouldParseFrontmatter ? parsedFrontmatter.imageScale : null
      const imageScaleResizeValue = shouldParseFrontmatter ? parsedFrontmatter.imageScaleResizeValue : ''
      const imageBase = shouldParseFrontmatter
        ? resolveImageBase({
          url: parsedFrontmatter.url,
          urlimage: parsedFrontmatter.urlimage,
          urlimagebase: parsedFrontmatter.urlimagebase || opt.urlImageBase,
        })
        : ''

      fmContext = {
        shouldParseFrontmatter,
        parsedFrontmatter,
        imageScale,
        imageScaleResizeValue,
        imageBase,
      }
      return fmContext
    }

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex]
      if (token.type !== 'inline' || !token.children) continue
      const children = token.children
      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const child = children[childIndex]
        if (child.type === 'image') {
          processImageToken(child, ensureFrontmatterContext(), ensureRenderState, ensureRenderMdDir)
        }
      }
    }
  })
}

export default mditRendererImage

const browserOnlyApi = (name) => {
  throw new Error(`[renderer-image] ${name} is a browser-only API. Import it from ./script/set-img-attributes.js and call it in the browser.`)
}

export const createContext = async () => browserOnlyApi('createContext')
export const applyImageTransforms = async () => browserOnlyApi('applyImageTransforms')
export const startObserver = async () => browserOnlyApi('startObserver')
export const applyImageTransformsToString = async () => browserOnlyApi('applyImageTransformsToString')
export const runInPreview = async () => browserOnlyApi('runInPreview')
