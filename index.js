import path from 'path'
import fetch from 'sync-fetch'
import imageSize from 'image-size'
import { setImgSize, getFrontmatter, normalizeRelativePath } from './script/img-util.js'

const tokensState = new WeakMap()
const globalFailedImgLoads = new Set()
const globalMissingMdPathWarnings = new Set()

const isHttpUrl = (value) => /^https?:\/\//i.test(value)
const isProtocolRelativeUrl = (value) => /^\/\//.test(value)
const isFileUrl = (value) => /^file:\/\//i.test(value)
const toAbsoluteRemote = (value) => (isProtocolRelativeUrl(value) ? `https:${value}` : value)
const stripQueryHash = (value) => value.split(/[?#]/)[0]
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

const mditRendererImage = (md, option) => {
  const opt = {
    scaleSuffix: false,
    mdPath: '',
    lazyLoad: false,
    resize: false,
    asyncDecode: false,
    checkImgExtensions: 'png,jpg,jpeg,gif,webp',
    modifyImgSrc: false,
    imgSrcPrefix: '',
    hideTitle: false,
    remoteTimeout: 5000,
    disableRemoteSize: false,
    cacheMax: 64,
    suppressErrors: 'none', // 'none' | 'all' | 'local' | 'remote'
    remoteMaxBytes: 16 * 1024 * 1024,
  }
  if (option) Object.assign(opt, option)

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
    if (opt.modifyImgSrc && frontmatter && src) {
      const parsedFrontmatter = getFrontmatter(frontmatter, opt) || {}

      const { url, lid } = parsedFrontmatter
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
        if (url && !src.startsWith('/')) {
          src = `${url}${src}`
        }
        src = normalizeRelativePath(src) + srcSuffix
      }
      token.attrSet('src', src)
    }

    const finalSrc = decodeSrc(token.attrGet('src') || (src + srcSuffix))

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
        const { width, height } = setImgSize(imgName, imgData, opt.scaleSuffix, opt.resize, titleRaw)
        token.attrSet('width', width)
        token.attrSet('height', height)
      }
    }

    token.attrSet('src', finalSrc)
    token.attrSet('alt', token.content || '')
    if (titleRaw && !opt.hideTitle) {
      token.attrSet('title', titleRaw)
    } else if (opt.hideTitle) {
      const titleIndex = token.attrIndex('title')
      if (titleIndex >= 0) token.attrs.splice(titleIndex, 1)
    }
    if (isValidExt && opt.asyncDecode) token.attrSet('decoding', 'async')
    if (isValidExt && opt.lazyLoad) token.attrSet('loading', 'lazy')
    return `<img${slf.renderAttrs(token)}${endTag}`
  }
}

export default mditRendererImage
