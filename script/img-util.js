const scaleSuffixReg = /[@._-]([0-9]+)(x|dpi|ppi)$/
const resizeReg = /(?:(?:(?:大きさ|サイズ)の?変更|リサイズ|resize(?:d to)?) *[:：]? *([0-9]+(?:\.[0-9]+)?)([%％]|px)|([0-9]+(?:\.[0-9]+)?)([%％]|px)[にへ](?:(?:大きさ|サイズ)を?変更|リサイズ))/i
const resizeValueReg = /^([0-9]+(?:\.[0-9]+)?)(%|px)$/i
const resizePendingPrefixReg = /^(?:r|re|res|resi|resiz|resize|resized|resized t|resized to)$/i
const resizePendingValueReg = /^(?:resize(?:d to)?)\s*[:：]?\s*(?:[0-9]+(?:\.[0-9]*)?\s*(?:%|％|p|px)?)?$/i
const resizePendingJaValueReg = /^(?:リ|リサ|リサイ|リサイズ)\s*[:：]?\s*(?:[0-9]+(?:\.[0-9]*)?\s*(?:%|％|p|px)?)?$/i
const yamlReg = /^--- *\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const percentEncodedReg = /%[0-9A-Fa-f]{2}/
const encodedSlashReg = /%2f|%5c/i
const httpUrlReg = /^https?:\/\//i
const protocolRelativeReg = /^\/\//
const fileUrlReg = /^file:\/\//i
const urlSchemeReg = /^[a-z][a-z0-9+.-]*:\/\//i
const specialSchemeReg = /^(data|blob|vscode-resource|vscode-webview-resource|vscode-file):/i
const windowsAbsolutePathReg = /^[A-Za-z]:\//
const absoluteUrlReg = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i
const htmlFileReg = /\.(html|htm|xhtml)$/i
const urlPathReg = /^([a-z]+:\/\/)(.*)/
const neverMatchReg = /a^/
const slashCharCode = 47
const dotCharCode = 46
const lowerRCharCode = 114
const upperRCharCode = 82
const katakanaRiCharCode = 12522
const yamlFrontmatterFenceLf = '---\n'
const yamlFrontmatterFenceCrLf = '---\r\n'

const needsPathNormalization = (text) => {
  const len = text.length
  if (len === 0) return false
  if (text === '.') return true
  if (text === '/') return true
  if (len >= 2 && text.charCodeAt(0) === dotCharCode && text.charCodeAt(1) === slashCharCode) return true
  if (len > 1 && text.charCodeAt(len - 1) === slashCharCode) return true

  for (let i = 0; i < len; i += 1) {
    if (text.charCodeAt(i) !== slashCharCode) continue
    const next = i + 1
    if (next >= len) continue
    const nextCode = text.charCodeAt(next)
    if (nextCode === slashCharCode) return true
    if (nextCode !== dotCharCode) continue

    const afterDot = next + 1
    if (afterDot >= len) return true // '/.'
    const afterDotCode = text.charCodeAt(afterDot)
    if (afterDotCode === slashCharCode) return true // '/./'
    if (afterDotCode !== dotCharCode) continue

    const afterDoubleDot = afterDot + 1
    if (afterDoubleDot >= len) return true // '/..'
    if (text.charCodeAt(afterDoubleDot) === slashCharCode) return true // '/../'
  }
  return false
}

