const scaleSuffixReg = /[@._-]([0-9]+)(x|dpi|ppi)$/
const resizeReg = /(?:(?:(?:大きさ|サイズ)の?変更|リサイズ|resize(?:d to)?) *[:：]? *([0-9]+(?:\.[0-9]+)?)([%％]|px)|([0-9]+(?:\.[0-9]+)?)([%％]|px)[にへ](?:(?:大きさ|サイズ)を?変更|リサイズ))/i
const resizeValueReg = /^([0-9]+(?:\.[0-9]+)?)(%|px)$/i
const yamlReg = /^--- *\n([\s\S]*?)\n---/

const toText = (value) => {
  if (typeof value === 'string') return value
  if (value instanceof String) return value.valueOf()
  return ''
}
const hasPercentEncoded = (value) => /%[0-9A-Fa-f]{2}/.test(value)
const safeDecodeUri = (value) => {
  const text = toText(value)
  if (!text) return ''
  if (!hasPercentEncoded(text)) return text
  if (/%2f|%5c/i.test(text)) return text
  try {
    return decodeURI(text)
  } catch {
    return text
  }
}
const stripQueryHash = (value) => {
  const text = toText(value)
  if (!text) return ''
  return text.split(/[?#]/)[0]
}
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalizeExtensions = (value) => (value || '')
  .split(',')
  .map((ext) => ext.trim().replace(/^\.+/, ''))
  .filter(Boolean)
  .map(escapeForRegExp)
const isHttpUrl = (value) => /^https?:\/\//i.test(toText(value))
const isProtocolRelativeUrl = (value) => /^\/\//.test(toText(value))
const isFileUrl = (value) => /^file:\/\//i.test(toText(value))
const hasUrlScheme = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(toText(value))
const hasSpecialScheme = (value) => /^(data|blob|vscode-resource|vscode-webview-resource|vscode-file):/i.test(toText(value))
const isAbsoluteUrl = (value) => {
  const text = toText(value)
  if (!text) return false
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(text)
}
const isHtmlFile = (value) => {
  const text = toText(value)
  if (!text) return false
  return /\.(html|htm|xhtml)$/i.test(text)
}

const normalizeRelativePath = (path) => {
  const text = toText(path)
  if (!text) return text
  const urlSchemeMatch = text.match(/^([a-z]+:\/\/)(.*)/)
  if (urlSchemeMatch) {
    const scheme = urlSchemeMatch[1]
    const pathPart = urlSchemeMatch[2]
    return scheme + normalizeRelativePath(pathPart)
  }
  
  const isAbsolute = text.startsWith('/')
  const segments = text.split('/')
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
  const text = toText(value)
  if (!text) return text
  return text.endsWith('/') ? text : text + '/'
}

const getUrlPath = (value) => {
  const text = toText(value)
  if (!text) return ''
  const clean = stripQueryHash(text)
  const normalizePath = (input) => {
    const pathText = toText(input) || '/'
    const trimmed = pathText.replace(/\/+$/, '')
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
  const baseText = toText(base)
  const pathText = toText(path)
  if (!baseText) return pathText || ''
  const baseWithSlash = ensureTrailingSlash(baseText)
  if (!pathText) return baseWithSlash
  return baseWithSlash + pathText.replace(/^\/+/, '')
}

const getBasename = (value) => {
  const decoded = safeDecodeUri(value)
  const clean = stripQueryHash(decoded)
  const lastSlashIndex = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  return clean.substring(lastSlashIndex + 1)
}

const getImageName = (value) => {
  const decoded = safeDecodeUri(value)
  const cleanSrc = stripQueryHash(decoded)
  const lastDotIndex = cleanSrc.lastIndexOf('.')
  const lastSlashIndex = Math.max(cleanSrc.lastIndexOf('/'), cleanSrc.lastIndexOf('\\'))
  if (lastDotIndex > lastSlashIndex) {
    return cleanSrc.substring(lastSlashIndex + 1, lastDotIndex)
  }
  return cleanSrc.substring(lastSlashIndex + 1)
}

const parseFrontmatter = (markdownCont) => {
  if (typeof markdownCont !== 'string' || !markdownCont) return {}
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

const normalizeResizeValue = (value) => {
  if (!value) return ''
  const text = String(value).trim()
  if (!text) return ''
  const match = text.match(resizeReg)
  if (match) {
    const resizeValue = match[1] || match[3]
    const resizeUnit = match[2] || match[4]
    if (!resizeValue || !resizeUnit) return ''
    const normalizedUnit = resizeUnit === '％' ? '%' : resizeUnit.toLowerCase()
    return `${resizeValue}${normalizedUnit}`
  }
  return ''
}

const parseResizeValue = (value) => {
  const normalized = normalizeResizeValue(value)
  if (!normalized) return null
  const match = normalized.match(resizeValueReg)
  if (!match) return null
  const numericValue = Number(match[1])
  if (!Number.isFinite(numericValue)) return null
  return { value: numericValue, unit: match[2], normalized }
}

const parseImageScale = (value) => {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    return Math.min(value, 1)
  }
  const text = String(value).trim()
  if (!text) return null
  const percentMatch = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*%$/)
  if (percentMatch) {
    const percentValue = Number(percentMatch[1])
    if (!Number.isFinite(percentValue) || percentValue <= 0) return null
    return Math.min(percentValue / 100, 1)
  }
  const numericValue = Number(text)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null
  return Math.min(numericValue, 1)
}

const setImgSize = (imgName, imgData, scaleSuffix, resize, title, imageScale, noUpscale) => {
  if (!imgData) return {}
  const originalWidth = imgData.width
  const originalHeight = imgData.height
  let w = originalWidth
  let h = originalHeight
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
  const resizeInfo = resize && title ? parseResizeValue(title) : null
  if (resizeInfo) {
    if (resizeInfo.unit === '%') {
      h = Math.round(h * resizeInfo.value / 100)
      w = Math.round(w * resizeInfo.value / 100)
    }
    if (resizeInfo.unit === 'px') {
      h = Math.round(h * resizeInfo.value / w)
      w = Math.round(resizeInfo.value)
    }
  }
  if (!resizeInfo && imageScale && Number.isFinite(imageScale)) {
    w = Math.round(w * imageScale)
    h = Math.round(h * imageScale)
  }
  if (noUpscale && Number.isFinite(originalWidth) && Number.isFinite(originalHeight) && w > 0 && h > 0) {
    const limitScale = Math.min(1, originalWidth / w, originalHeight / h)
    if (limitScale < 1) {
      w = Math.round(w * limitScale)
      h = Math.round(h * limitScale)
    }
  }
  return { width: w, height: h }
}

const getFrontmatter = (frontmatter, opt) => {
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return null

  let lid = toText(frontmatter.lid)
  if (lid) {
    if (!/\/$/.test(lid)) lid += '/'
    if (/^.\//.test(lid)) lid = lid.replace(/^.\//, '')
  }
  let url = toText(frontmatter.url)
  if (url) {
    if (!url.endsWith('/')) url += '/'
  }
  const hasUrlImageKey = Object.prototype.hasOwnProperty.call(frontmatter, 'urlimage')
  let urlimage = toText(frontmatter.urlimage)
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
  let urlimagebase = toText(frontmatter.urlimagebase)
  if (urlimagebase) {
    if (!urlimagebase.endsWith('/')) urlimagebase += '/'
  }
  if (imageDir === '.' || imageDir === './') imageDir = ''
  if (imageDir) {
    if (!/\/$/.test(imageDir)) imageDir += '/'
    if (/^.\//.test(imageDir)) imageDir = imageDir.replace(/^.\//, '')
    imageDir = imageDir.replace(/^\/+/, '')
  }
  let lmd = toText(frontmatter.lmd)
  if (lmd) {
    if (!/\/$/.test(lmd)) lmd += '/'
  }
  const imageScale = parseImageScale(frontmatter.imagescale)
  return { url, urlimage, urlimagebase, lid, imageDir, hasImageDir, lmd, imageScale }
}

const resolveImageBase = (frontmatter) => {
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
  return ensureTrailingSlash(base)
}

const applyOutputUrlMode = (value, mode) => {
  const text = toText(value)
  if (!text || !mode || mode === 'absolute') return text
  if (mode === 'protocol-relative') {
    return text.replace(/^https?:\/\//i, '//')
  }
  if (mode === 'path-only') {
    if (text.startsWith('//') || /^https?:\/\//i.test(text)) {
      const target = text.startsWith('//') ? `https:${text}` : text
      try {
        const parsed = new URL(target)
        return `${parsed.pathname}${parsed.search}${parsed.hash}`
      } catch {
        return text
      }
    }
  }
  return text
}

export {
  scaleSuffixReg, resizeReg, resizeValueReg,
  normalizeResizeValue,
  safeDecodeUri,
  stripQueryHash,
  normalizeExtensions,
  isHttpUrl,
  isProtocolRelativeUrl,
  isFileUrl,
  hasUrlScheme,
  hasSpecialScheme,
  getBasename,
  getImageName,
  applyOutputUrlMode,
  parseFrontmatter, setImgSize, getFrontmatter,
  normalizeRelativePath, resolveImageBase,
}
