import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import fetch from 'sync-fetch'
import imageSize from 'image-size'
import { defaultSharedOptions, defaultDomOptions, defaultNodeOptions } from './script/default-options.js'
import {
  setImgSize,
  getFrontmatter,
  normalizeRelativePath,
  resolveImageBase,
  normalizeResizeValue,
  normalizeExtensions,
  isHttpUrl,
  isProtocolRelativeUrl,
  isFileUrl,
  hasSpecialScheme,
  stripQueryHash,
  getBasename,
  applyOutputUrlMode,
  safeDecodeUri,
} from './script/img-util.js'

export { defaultSharedOptions, defaultDomOptions, defaultNodeOptions }

const globalFailedImgLoads = new Set()
const globalMissingMdPathWarnings = new Set()
const emptyImgData = Object.freeze({})
const globalLogSetMaxEntries = 2048

const toAbsoluteRemote = (value) => (isProtocolRelativeUrl(value) ? `https:${value}` : value)
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
const hasOwnEnumerableKeys = (value) => {
  if (!value || typeof value !== 'object') return false
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true
  }
  return false
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
  if (isProtocolRelativeUrl(imgSrc)) return ''
  if (hasSpecialScheme(imgSrc)) return ''
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
  try {
    let data
    if (isRemote) {
      const response = fetch(src, timeout ? { timeout } : undefined)
      const responseStatus = typeof response?.status === 'number' ? response.status : 200
      if (responseStatus < 200 || responseStatus >= 300) {
        const suppressByType = suppressRemoteErrors
        if (shouldLogLoadError(cacheKey, failedSet, suppressLoadErrors, suppressByType)) {
          console.error(`[renderer-image] Can't load image (HTTP ${responseStatus}): ${src}`)
          markLoadErrorLogged(cacheKey, failedSet)
        }
        setCache(cache, cacheKey, emptyImgData, cacheMax)
        return emptyImgData
      }
      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && remoteMaxBytes && contentLength > remoteMaxBytes) {
        const suppressByType = suppressRemoteErrors
        if (shouldLogLoadError(cacheKey, failedSet, suppressLoadErrors, suppressByType)) {
          console.error(`[renderer-image] Skip image (too large: ${contentLength} bytes): ${src}`)
          markLoadErrorLogged(cacheKey, failedSet)
        }
        setCache(cache, cacheKey, emptyImgData, cacheMax)
        return emptyImgData
      }
      data = imageSize(response.buffer())
    } else {
      data = imageSize(src)
    }
    setCache(cache, cacheKey, data, cacheMax)
    return data
  } catch {
    const suppressByType = isRemote ? suppressRemoteErrors : suppressLocalErrors
    if (shouldLogLoadError(cacheKey, failedSet, suppressLoadErrors, suppressByType)) {
      console.error("[renderer-image] Can't load image: " + src)
      markLoadErrorLogged(cacheKey, failedSet)
    }
    setCache(cache, cacheKey, emptyImgData, cacheMax)
    return emptyImgData
  }
}