const toText = (value) => {
  if (typeof value === 'string') return value
  if (value instanceof String) return value.valueOf()
  return ''
}
const isRecordObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (value, key) => isRecordObject(value) && Object.prototype.hasOwnProperty.call(value, key)
const parseFrontmatterScalar = (value) => {
  const text = toText(value).trim()
  if (!text) return ''
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  if (text === 'true') return true
  if (text === 'false') return false
  return text
}
const getDirectFrontmatterValue = (frontmatter, key) => {
  if (!hasOwn(frontmatter, key)) return { present: false, value: undefined }
  return { present: true, value: frontmatter[key] }
}
const getNestedFrontmatterValue = (frontmatter, path) => {
  if (!isRecordObject(frontmatter) || !Array.isArray(path) || path.length === 0) {
    return { present: false, value: undefined }
  }
  let current = frontmatter
  const lastIndex = path.length - 1
  for (let i = 0; i < lastIndex; i += 1) {
    const segment = path[i]
    if (!hasOwn(current, segment) || !isRecordObject(current[segment])) {
      return { present: false, value: undefined }
    }
    current = current[segment]
  }
  const lastKey = path[lastIndex]
  if (!hasOwn(current, lastKey)) return { present: false, value: undefined }
  return { present: true, value: current[lastKey] }
}
const normalizeFrontmatterConflictValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return toText(value).trim().replace(/\\/g, '/')
}
const createDirectAlias = (label, key, meta = {}) => Object.freeze({
  label,
  ...meta,
  get: (frontmatter) => getDirectFrontmatterValue(frontmatter, key),
})
const createNestedAlias = (label, path, meta = {}) => Object.freeze({
  label,
  ...meta,
  get: (frontmatter) => getNestedFrontmatterValue(frontmatter, path),
})
const warnFrontmatterConflict = (fieldName, selectedLabel, sourceLabels, onWarning) => {
  if (typeof onWarning !== 'function') return
  const sources = sourceLabels.join(', ')
  onWarning(`Conflicting frontmatter values for ${fieldName}. Using ${selectedLabel}. Sources: ${sources}`)
}
const resolveFrontmatterAlias = (frontmatter, fieldName, aliases, options = {}, acceptOverride = null) => {
  const accept = typeof acceptOverride === 'function'
    ? acceptOverride
    : (typeof options.accept === 'function'
    ? options.accept
    : null)
  const normalizeCompareValue = typeof options.normalizeCompareValue === 'function'
    ? options.normalizeCompareValue
    : normalizeFrontmatterConflictValue
  let selected = null
  let selectedCompareValue = ''
  let sourceLabels = null
  let hasConflict = false
  for (const alias of aliases) {
    const candidate = alias.get(frontmatter)
    if (!candidate.present) continue
    if (accept && !accept(candidate.value, alias)) continue
    const compareValue = normalizeCompareValue(candidate.value)
    if (!selected) {
      selected = {
        present: true,
        value: candidate.value,
        label: alias.label,
      }
      selectedCompareValue = compareValue
      continue
    }
    if (!sourceLabels) sourceLabels = [selected.label]
    sourceLabels.push(alias.label)
    if (!hasConflict && compareValue !== selectedCompareValue) hasConflict = true
  }
  if (selected && hasConflict && sourceLabels) {
    warnFrontmatterConflict(fieldName, selected.label, sourceLabels, options.onWarning)
  }
  return selected || { present: false, value: undefined, label: '' }
}
const urlFrontmatterAliases = Object.freeze([
  createDirectAlias('page.url', 'page.url'),
  createNestedAlias('page.url (nested)', ['page', 'url']),
  createDirectAlias('url', 'url'),
])
const urlImageFrontmatterAliases = Object.freeze([
  createDirectAlias('images.dirUrl', 'images.dirUrl', { absoluteOnly: true }),
  createNestedAlias('images.dirUrl (nested)', ['images', 'dirUrl'], { absoluteOnly: true }),
  createDirectAlias('urlimage', 'urlimage', { absoluteOnly: true }),
])
const urlImageBaseFrontmatterAliases = Object.freeze([
  createDirectAlias('images.baseUrl', 'images.baseUrl'),
  createNestedAlias('images.baseUrl (nested)', ['images', 'baseUrl']),
  createDirectAlias('urlimagebase', 'urlimagebase'),
])
const stripLocalPrefixFrontmatterAliases = Object.freeze([
  createDirectAlias('images.stripLocalPrefix', 'images.stripLocalPrefix'),
  createNestedAlias('images.stripLocalPrefix (nested)', ['images', 'stripLocalPrefix']),
  createDirectAlias('lid', 'lid'),
])
const localMarkdownDirFrontmatterAliases = Object.freeze([
  createDirectAlias('local.markdownDir', 'local.markdownDir'),
  createNestedAlias('local.markdownDir (nested)', ['local', 'markdownDir']),
  createDirectAlias('lmd', 'lmd'),
])
const imageScaleFrontmatterAliases = Object.freeze([
  createDirectAlias('images.scale', 'images.scale'),
  createNestedAlias('images.scale (nested)', ['images', 'scale']),
  createDirectAlias('imagescale', 'imagescale'),
])
const safeDecodeUri = (value) => {
  const text = toText(value)
  if (!text) return ''
  if (text.indexOf('%') === -1) return text
  if (!percentEncodedReg.test(text)) return text
  if (encodedSlashReg.test(text)) return text
  try {
    return decodeURI(text)
  } catch {
    return text
  }
}
const stripQueryHash = (value) => {
  const text = toText(value)
  if (!text) return ''
  const queryIndex = text.indexOf('?')
  const hashIndex = text.indexOf('#')
  const endIndex = queryIndex >= 0 && hashIndex >= 0
    ? Math.min(queryIndex, hashIndex)
    : (queryIndex >= 0 ? queryIndex : hashIndex)
  return endIndex >= 0 ? text.slice(0, endIndex) : text
}
const escapeForRegExp = (value) => toText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalizeExtensions = (value) => toText(value)
  .split(',')
  .map((ext) => ext.trim().replace(/^\.+/, ''))
  .filter(Boolean)
  .map(escapeForRegExp)
