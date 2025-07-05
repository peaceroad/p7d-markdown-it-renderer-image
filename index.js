import path from 'path'
import fetch from 'sync-fetch'
import imageSize from 'image-size'
import { setImgSize, getFrontmatter, normalizeRelativePath } from './script/img-util.js'

const getLocalImgSrc = (imgSrc, opt, env) => {
  let dirPath = ''
  if (opt.mdPath) {
    dirPath = path.dirname(opt.mdPath)
  } else if (env?.mdPath) {
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
    modifyImgSrc: false,
    imgSrcPrefix: '',
    hideTitle: false,
  }
  if (option) Object.assign(opt, option)

  const imgExtReg = new RegExp('\\.(?:' + opt.checkImgExtensions.split(',').join('|') + ')$', 'i')

  let cachedFrontmatter = null

  md.renderer.rules['image'] = (tokens, idx, options, env, slf) => {
    const token = tokens[idx]
    const endTag = options.xhtmlOut ? ' />' : '>'

    let srcRaw = token.attrGet('src')
    let src = srcRaw

    const frontmatter = env?.frontmatter || md.env?.frontmatter
    if (opt.modifyImgSrc && frontmatter) {
      if (!cachedFrontmatter || cachedFrontmatter.original !== frontmatter) {
        cachedFrontmatter = { original: frontmatter }
        Object.assign(cachedFrontmatter, getFrontmatter(frontmatter, opt))
      }

      const { url, lid } = cachedFrontmatter
      if (!/^https?:\/\//.test(src)) {
        if (lid) {
          // Remove lid path from src if src starts with lid
          if (src.startsWith(lid)) {
            src = src.substring(lid.length)
          } else if (src.startsWith('./') && ('.' + src).startsWith(lid)) {
            // Handle ./path case
            src = ('.' + src).substring(lid.length)
          }
        }
        if (url) src = `${url}${src}`
        src = normalizeRelativePath(src)
      }
      token.attrSet('src', src)
    }

    const escapedSrc = md.utils.escapeHtml(src)
    const safeSrc = decodeURI(escapedSrc)
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
    if (title && !opt.hideTitle) {
      token.attrSet('title', title)
    }
    if (opt.hideTitle) {
      const titleIndex = token.attrIndex('title')
      if (titleIndex >= 0) {
        token.attrs.splice(titleIndex, 1)
      }
    }
    if (isValidExt && opt.asyncDecode) token.attrSet('decoding', 'async')
    if (isValidExt && opt.lazyLoad) token.attrSet('loading', 'lazy')
    return `<img${slf.renderAttrs(token)}${endTag}`
  }
}

export default mditRendererImage