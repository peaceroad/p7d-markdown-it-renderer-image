const scaleSuffixReg = /[@._-]([0-9]+)(x|dpi|ppi)$/
const resizeReg = /(?:(?:(?:大きさ|サイズ)の?変更|リサイズ|resize(?:d to)?) *[:：]? *([0-9]+)([%％]|px)|([0-9]+)([%％]|px)[にへ](?:(?:大きさ|サイズ)を?変更|リサイズ))/i
const yamlReg = /^--- *\n([\s\S]*?)\n---/

const normalizeRelativePath = (path) => {
  if (!path) return path
  const urlSchemeMatch = path.match(/^([a-z]+:\/\/)(.*)/)
  if (urlSchemeMatch) {
    const scheme = urlSchemeMatch[1]
    const pathPart = urlSchemeMatch[2]
    return scheme + normalizeRelativePath(pathPart)
  }
  const segments = path.split('/')
  const normalized = []
  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      continue
    } else if (segment === '..') {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
        normalized.pop()
      } else {
        // Keep leading .. segments
        normalized.push(segment)
      }
    } else {
      normalized.push(segment)
    }
  }
  return normalized.join('/')
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

const setImgSize = (imgName, imgData, scaleSuffix, resize, title) => {
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
    if (opt.imgSrcPrefix) {
      if (!opt.imgSrcPrefix.endsWith('/')) opt.imgSrcPrefix += '/'
      url = url.replace(/^https?:\/\/.*?\//, opt.imgSrcPrefix)
    }
  }
  let lmd = frontmatter.lmd
  if (lmd) {
    if (!/\/$/.test(lmd)) lmd += '/'
  }
  return { url, lid, lmd }
}

export {
  scaleSuffixReg, resizeReg,
  parseFrontmatter, setImgSize, getFrontmatter,
  normalizeRelativePath,
}