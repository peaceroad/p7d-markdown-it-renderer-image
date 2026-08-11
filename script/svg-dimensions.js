const maxSvgHeaderBytes = 512 * 1024
const svgNumberReg = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
const svgLengthReg = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i
const absoluteUnitScale = Object.freeze({
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
})
const relativeLengthUnits = new Set(['%', 'em', 'ex', 'rem', 'ch', 'lh', 'vw', 'vh', 'vmin', 'vmax'])
const utf8Decoder = new TextDecoder('utf-8')
const utf16LeDecoder = new TextDecoder('utf-16le')
const utf16BeDecoder = new TextDecoder('utf-16be')

const isXmlWhitespace = (charCode) => (
  charCode === 0x20 || charCode === 0x09 || charCode === 0x0a || charCode === 0x0d
)

const skipXmlWhitespace = (text, start) => {
  let index = start
  while (index < text.length && isXmlWhitespace(text.charCodeAt(index))) index += 1
  return index
}

const findDelimitedEnd = (text, start, delimiter) => {
  const index = text.indexOf(delimiter, start)
  return index < 0 ? -1 : index + delimiter.length
}

const findMarkupEnd = (text, start, trackSubset) => {
  let quote = ''
  let subsetDepth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (trackSubset && char === '[') {
      subsetDepth += 1
    } else if (trackSubset && char === ']' && subsetDepth > 0) {
      subsetDepth -= 1
    } else if (char === '>' && subsetDepth === 0) {
      return index + 1
    }
  }
  return -1
}

const findDoctypeEnd = (text, start) => findMarkupEnd(text, start, true)
const findTagEnd = (text, start) => findMarkupEnd(text, start, false)

const getSvgRootTag = (text) => {
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0
  while (index < text.length) {
    index = skipXmlWhitespace(text, index)
    if (text.startsWith('<?', index)) {
      index = findDelimitedEnd(text, index + 2, '?>')
    } else if (text.startsWith('<!--', index)) {
      index = findDelimitedEnd(text, index + 4, '-->')
    } else if (text.slice(index, index + 9).toLowerCase() === '<!doctype') {
      index = findDoctypeEnd(text, index + 9)
    } else if (
      text.slice(index, index + 4).toLowerCase() === '<svg'
      && (
        isXmlWhitespace(text.charCodeAt(index + 4))
        || text.charCodeAt(index + 4) === 0x3e
        || text.charCodeAt(index + 4) === 0x2f
      )
    ) {
      const end = findTagEnd(text, index + 4)
      return end < 0 ? '' : text.slice(index, end)
    } else {
      return ''
    }
    if (index < 0) return ''
  }
  return ''
}

const getDimensionAttributes = (tag) => {
  const attributes = { width: null, height: null, viewBox: null }
  let index = 4
  while (index < tag.length) {
    index = skipXmlWhitespace(tag, index)
    const current = tag.charCodeAt(index)
    if (current === 0x3e) return attributes
    if (current === 0x2f && tag.charCodeAt(index + 1) === 0x3e) return attributes

    const nameStart = index
    while (index < tag.length) {
      const charCode = tag.charCodeAt(index)
      if (
        isXmlWhitespace(charCode)
        || charCode === 0x3d
        || charCode === 0x2f
        || charCode === 0x3e
      ) break
      index += 1
    }
    if (index === nameStart) return null
    const name = tag.slice(nameStart, index)

    index = skipXmlWhitespace(tag, index)
    if (tag.charCodeAt(index) !== 0x3d) return null
    index = skipXmlWhitespace(tag, index + 1)
    const quote = tag[index]
    if (quote !== '"' && quote !== "'") return null
    const valueStart = index + 1
    index = tag.indexOf(quote, valueStart)
    if (index < 0) return null

    if (name === 'width' || name === 'height' || name === 'viewBox') {
      if (attributes[name] !== null) return null
      attributes[name] = tag.slice(valueStart, index)
    }
    index += 1
    const next = tag.charCodeAt(index)
    if (!isXmlWhitespace(next) && next !== 0x2f && next !== 0x3e) return null
  }
  return null
}

const parseSvgLength = (value) => {
  if (value == null) return { kind: 'missing', value: 0 }
  const text = value.trim()
  if (!text || text.toLowerCase() === 'auto') return { kind: 'relative', value: 0 }
  const match = text.match(svgLengthReg)
  if (!match) return { kind: 'invalid', value: 0 }
  const unit = match[2].toLowerCase()
  if (relativeLengthUnits.has(unit)) {
    return { kind: 'relative', value: 0 }
  }
  if (!Object.prototype.hasOwnProperty.call(absoluteUnitScale, unit)) {
    return { kind: 'invalid', value: 0 }
  }
  const numericValue = Number(match[1])
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return { kind: 'invalid', value: 0 }
  }
  return { kind: 'absolute', value: numericValue * absoluteUnitScale[unit] }
}

const parseViewBox = (value) => {
  if (value == null) return null
  const parts = value.trim().split(/[\s,]+/)
  if (parts.length !== 4) return null
  for (const part of parts) {
    if (!svgNumberReg.test(part)) return null
  }
  const width = Number(parts[2])
  const height = Number(parts[3])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

const normalizeDimensions = (width, height) => {
  const normalizedWidth = Math.round(width)
  const normalizedHeight = Math.round(height)
  if (
    !Number.isSafeInteger(normalizedWidth)
    || !Number.isSafeInteger(normalizedHeight)
    || normalizedWidth <= 0
    || normalizedHeight <= 0
  ) {
    return null
  }
  return { width: normalizedWidth, height: normalizedHeight }
}

const decodeSvgHeader = (header) => {
  if (header.byteLength >= 2) {
    if (header[0] === 0xff && header[1] === 0xfe) return utf16LeDecoder.decode(header)
    if (header[0] === 0xfe && header[1] === 0xff) return utf16BeDecoder.decode(header)
  }
  return utf8Decoder.decode(header)
}

const getSvgDimensionsFromData = (data) => {
  if (!(data instanceof Uint8Array) || data.byteLength === 0) return null
  const header = data.byteLength > maxSvgHeaderBytes
    ? data.subarray(0, maxSvgHeaderBytes)
    : data
  let text = ''
  try {
    text = decodeSvgHeader(header)
  } catch {
    return null
  }
  const rootTag = getSvgRootTag(text)
  if (!rootTag) return null
  const attributes = getDimensionAttributes(rootTag)
  if (!attributes) return null

  const width = parseSvgLength(attributes.width)
  const height = parseSvgLength(attributes.height)
  if (width.kind === 'invalid' || height.kind === 'invalid') return null
  if (width.kind === 'absolute' && height.kind === 'absolute') {
    return normalizeDimensions(width.value, height.value)
  }

  const viewBox = parseViewBox(attributes.viewBox)
  if (!viewBox) return null
  if (width.kind === 'absolute') {
    return normalizeDimensions(width.value, width.value * viewBox.height / viewBox.width)
  }
  if (height.kind === 'absolute') {
    return normalizeDimensions(height.value * viewBox.width / viewBox.height, height.value)
  }
  return normalizeDimensions(viewBox.width, viewBox.height)
}

export { getSvgDimensionsFromData }