const mditRendererImage = (md, option) => {
  const opt = { ...defaultNodeOptions }
  const safeOption = option && typeof option === 'object' ? { ...option } : null
  if (safeOption && Object.prototype.hasOwnProperty.call(safeOption, 'noUpscale')) {
    delete safeOption.noUpscale
  }
  if (safeOption) Object.assign(opt, safeOption)

  if (!['none', 'all', 'local', 'remote'].includes(opt.suppressErrors)) {
    console.warn(`[renderer-image] Invalid suppressErrors value: ${opt.suppressErrors}. Using 'none'.`)
    opt.suppressErrors = 'none'
  }

  const extPattern = normalizeExtensions(opt.checkImgExtensions).join('|')
  const imgExtReg = extPattern
    ? new RegExp('\\.(?:' + extPattern + ')(?=$|[?#])', 'i')
    : /a^/
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
  const noUpscale = opt.noUpscale
  const resizeDataAttr = typeof opt.resizeDataAttr === 'string' && opt.resizeDataAttr.trim()
    ? opt.resizeDataAttr
    : ''

  const removeTokenAttr = (token, name) => {
    const index = token.attrIndex(name)
    if (index >= 0) token.attrs.splice(index, 1)
  }

  const processImageToken = (token, state, fmContext) => {
    const { imgDataCache, failedImgLoads, missingMdPathWarnings } = state

    const srcRaw = token.attrGet('src') || ''
    const srcBase = stripQueryHash(srcRaw)
    const srcSuffix = srcRaw.slice(srcBase.length)
    let src = srcBase
    const titleRaw = token.attrGet('title')
    const warningKey = srcBase || srcRaw

    const {
      parsedFrontmatter,
      imageScale,
      shouldParseFrontmatter,
      mdDir,
      imageBase,
    } = fmContext

    if (resolveSrcEnabled && src && shouldParseFrontmatter) {
      const { lid, imageDir, hasImageDir } = parsedFrontmatter
      const isLocalSrc = !isHttpUrl(src) && !isProtocolRelativeUrl(src) && !isFileUrl(src) && !hasSpecialScheme(src)

      if (isLocalSrc) {
        if (lid) {
          if (src.startsWith(lid)) {
            src = src.substring(lid.length)
          } else if (src.startsWith('./') && ('.' + src).startsWith(lid)) {
            src = ('.' + src).substring(lid.length)
          }
        }
        if (imageBase && !src.startsWith('/')) {
          let nextSrc = src
          if (hasImageDir) {
            nextSrc = getBasename(nextSrc)
            if (imageDir) nextSrc = `${imageDir}${nextSrc}`
          }
          src = `${imageBase}${nextSrc}`
        }
        src = normalizeRelativePath(src)
      }
    }

    const resolvedSrc = src + srcSuffix
    const finalSrc = applyOutputUrlMode(safeDecodeUri(resolvedSrc), outputUrlMode)

    const isValidExt = imgExtReg.test(srcBase)
    const isRemote = isHttpUrl(srcBase) || isProtocolRelativeUrl(srcBase)
    const isFile = isFileUrl(srcBase)

    if (isValidExt) {
      let srcPath = ''
      if (isRemote) {
        if (remoteSizeEnabled) {
          srcPath = toAbsoluteRemote(srcRaw)
        }
      } else {
        srcPath = getLocalImgSrc(srcBase, mdDir)
      }

      if (!srcPath && !isRemote && !isFile && !missingMdPathWarnings.has(warningKey) && !globalMissingMdPathWarnings.has(warningKey)) {
        console.warn(`[renderer-image] Set mdPath in options or env to read local image dimensions: ${srcRaw}`)
        missingMdPathWarnings.add(warningKey)
        addToBoundedSet(globalMissingMdPathWarnings, warningKey)
      }

      const imgData = srcPath
        ? getImgData(
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
        : emptyImgData

      if (imgData?.width !== undefined) {
        const imgName = path.basename(srcBase, path.extname(srcBase))
        const { width, height } = setImgSize(imgName, imgData, scaleSuffixEnabled, resizeEnabled, titleRaw, imageScale, noUpscale)
        token.attrSet('width', width)
        token.attrSet('height', height)
      }
    }

    token.attrSet('src', finalSrc)
    token.attrSet('alt', token.content || '')

    const resizeValue = resizeEnabled ? normalizeResizeValue(titleRaw) : ''
    const removeTitle = autoHideResizeTitle && !!resizeValue
    if (titleRaw && !removeTitle) {
      token.attrSet('title', titleRaw)
    } else if (removeTitle) {
      if (resizeDataAttr && resizeValue) {
        token.attrSet(resizeDataAttr, resizeValue)
      }
      removeTokenAttr(token, 'title')
    }
    if (isValidExt && asyncDecodeEnabled) token.attrSet('decoding', 'async')
    if (isValidExt && lazyLoadEnabled) token.attrSet('loading', 'lazy')
  }

  md.core.ruler.after('replacements', 'renderer_image', (state) => {
    const renderState = {
      imgDataCache: new Map(),
      failedImgLoads: new Set(),
      missingMdPathWarnings: new Set(),
    }
    const env = state?.env || {}
    const mdDir = hasOptMdPath
      ? resolvedOptMdDir
      : (env?.mdPath ? resolveMdDir(env.mdPath) : '')
    const frontmatter = env?.frontmatter || md.env?.frontmatter
    const hasFrontmatter = hasOwnEnumerableKeys(frontmatter)
    const shouldParseFrontmatter = hasFrontmatter || hasOptUrlImageBase
    const parsedFrontmatter = shouldParseFrontmatter
      ? (getFrontmatter(frontmatter || {}) || {})
      : {}
    const imageScale = shouldParseFrontmatter ? parsedFrontmatter.imageScale : null
    const imageBase = shouldParseFrontmatter
      ? resolveImageBase({
        url: parsedFrontmatter.url,
        urlimage: parsedFrontmatter.urlimage,
        urlimagebase: parsedFrontmatter.urlimagebase || opt.urlImageBase,
      })
      : ''
    const fmContext = {
      shouldParseFrontmatter,
      parsedFrontmatter,
      imageScale,
      imageBase,
      mdDir,
    }
    const tokens = state.tokens || []
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex]
      if (token.type !== 'inline' || !token.children) continue
      const children = token.children
      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const child = children[childIndex]
        if (child.type === 'image') {
          processImageToken(child, renderState, fmContext)
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
