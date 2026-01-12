export default async (markdownCont, option) => {
  const { setImgSize, parseFrontmatter, getFrontmatter, normalizeRelativePath, resizeReg } = await import('./img-util.js')

  const isHttpUrl = (value) => /^https?:\/\//i.test(value)
  const isProtocolRelativeUrl = (value) => /^\/\//.test(value)
  const isFileUrl = (value) => /^file:\/\//i.test(value)
  const stripQueryHash = (value) => value.split(/[?#]/)[0]
  const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const getImageName = (imgSrc) => {
    const cleanSrc = stripQueryHash(imgSrc)
    const lastDotIndex = cleanSrc.lastIndexOf('.')
    const lastSlashIndex = Math.max(cleanSrc.lastIndexOf('/'), cleanSrc.lastIndexOf('\\'))

    if (lastDotIndex > lastSlashIndex) {
      return cleanSrc.substring(lastSlashIndex + 1, lastDotIndex)
    }
    return cleanSrc.substring(lastSlashIndex + 1)
  }

  const opt = {
    scaleSuffix: false,
    resize: false,
    lazyLoad: false,
    asyncDecode: false,
    checkImgExtensions: 'png,jpg,jpeg,gif,webp',
    modifyImgSrc: true,
    imgSrcPrefix: '',
    hideTitle: true,
    resizeDataAttr: 'data-img-resize',
    suppressLoadErrors: false,
  }
  if (option) Object.assign(opt, option)
  const resizeDataAttr = typeof opt.resizeDataAttr === 'string' && opt.resizeDataAttr.trim()
    ? opt.resizeDataAttr
    : ''

  let frontmatter = {}
  if (markdownCont) frontmatter = parseFrontmatter(markdownCont)
  const { url, lid, lmd } = getFrontmatter(frontmatter, opt)
  const lidPattern = lid
    ? new RegExp('^(?:\\.\\/)?' + escapeForRegExp(lid).replace(/\//g, '\\/'))
    : null
  let adjustedLmd = ''
  if (lmd) {
    adjustedLmd = lmd.replace(/\\/g, '/')
    if (!/^file:\/\/\//.test(adjustedLmd)) adjustedLmd = 'file:///' + adjustedLmd
  }

  const imgExtReg = new RegExp('\\.(?:' + opt.checkImgExtensions.split(',').join('|') + ')(?=$|[?#])', 'i')

  const images = document.querySelectorAll('img')
  const setImagePromises = Array.from(images).map(async (img) => {
    const srcRaw = img.getAttribute('src') || ''
    const srcBase = stripQueryHash(srcRaw)
    const srcSuffix = srcRaw.slice(srcBase.length)
    const isLocalSrc = !isHttpUrl(srcRaw) && !isProtocolRelativeUrl(srcRaw) && !isFileUrl(srcRaw)

    let src = srcBase
    let finalSrc = srcRaw
    let loadSrc = srcRaw

    if (opt.modifyImgSrc) {
      if (isLocalSrc) {
        if (lidPattern) src = src.replace(lidPattern, '')

        const localNormalized = normalizeRelativePath(src)
        if (adjustedLmd) loadSrc = adjustedLmd + localNormalized + srcSuffix

        if (url && !src.startsWith('/')) {
          src = `${url}${src}`
        }
        src = normalizeRelativePath(src)
      }
      finalSrc = src + srcSuffix
      img.setAttribute('src', finalSrc)
    }

    // Decide source used for size measurement
    if (!opt.modifyImgSrc) {
      finalSrc = src + srcSuffix
      loadSrc = finalSrc
    } else if (!adjustedLmd || !isLocalSrc) {
      loadSrc = finalSrc
    }

    const alt = img.alt
    if (alt) img.setAttribute('alt', alt)
    const titleAttr = img.getAttribute('title') || ''
    const storedTitle = resizeDataAttr ? (img.getAttribute(resizeDataAttr) || '') : ''
    const titleHasResizeHint = !!(titleAttr && resizeReg.test(titleAttr))
    const storedHasResizeHint = !!(storedTitle && resizeReg.test(storedTitle))
    const resizeTitle = titleHasResizeHint
      ? titleAttr
      : (!titleAttr && storedHasResizeHint ? storedTitle : '')
    const hasResizeHint = opt.resize && !!resizeTitle

    const removeTitle = opt.hideTitle && hasResizeHint
    if (removeTitle) {
      if (resizeDataAttr && resizeTitle) img.setAttribute(resizeDataAttr, resizeTitle)
      img.removeAttribute('title')
    } else if (titleAttr) {
      img.setAttribute('title', titleAttr)
    }
    if (resizeDataAttr && !removeTitle) {
      if (titleAttr) {
        img.removeAttribute(resizeDataAttr)
      } else if (storedTitle && !storedHasResizeHint) {
        img.removeAttribute(resizeDataAttr)
      }
    }

    let decoding = img.getAttribute('decoding')
    if (!decoding) decoding = opt.asyncDecode ? 'async' : false
    let loading = img.getAttribute('loading')
    if (!loading) loading = opt.lazyLoad ? 'lazy' : false
    img.removeAttribute('decoding')
    img.removeAttribute('loading')

    const sizeSrc = img.getAttribute('src') || finalSrc

    if (imgExtReg.test(sizeSrc)) {
      const originalImage = new Image()
      originalImage.setAttribute('src', loadSrc)
      try {
        if (!originalImage.complete) {
          await new Promise((resolve) => {
            originalImage.onload = resolve
            originalImage.onerror = resolve
          })
        }
      } catch (error) {
        if (!opt.suppressLoadErrors) console.error(`[renderer-image(dom)] ${src}`, error)
      }

      if (originalImage.naturalWidth && originalImage.naturalHeight) {
        const imgName = getImageName(sizeSrc)
        const { width, height } = setImgSize(
          imgName,
          { width: originalImage.naturalWidth, height: originalImage.naturalHeight },
          opt.scaleSuffix,
          opt.resize,
          resizeTitle
        )

        img.setAttribute('width', width)
        img.setAttribute('height', height)
      }
    }
    if (decoding) img.setAttribute('decoding', decoding)
    if (loading) img.setAttribute('loading', loading)
  })

  return Promise.all(setImagePromises)
}
