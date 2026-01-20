import path from 'path'
import fetch from 'sync-fetch'
import imageSize from 'image-size'
import { setImgSize, getFrontmatter, normalizeRelativePath, resolveImageBase, normalizeResizeValue } from './script/img-util.js'

const tokensState = new WeakMap()
const globalFailedImgLoads = new Set()
const globalMissingMdPathWarnings = new Set()

const isHttpUrl = (value) => /^https?:\/\//i.test(value)
const isProtocolRelativeUrl = (value) => /^\/\//.test(value)
const isFileUrl = (value) => /^file:\/\//i.test(value)
const toAbsoluteRemote = (value) => (isProtocolRelativeUrl(value) ? `https:${value}` : value)
const stripQueryHash = (value) => value.split(/[?#]/)[0]
const getBasename = (value) => {
  const clean = stripQueryHash(value || '')
  const lastSlashIndex = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  return clean.substring(lastSlashIndex + 1)
}
const fileUrlToPathLocal = (input) => {
  const url = input instanceof URL ? input : new URL(input)
  if (url.protocol !== 'file:') throw new TypeError('Expected file:// URL')

  const host = url.hostname
  let pathname = url.pathname || ''
  const isWindows = typeof process !== 'undefined' && process.platform === 'win32'

  if (isWindows) {
    if (host && host !== 'localhost') {
      return `\\\\${host}${decodeURIComponent(pathname).replace(/\//g, '\\')}`
    }
    pathname = decodeURIComponent(pathname)
    if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1)
    return pathname.replace(/\//g, '\\')
  }
  return decodeURIComponent(pathname)
}

const setCache = (cache, key, value, maxEntries) => {
  if (maxEntries === 0) return
  cache.set(key, value)
  if (maxEntries && cache.size > maxEntries) {
    const firstKey = cache.keys().next().value
    cache.delete(firstKey)
  }
}

const getLocalImgSrc = (imgSrc, opt, env) => {
  if (!imgSrc) return ''
  if (isProtocolRelativeUrl(imgSrc)) return ''
  if (isFileUrl(imgSrc)) {
    try {
      return fileUrlToPathLocal(imgSrc)
    } catch {
      return ''
    }
  }
  let dirPath = ''
  if (opt.mdPath) {
    dirPath = path.dirname(opt.mdPath)
  } else if (env?.mdPath) {
    dirPath = path.dirname(env.mdPath)
  }
  if (dirPath === '') return ''
  const cleanSrc = stripQueryHash(imgSrc)
  return path.resolve(dirPath, cleanSrc.replace(/[/\\]/g, path.sep))
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

const decodeSrc = (value) => {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

const applyOutputUrlMode = (value, mode) => {
  if (!value || !mode || mode === 'absolute') return value
  if (mode === 'protocol-relative') {
    return value.replace(/^https?:\/\//i, '//')
  }
  if (mode === 'path-only') {
    if (value.startsWith('//') || /^https?:\/\//i.test(value)) {
      const target = value.startsWith('//') ? `https:${value}` : value
      try {
        const parsed = new URL(target)
        return `${parsed.pathname}${parsed.search}${parsed.hash}`
      } catch {
        return value
      }
    }
  }
  return value
}

const mditRendererImage = (md, option) => {
  const opt = {
    scaleSuffix: false, // scale by @2x or dpi/ppi suffix
    mdPath: '', // markdown file path for local sizing
    lazyLoad: false, // add loading="lazy"
    resize: false, // resize by title hint
    asyncDecode: false, // add decoding="async"
    checkImgExtensions: 'png,jpg,jpeg,gif,webp', // size only these extensions
    modifyImgSrc: true, // rewrite src using frontmatter when available
    imgSrcPrefix: '', // replace origin of base URL
    urlImageBase: '', // fallback base when frontmatter lacks urlimagebase
    outputUrlMode: 'absolute', // absolute | protocol-relative | path-only
    hideTitle: false, // legacy alias (use autoHideResizeTitle)
    autoHideResizeTitle: true, // remove title when resize hint used
    resizeDataAttr: 'data-img-resize', // store resize hint when title removed
    noUpscale: true, // internal: prevent final size from exceeding original pixels
    remoteTimeout: 5000, // sync fetch timeout (ms)
    disableRemoteSize: false, // skip remote sizing
    cacheMax: 64, // per-render image data cache size
    suppressErrors: 'none', // 'none' | 'all' | 'local' | 'remote'
    remoteMaxBytes: 16 * 1024 * 1024, // skip large remote images (if content-length)
  }
  const safeOption = option && typeof option === 'object' ? { ...option } : null
  if (safeOption && Object.prototype.hasOwnProperty.call(safeOption, 'noUpscale')) {
    delete safeOption.noUpscale
  }
  if (safeOption) Object.assign(opt, safeOption)
  if (safeOption && Object.prototype.hasOwnProperty.call(safeOption, 'hideTitle')
    && !Object.prototype.hasOwnProperty.call(safeOption, 'autoHideResizeTitle')) {
    opt.autoHideResizeTitle = safeOption.hideTitle
  }
  if (safeOption && Object.prototype.hasOwnProperty.call(safeOption, 'suppressLoadErrors')
    && !Object.prototype.hasOwnProperty.call(safeOption, 'suppressErrors')) {
    opt.suppressErrors = safeOption.suppressLoadErrors ? 'all' : 'none'
  }

  if (!['none', 'all', 'local', 'remote'].includes(opt.suppressErrors)) {
    console.warn(`[renderer-image] Invalid suppressErrors value: ${opt.suppressErrors}. Using 'none'.`)
    opt.suppressErrors = 'none'
  }

  const imgExtReg = new RegExp('\\.(?:' + opt.checkImgExtensions.split(',').join('|') + ')(?=$|[?#])', 'i')

  const remoteSizeEnabled = !opt.disableRemoteSize

  md.renderer.rules['image'] = (tokens, idx, options, env, slf) => {
    let state = tokensState.get(tokens)
    if (!state) {
      state = {
        imgDataCache: new Map(),
        failedImgLoads: new Set(),
        missingMdPathWarnings: new Set(),
        frontmatterSource: null,
        resolvedFrontmatter: null,
        imageBase: '',
        imageScale: null,
      }
      tokensState.set(tokens, state)
    }
    const { imgDataCache, failedImgLoads, missingMdPathWarnings } = state

    const suppressLoadErrors = opt.suppressErrors === 'all'
    const suppressLocalErrors = opt.suppressErrors === 'local' || opt.suppressErrors === 'all'
    const suppressRemoteErrors = opt.suppressErrors === 'remote' || opt.suppressErrors === 'all'
    const token = tokens[idx]
    const endTag = options.xhtmlOut ? ' />' : '>'

    const srcRaw = token.attrGet('src') || ''
    const srcBase = stripQueryHash(srcRaw)
    const srcSuffix = srcRaw.slice(srcBase.length)
    let src = srcBase

    const titleRaw = token.attrGet('title')

    const frontmatter = env?.frontmatter || md.env?.frontmatter
    const hasFrontmatter = !!(frontmatter && typeof frontmatter === 'object' && Object.keys(frontmatter).length > 0)
    const shouldParseFrontmatter = hasFrontmatter || !!opt.urlImageBase
    if (shouldParseFrontmatter && state.frontmatterSource !== frontmatter) {
      const parsedFrontmatter = getFrontmatter(frontmatter || {}, opt) || {}
      state.frontmatterSource = frontmatter
      state.resolvedFrontmatter = parsedFrontmatter
      state.imageBase = resolveImageBase({
        url: parsedFrontmatter.url,
        urlimage: parsedFrontmatter.urlimage,
        urlimagebase: parsedFrontmatter.urlimagebase || opt.urlImageBase,
      }, opt)
      state.imageScale = parsedFrontmatter.imageScale
    }
    const parsedFrontmatter = shouldParseFrontmatter ? (state.resolvedFrontmatter || {}) : {}
    const imageScale = shouldParseFrontmatter ? state.imageScale : null
    if (opt.modifyImgSrc && src && (hasFrontmatter || opt.urlImageBase)) {
      const { lid, imageDir, hasImageDir } = parsedFrontmatter
      const imageBase = state.imageBase || ''

      if (!isHttpUrl(src) && !isProtocolRelativeUrl(src) && !isFileUrl(src)) {
        if (lid) {
          // Remove lid path from src if src starts with lid
          if (src.startsWith(lid)) {
            src = src.substring(lid.length)
          } else if (src.startsWith('./') && ('.' + src).startsWith(lid)) {
            // Handle ./path case
            src = ('.' + src).substring(lid.length)
          }
        }
        // Only modify relative paths (not starting with '/'), absolute paths are kept as-is
        if (imageBase && !src.startsWith('/')) {
          let nextSrc = src
          if (hasImageDir) {
            nextSrc = getBasename(nextSrc)
            if (imageDir) nextSrc = `${imageDir}${nextSrc}`
          }
          src = `${imageBase}${nextSrc}`
        }
        src = normalizeRelativePath(src) + srcSuffix
      }
      token.attrSet('src', src)
    }

    let finalSrc = decodeSrc(token.attrGet('src') || (src + srcSuffix))
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
      const titleIndex = token.attrIndex('title')
      if (titleIndex >= 0) token.attrs.splice(titleIndex, 1)
    }
    if (isValidExt && opt.asyncDecode) token.attrSet('decoding', 'async')
    if (isValidExt && opt.lazyLoad) token.attrSet('loading', 'lazy')
    return `<img${slf.renderAttrs(token)}${endTag}`
  }
}

export default mditRendererImage
