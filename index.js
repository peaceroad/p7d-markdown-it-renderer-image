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

const toAbsoluteRemote = (value) => (isProtocolRelativeUrl(value) ? `https:${value}` : value)
const setCache = (cache, key, value, maxEntries) => {
  if (maxEntries === 0) return
  cache.set(key, value)
  if (maxEntries && cache.size > maxEntries) {
    const firstKey = cache.keys().next().value
    cache.delete(firstKey)
  }
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

const getLocalImgSrc = (imgSrc, opt, env) => {
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
  let dirPath = ''
  if (opt.mdPath) {
    dirPath = resolveMdDir(opt.mdPath)
  } else if (env?.mdPath) {
    dirPath = resolveMdDir(env.mdPath)
  }
  if (dirPath === '') return ''
  const cleanSrc = stripQueryHash(imgSrc)
  const decodedSrc = safeDecodeUri(cleanSrc)
  const finalSrc = decodedSrc === cleanSrc ? cleanSrc : decodedSrc
  return path.resolve(dirPath, finalSrc.replace(/[/\\]/g, path.sep))
}

const getImgData = (src, isRemote, timeout, cache, cacheMax, failedSet, suppressLoadErrors, suppressLocalErrors, suppressRemoteErrors, remoteMaxBytes) => {
  const cacheKey = `${isRemote ? 'remote' : 'local'}:${src}`
  if (cacheMax !== 0 && cache.has(cacheKey)) return cache.get(cacheKey) || {}
  try {
    let data
    if (isRemote) {
      const response = fetch(src, timeout ? { timeout } : undefined)
      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && remoteMaxBytes && contentLength > remoteMaxBytes) {
        const suppressByType = suppressRemoteErrors
        if (!suppressLoadErrors && !suppressByType && !failedSet.has(cacheKey)) {
          console.error(`[renderer-image] Skip image (too large: ${contentLength} bytes): ${src}`)
          failedSet.add(cacheKey)
        }
        setCache(cache, cacheKey, null, cacheMax)
        return {}
      }
      data = imageSize(response.buffer())
    } else {
      data = imageSize(src)
    }
    setCache(cache, cacheKey, data, cacheMax)
    return data
  } catch {
    const suppressByType = isRemote ? suppressRemoteErrors : suppressLocalErrors
    if (!suppressLoadErrors && !suppressByType && !failedSet.has(cacheKey) && !globalFailedImgLoads.has(cacheKey)) {
      console.error("[renderer-image] Can't load image: " + src)
      failedSet.add(cacheKey)
      globalFailedImgLoads.add(cacheKey)
    }
    setCache(cache, cacheKey, null, cacheMax)
    return {}
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

  const stateCache = new WeakMap()
  const removeTokenAttr = (token, name) => {
    const index = token.attrIndex(name)
    if (index >= 0) token.attrs.splice(index, 1)
  }

  const ensureState = (state) => {
    let cached = stateCache.get(state)
    if (!cached) {
      cached = {
        imgDataCache: new Map(),
        failedImgLoads: new Set(),
        missingMdPathWarnings: new Set(),
        frontmatterSource: null,
        resolvedFrontmatter: null,
        imageBase: '',
        imageScale: null,
      }
      stateCache.set(state, cached)
    }
    return cached
  }

  const processImageToken = (token, state, env, fmContext) => {
    const { imgDataCache, failedImgLoads, missingMdPathWarnings } = state
    const suppressLoadErrors = opt.suppressErrors === 'all'
    const suppressLocalErrors = opt.suppressErrors === 'local' || opt.suppressErrors === 'all'
    const suppressRemoteErrors = opt.suppressErrors === 'remote' || opt.suppressErrors === 'all'

    const srcRaw = token.attrGet('src') || ''
    const srcBase = stripQueryHash(srcRaw)
    const srcSuffix = srcRaw.slice(srcBase.length)
    let src = srcBase
    const titleRaw = token.attrGet('title')

    const parsedFrontmatter = fmContext?.parsedFrontmatter || {}
    const imageScale = fmContext?.imageScale || null
    const hasFrontmatter = fmContext?.hasFrontmatter || false
    const shouldParseFrontmatter = fmContext?.shouldParseFrontmatter || false

    if (opt.resolveSrc && src && (hasFrontmatter || opt.urlImageBase)) {
      const { lid, imageDir, hasImageDir } = parsedFrontmatter
      const imageBase = fmContext?.imageBase || ''

      if (!isHttpUrl(src) && !isProtocolRelativeUrl(src) && !isFileUrl(src) && !hasSpecialScheme(src)) {
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
    let finalSrc = safeDecodeUri(resolvedSrc)
    finalSrc = applyOutputUrlMode(finalSrc, opt.outputUrlMode)

    const isValidExt = imgExtReg.test(srcRaw)
    const isRemote = isHttpUrl(srcRaw) || isProtocolRelativeUrl(srcRaw)
    const isFile = isFileUrl(srcRaw)

    if (isValidExt) {
      const srcPath = isRemote ? toAbsoluteRemote(srcRaw) : getLocalImgSrc(srcBase, opt, env)
      const canReadRemote = isRemote && remoteSizeEnabled
      const hasSrcPath = (isRemote && canReadRemote) || (!isRemote && srcPath)

      if (!srcPath && !isRemote && !isFile && !missingMdPathWarnings.has(srcRaw) && !globalMissingMdPathWarnings.has(srcRaw)) {
        console.warn(`[renderer-image] Set mdPath in options or env to read local image dimensions: ${srcRaw}`)
        missingMdPathWarnings.add(srcRaw)
        globalMissingMdPathWarnings.add(srcRaw)
      }

      const imgData = hasSrcPath
        ? getImgData(
          srcPath,
          isRemote,
          opt.remoteTimeout,
          imgDataCache,
          opt.cacheMax,
          failedImgLoads,
          suppressLoadErrors,
          suppressLocalErrors,
          suppressRemoteErrors,
          opt.remoteMaxBytes
        )
        : {}

      if (imgData?.width !== undefined) {
        const imgName = path.basename(srcBase, path.extname(srcBase))
        const { width, height } = setImgSize(imgName, imgData, opt.scaleSuffix, opt.resize, titleRaw, imageScale, opt.noUpscale)
        token.attrSet('width', width)
        token.attrSet('height', height)
      }
    }

    token.attrSet('src', finalSrc)
    token.attrSet('alt', token.content || '')

    const resizeValue = opt.resize ? normalizeResizeValue(titleRaw) : ''
    const removeTitle = opt.autoHideResizeTitle && !!resizeValue
    if (titleRaw && !removeTitle) {
      token.attrSet('title', titleRaw)
    } else if (removeTitle) {
      if (typeof opt.resizeDataAttr === 'string' && opt.resizeDataAttr.trim() && resizeValue) {
        token.attrSet(opt.resizeDataAttr, resizeValue)
      }
      removeTokenAttr(token, 'title')
    }
    if (isValidExt && opt.asyncDecode) token.attrSet('decoding', 'async')
    if (isValidExt && opt.lazyLoad) token.attrSet('loading', 'lazy')
  }

  md.core.ruler.after('replacements', 'renderer_image', (state) => {
    const cached = ensureState(state)
    const env = state?.env || {}
    const frontmatter = env?.frontmatter || md.env?.frontmatter
    const hasFrontmatter = !!(frontmatter && typeof frontmatter === 'object' && Object.keys(frontmatter).length > 0)
    const shouldParseFrontmatter = hasFrontmatter || !!opt.urlImageBase
    if (shouldParseFrontmatter && cached.frontmatterSource !== frontmatter) {
      const parsedFrontmatter = getFrontmatter(frontmatter || {}, opt) || {}
      cached.frontmatterSource = frontmatter
      cached.resolvedFrontmatter = parsedFrontmatter
      cached.imageBase = resolveImageBase({
        url: parsedFrontmatter.url,
        urlimage: parsedFrontmatter.urlimage,
        urlimagebase: parsedFrontmatter.urlimagebase || opt.urlImageBase,
      })
      cached.imageScale = parsedFrontmatter.imageScale
    }
    const parsedFrontmatter = shouldParseFrontmatter ? (cached.resolvedFrontmatter || {}) : {}
    const imageScale = shouldParseFrontmatter ? cached.imageScale : null
    const imageBase = cached.imageBase || ''
    const fmContext = {
      hasFrontmatter,
      shouldParseFrontmatter,
      parsedFrontmatter,
      imageScale,
      imageBase,
    }
    const tokens = state.tokens || []
    for (const token of tokens) {
      if (token.type !== 'inline' || !token.children) continue
      for (const child of token.children) {
        if (child.type === 'image') {
          processImageToken(child, cached, env, fmContext)
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