const buildImageExtensionRegExp = (value) => {
  const extPattern = normalizeExtensions(value).join('|')
  return extPattern
    ? new RegExp(`\\.(?:${extPattern})(?=$|[?#])`, 'i')
    : neverMatchReg
}
const isHttpUrl = (value) => httpUrlReg.test(toText(value))
const isProtocolRelativeUrl = (value) => protocolRelativeReg.test(toText(value))
const isFileUrl = (value) => fileUrlReg.test(toText(value))
const hasUrlScheme = (value) => urlSchemeReg.test(toText(value))
const hasSpecialScheme = (value) => specialSchemeReg.test(toText(value))
const isAbsolutePath = (value) => {
  const text = toText(value)
  if (!text) return false
  if (text.startsWith('//')) return true
  if (text.startsWith('/')) return true
  return windowsAbsolutePathReg.test(text)
}
const toFileUrl = (value) => {
  const text = toText(value)
  if (!text) return ''
  const normalized = text.replace(/\\/g, '/')
  if (!normalized) return ''
  if (normalized.startsWith('//')) {
    const without = normalized.replace(/^\/+/, '')
    if (!without) return 'file:///'
    const segments = without.split('/')
    const host = segments.shift() || ''
    const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join('/')
    return host ? `file://${host}/${encodedPath}` : 'file:///'
  }
  const without = normalized.replace(/^\/+/, '')
  const segments = without.split('/')
  const encoded = segments.map((segment, index) => {
    if (index === 0 && /^[A-Za-z]:$/.test(segment)) return segment
    return encodeURIComponent(segment)
  })
  return `file:///${encoded.join('/')}`
}
const isAbsoluteUrl = (value) => {
  const text = toText(value)
  if (!text) return false
  return absoluteUrlReg.test(text)
}
const isHtmlFile = (value) => {
  const text = toText(value)
  if (!text) return false
  return htmlFileReg.test(text)
}

