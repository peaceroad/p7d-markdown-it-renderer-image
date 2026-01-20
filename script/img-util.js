const scaleSuffixReg = /[@._-]([0-9]+)(x|dpi|ppi)$/
const resizeReg = /(?:(?:(?:大きさ|サイズ)の?変更|リサイズ|resize(?:d to)?) *[:：]? *([0-9]+)([%％]|px)|([0-9]+)([%％]|px)[にへ](?:(?:大きさ|サイズ)を?変更|リサイズ))/i
const yamlReg = /^--- *\n([\s\S]*?)\n---/

const stripQueryHash = (value) => value.split(/[?#]/)[0]
const isAbsoluteUrl = (value) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value)
const isHtmlFile = (value) => /\.(html|htm|xhtml)$/i.test(value || '')

const normalizeRelativePath = (path) => {
  if (!path) return path
  const urlSchemeMatch = path.match(/^([a-z]+:\/\/)(.*)/)
  if (urlSchemeMatch) {
    const scheme = urlSchemeMatch[1]
    const pathPart = urlSchemeMatch[2]
    return scheme + normalizeRelativePath(pathPart)
  }
  
  const isAbsolute = path.startsWith('/')
  const segments = path.split('/')
  const normalized = []
  
  for (const segment of segments) {
    if (segment === '.' || (segment === '' && !isAbsolute)) {
      continue
    } else if (segment === '' && isAbsolute && normalized.length === 0) {
      // Keep the first empty segment for absolute paths to preserve leading slash
      normalized.push(segment)
    } else if (segment === '..') {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
        normalized.pop()
      } else if (!isAbsolute) {
        // Keep leading .. segments for relative paths only
        normalized.push(segment)
      }
    } else if (segment !== '') {
      normalized.push(segment)
    }
  }
  
  return normalized.join('/')
}

const ensureTrailingSlash = (value) => {
  if (!value) return value
  return value.endsWith('/') ? value : value + '/'
}

const applyImgSrcPrefix = (value, imgSrcPrefix) => {
  if (!value || !imgSrcPrefix) return value
  let prefix = imgSrcPrefix
  if (!prefix.endsWith('/')) prefix += '/'
  return value.replace(/^https?:\/\/.*?\//, prefix)
}

const getUrlPath = (value) => {
  if (!value) return ''
  const clean = stripQueryHash(value)
  const normalizePath = (input) => {
    const path = input || '/'
    const trimmed = path.replace(/\/+$/, '')
    const last = trimmed.split('/').pop() || ''
    if (isHtmlFile(last)) {
      const index = trimmed.lastIndexOf('/')
      return index >= 0 ? trimmed.slice(0, index + 1) : '/'
    }
    return trimmed ? trimmed + '/' : '/'
  }
  try {
    const parsed = new URL(clean)
    return normalizePath(parsed.pathname)
  } catch {
    return normalizePath(clean)
  }
}

const joinUrl = (base, path) => {
  if (!base) return path || ''
  const baseWithSlash = ensureTrailingSlash(base)
  if (!path) return baseWithSlash
  return baseWithSlash + path.replace(/^\/+/, '')
}

const parseFrontmatter = (markdownCont) => {
  if (!markdownCont) return {}
  const yamlMatch = markdownCont.match(yamlReg)
  if (!yamlMatch) return {}
  const yamlContent = yamlMatch[1]
  const result = {}
  const lines = yamlContent.split('\n')
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) continue
    const colonIndex = trimmedLine.indexOf(':')
    if (colonIndex === -1) continue
    const key = trimmedLine.substring(0, colonIndex).trim()
    let value = trimmedLine.substring(colonIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (value === 'true') value = true
    if (value === 'false') value = false
    result[key] = value
  }
  return result
}

const parseImageScale = (value) => {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }
  const text = String(value).trim()
  if (!text) return null
  const percentMatch = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*%$/)
  if (percentMatch) {
    const percentValue = Number(percentMatch[1])
    if (!Number.isFinite(percentValue) || percentValue <= 0) return null
    return percentValue / 100
  }
  const numericValue = Number(text)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null
  return numericValue
}

