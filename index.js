import path from 'path'
import fetch from 'sync-fetch'
import imageSize from 'image-size'

const scaleSuffixReg = /[@._-]([0-9]+)(x|dpi|ppi)$/
const resizeReg = /(?:(?:(?:大きさ|サイズ)の?変更|リサイズ|resize(?:d to)?) *[:：]? *([0-9]+)([%％]|px)|([0-9]+)([%％]|px)[にへ](?:(?:大きさ|サイズ)を?変更|リサイズ))/i

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

const getLocalImgSrc = (imgSrc, opt, env) => {
  let dirPath = ''
  if (opt.mdPath) {
    dirPath = path.dirname(opt.mdPath)
  } else if (env && env.mdPath) {
    dirPath = path.dirname(env.mdPath)
  }
  if (dirPath === '') return ''
  return path.resolve(dirPath, imgSrc.replace(/[/\\]/g, path.sep))
}

const getImgData = (src, isRemote) => {
  try {
    let data, buffer
    if (isRemote) {
      const response = fetch(src)
      buffer = response.buffer()
      data = imageSize(buffer)
    } else {
      data = imageSize(src)
    }
    return data
  } catch {
    console.error("[renderer-image] Can't load image: " + src)
    return {}
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
  }
  if (option) Object.assign(opt, option)

  const imgExtReg = new RegExp('\\.(?:' + opt.checkImgExtensions.split(',').join('|') + ')$', 'i')

  md.renderer.rules['image'] = (tokens, idx, options, env, slf) => {
    const token = tokens[idx]
    const endTag = options.xhtmlOut ? ' />' : '>'

    const srcRaw = token.attrGet('src')
    const src = md.utils.escapeHtml(srcRaw)
    const safeSrc = decodeURI(src)
    const alt = md.utils.escapeHtml(token.content)
    const titleRaw = token.attrGet('title')
    const title = md.utils.escapeHtml(titleRaw)

    const isValidExt = imgExtReg.test(srcRaw)
    const isRemote = /^https?:\/\//.test(srcRaw)
    const srcPath = isRemote ? srcRaw : getLocalImgSrc(srcRaw, opt, env)
    const hasSrcPath = isValidExt && srcPath

    const imgData = hasSrcPath ? getImgData(srcPath, isRemote) : {}
    if (imgData.width !== undefined) {
      const imgName = path.basename(srcRaw, path.extname(srcRaw))
      const { width, height } = setImgSize(imgName, imgData, opt.scaleSuffix, opt.resize, titleRaw)
      token.attrSet('width', width)
      token.attrSet('height', height)
    }

    token.attrSet('src', safeSrc)
    token.attrSet('alt', alt)
    if (title) token.attrSet('title', title)
    if (isValidExt && opt.asyncDecode) token.attrSet('decoding', 'async')
    if (isValidExt && opt.lazyLoad) token.attrSet('loading', 'lazy')
    return `<img${slf.renderAttrs(token)}${endTag}`
  }
}

export default mditRendererImage