const normalizeRelativePath = (path) => {
  const text = toText(path)
  if (!text) return text
  const urlSchemeMatch = text.match(urlPathReg)
  if (urlSchemeMatch) {
    const scheme = urlSchemeMatch[1]
    const pathPart = urlSchemeMatch[2]
    return scheme + normalizeRelativePath(pathPart)
  }
  if (!needsPathNormalization(text)) return text
  
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
  const text = toText(markdownCont)
  if (!text) return {}
  if (text !== '---' && !text.startsWith(yamlFrontmatterFenceLf) && !text.startsWith(yamlFrontmatterFenceCrLf)) {
    return {}
  }
  const yamlMatch = text.match(yamlReg)
  if (!yamlMatch) return {}
  const yamlContent = yamlMatch[1]
  const result = {}
  const lines = yamlContent.split(/\r?\n/)
  let currentSectionKey = ''
  for (const line of lines) {
    const lineMatch = line.match(/^([ \t]*)(.*)$/)
    const indentText = lineMatch ? lineMatch[1] : ''
    const indentSize = indentText.replace(/\t/g, '  ').length
    const trimmedLine = lineMatch ? lineMatch[2].trim() : line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) continue
    const colonIndex = trimmedLine.indexOf(':')
    if (colonIndex === -1) continue
    const key = trimmedLine.substring(0, colonIndex).trim()
    const value = trimmedLine.substring(colonIndex + 1).trim()
    if (indentSize > 0) {
      if (!currentSectionKey || !isRecordObject(result[currentSectionKey])) continue
      result[currentSectionKey][key] = parseFrontmatterScalar(value)
      continue
    }
    currentSectionKey = ''
    if (value === '') {
      result[key] = {}
      currentSectionKey = key
      continue
    }
    result[key] = parseFrontmatterScalar(value)
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

const classifyResizeHint = (title) => {
  const text = toText(title).trim()
  if (!text) {
    return { state: 'empty', normalizedResizeValue: '' }
  }
  const normalizedResizeValue = normalizeResizeValue(text)
  if (normalizedResizeValue) {
    return { state: 'valid', normalizedResizeValue }
  }
  const firstCharCode = text.charCodeAt(0)
  if (firstCharCode === lowerRCharCode || firstCharCode === upperRCharCode) {
    if (resizePendingPrefixReg.test(text) || resizePendingValueReg.test(text)) {
      return { state: 'pending', normalizedResizeValue: '' }
    }
  } else if (firstCharCode === katakanaRiCharCode) {
    if (resizePendingJaValueReg.test(text)) {
      return { state: 'pending', normalizedResizeValue: '' }
    }
  }
  return { state: 'invalid', normalizedResizeValue: '' }
}

const parseResizeValue = (value) => {
  const normalized = normalizeResizeValue(value)
  if (!normalized) return null
  const match = normalized.match(resizeValueReg)
  if (!match) return null
  const numericValue = Number(match[1])
  if (!Number.isFinite(numericValue)) return null
  return { value: numericValue, unit: match[2] }
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
const formatPercent = (value) => {
  if (!Number.isFinite(value) || value <= 0) return ''
  const rounded = Number(value.toFixed(6))
  if (!Number.isFinite(rounded) || rounded <= 0) return ''
  return `${String(rounded)}%`
}
const getImageScaleResizeValue = (value) => {
  const scale = parseImageScale(value)
  if (!Number.isFinite(scale) || scale <= 0) return ''
  return formatPercent(scale * 100)
}
const getScaleSuffixInfo = (imgName) => {
  const rs = toText(imgName).match(scaleSuffixReg)
  if (!rs) return null
  const scale = Number(rs[1])
  const unit = toText(rs[2]).toLowerCase()
  if (!Number.isFinite(scale) || scale <= 0 || !unit) return null
  return {
    scale,
    unit,
    value: `${String(scale)}${unit}`,
  }
}
const getScaleSuffixValue = (imgName) => {
  const info = getScaleSuffixInfo(imgName)
  return info ? info.value : ''
}

const setImgSize = (imgName, imgData, scaleSuffix, resize, title, imageScale, noUpscale) => {
  if (!imgData) return {}
  const originalWidth = imgData.width
  const originalHeight = imgData.height
  let w = originalWidth
  let h = originalHeight
  if (scaleSuffix) {
    const suffixInfo = getScaleSuffixInfo(imgName)
    if (suffixInfo) {
      const { scale, unit } = suffixInfo
      if (unit === 'x') {
        w = Math.round(w / scale)
        h = Math.round(h / scale)
      }
      if (/[dp]pi/.test(unit)) {
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

const getFrontmatter = (frontmatter, option = {}) => {
  if (!isRecordObject(frontmatter)) return null

  const warn = (message) => {
    if (typeof option.onWarning === 'function') option.onWarning(message)
  }
  const acceptAbsoluteOnlyAlias = (value, alias) => {
    if (!alias.absoluteOnly) return true
    const text = toText(value).trim()
    if (text && isAbsoluteUrl(text)) return true
    warn(`Ignoring ${alias.label} because it must be an absolute URL.`)
    return false
  }

  const resolvedLid = resolveFrontmatterAlias(frontmatter, 'images.stripLocalPrefix', stripLocalPrefixFrontmatterAliases, option)
  const resolvedUrl = resolveFrontmatterAlias(frontmatter, 'page.url', urlFrontmatterAliases, option)
  const resolvedUrlImage = resolveFrontmatterAlias(frontmatter, 'images.dirUrl', urlImageFrontmatterAliases, option, acceptAbsoluteOnlyAlias)
  const resolvedUrlImageBase = resolveFrontmatterAlias(frontmatter, 'images.baseUrl', urlImageBaseFrontmatterAliases, option)
  const resolvedLmd = resolveFrontmatterAlias(frontmatter, 'local.markdownDir', localMarkdownDirFrontmatterAliases, option)
  const resolvedImageScale = resolveFrontmatterAlias(frontmatter, 'images.scale', imageScaleFrontmatterAliases, option)

  let lid = toText(resolvedLid.value)
  if (lid) lid = lid.replace(/\\/g, '/')
  if (lid) {
    if (!/\/$/.test(lid)) lid += '/'
    if (/^\.\//.test(lid)) lid = lid.replace(/^\.\//, '')
  }
  let url = toText(resolvedUrl.value)
  if (url) {
    if (!url.endsWith('/')) url += '/'
  }
  let urlimage = toText(resolvedUrlImage.value)
  if (urlimage) {
    if (!urlimage.endsWith('/')) urlimage += '/'
  }
  let urlimagebase = toText(resolvedUrlImageBase.value)
  if (urlimagebase) {
    if (!urlimagebase.endsWith('/')) urlimagebase += '/'
  }
  let lmd = toText(resolvedLmd.value)
  if (lmd) lmd = lmd.replace(/\\/g, '/')
  if (lmd) {
    if (!/\/$/.test(lmd)) lmd += '/'
  }
  const imageScale = parseImageScale(resolvedImageScale.value)
  const imageScaleResizeValue = getImageScaleResizeValue(resolvedImageScale.value)
  return { url, urlimage, urlimagebase, lid, lmd, imageScale, imageScaleResizeValue }
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
  buildImageExtensionRegExp,
  normalizeResizeValue,
  classifyResizeHint,
  getImageScaleResizeValue,
  getScaleSuffixValue,
  safeDecodeUri,
  stripQueryHash,
  normalizeExtensions,
  isHttpUrl,
  isProtocolRelativeUrl,
  isFileUrl,
  hasUrlScheme,
  hasSpecialScheme,
  isAbsolutePath,
  toFileUrl,
  escapeForRegExp,
  getBasename,
  getImageName,
  applyOutputUrlMode,
  parseFrontmatter, setImgSize, getFrontmatter,
  normalizeRelativePath, resolveImageBase,
}