const setImgSize = (imgName, imgData, scaleSuffix, resize, title, imageScale) => {
  if (!imgData) return {}
  let w = imgData.width
  let h = imgData.height
  if (scaleSuffix) {
    const rs = imgName.match(scaleSuffixReg)
    if (rs) {
      const scale = +rs[1]
      if (rs[2] === 'x') {
        w = Math.round(w / scale)
        h = Math.round(h / scale)
      }
      if (/[dp]pi/.test(rs[2])) {
        w = Math.round(w * 96 / scale)
        h = Math.round(h * 96 / scale)
      }
    }
  }
  if (title && resize) {
    const hasResizeSetting = title.match(resizeReg)
    if (hasResizeSetting) {
      let resizeValue, resizeUnit
      if (hasResizeSetting[1]) {
        resizeValue = +hasResizeSetting[1]
        resizeUnit = hasResizeSetting[2]
      } else {
        resizeValue = +hasResizeSetting[3]
        resizeUnit = hasResizeSetting[4]
      }
      if (resizeUnit.match(/[%％]/)) {
        h = Math.round(h * resizeValue / 100)
        w = Math.round(w * resizeValue / 100)
      }
      if (resizeUnit.match(/px/)) {
        h = Math.round(h * resizeValue / w)
        w = Math.round(resizeValue)
      }
    }
  }
  if (imageScale && Number.isFinite(imageScale)) {
    w = Math.round(w * imageScale)
    h = Math.round(h * imageScale)
  }
  return { width: w, height: h }
}

const getFrontmatter = (frontmatter, opt) => {
  if (!frontmatter) return null

  let lid = frontmatter.lid
  if (lid) {
    if (!/\/$/.test(lid)) lid += '/'
    if (/^.\//.test(lid)) lid = lid.replace(/^.\//, '')
  }
  let url = frontmatter.url
  if (url) {
    if (!url.endsWith('/')) url += '/'
  }
  const hasUrlImageKey = Object.prototype.hasOwnProperty.call(frontmatter, 'urlimage')
    || Object.prototype.hasOwnProperty.call(frontmatter, 'urlImage')
  let urlimage = typeof frontmatter.urlimage === 'string' ? frontmatter.urlimage : ''
  if (!urlimage && typeof frontmatter.urlImage === 'string') {
    urlimage = frontmatter.urlImage
  }
  let imageDir = ''
  let hasImageDir = false
  const urlimageIsAbsolute = urlimage ? isAbsoluteUrl(urlimage) : false
  if (urlimage && urlimageIsAbsolute) {
    if (!urlimage.endsWith('/')) urlimage += '/'
  } else if (hasUrlImageKey) {
    hasImageDir = true
    imageDir = urlimage
    urlimage = ''
  }
  let urlimagebase = typeof frontmatter.urlimagebase === 'string' ? frontmatter.urlimagebase : ''
  if (!urlimagebase && typeof frontmatter.urlImageBase === 'string') {
    urlimagebase = frontmatter.urlImageBase
  }
  if (urlimagebase) {
    if (!urlimagebase.endsWith('/')) urlimagebase += '/'
  }
  if (imageDir === '.' || imageDir === './') imageDir = ''
  if (imageDir) {
    if (!/\/$/.test(imageDir)) imageDir += '/'
    if (/^.\//.test(imageDir)) imageDir = imageDir.replace(/^.\//, '')
    imageDir = imageDir.replace(/^\/+/, '')
  }
  let lmd = frontmatter.lmd
  if (lmd) {
    if (!/\/$/.test(lmd)) lmd += '/'
  }
  const imageScale = parseImageScale(frontmatter.imagescale ?? frontmatter.imageScale)
  return { url, urlimage, urlimagebase, lid, imageDir, hasImageDir, lmd, imageScale }
}

const resolveImageBase = (frontmatter, opt) => {
  if (!frontmatter) return ''
  const url = frontmatter.url || ''
  const urlimage = frontmatter.urlimage || ''
  const urlimagebase = frontmatter.urlimagebase || ''
  let base = ''
  if (urlimage) {
    base = urlimage
  } else if (urlimagebase) {
    const urlPath = getUrlPath(url)
    base = joinUrl(urlimagebase, urlPath)
  } else if (url) {
    base = url
  }
  base = ensureTrailingSlash(base)
  if (opt && opt.imgSrcPrefix) {
    base = applyImgSrcPrefix(base, opt.imgSrcPrefix)
  }
  return base
}

export {
  scaleSuffixReg, resizeReg,
  parseFrontmatter, setImgSize, getFrontmatter,
  normalizeRelativePath, resolveImageBase,
}
