export default async (markdownCont, option) => {
  const { setImgSize, parseFrontmatter, getFrontmatter, normalizeRelativePath } = await import('./img-util.js')

  const isHttpUrl = (value) => /^https?:\/\//i.test(value)
  const isProtocolRelativeUrl = (value) => /^\/\//.test(value)
  const isFileUrl = (value) => /^file:\/\//i.test(value)
  const stripQueryHash = (value) => value.split(/[?#]/)[0]
  const appendSuffix = (base, raw) => base + raw.slice(base.length)
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
    hideTitle: false,
    suppressLoadErrors: false,
  }
  if (option) Object.assign(opt, option)

  let frontmatter = {}
  if (markdownCont) frontmatter = parseFrontmatter(markdownCont)
  const { url, lid, lmd } = getFrontmatter(frontmatter, opt)

  const imgExtReg = new RegExp('\\.(?:' + opt.checkImgExtensions.split(',').join('|') + ')(?=$|[?#])', 'i')

  const images = document.querySelectorAll('img')
  const setImagePromises = Array.from(images).map(async (img) => {
    const srcRaw = img.getAttribute('src') || ''
    const srcBase = stripQueryHash(srcRaw)

    const originalImage = new Image()
    let src = srcBase
    let finalSrc = srcRaw
    let loadSrc = srcRaw

    if (opt.modifyImgSrc) {
      if (!isHttpUrl(srcRaw) && !isProtocolRelativeUrl(srcRaw) && !isFileUrl(srcRaw)) {
        if (lid) {
          const lidPattern = new RegExp('^(?:\\.\\/)?' + escapeForRegExp(lid).replace(/\//g, '\\/'))
          src = src.replace(lidPattern, '')
        }

        if (lmd) {
          let adjustedLmd = lmd.replace(/\\/g, '/')
          if (!/^file:\/\/\//.test(adjustedLmd)) adjustedLmd = 'file:///' + adjustedLmd
          loadSrc = adjustedLmd + appendSuffix(src, srcRaw)
        }

        if (url && !src.startsWith('/')) {
          src = `${url}${src}`
        }
      }
      src = normalizeRelativePath(src)
      finalSrc = appendSuffix(src, srcRaw)
      img.setAttribute('src', finalSrc)
    }

    // Decide source used for size measurement
    if (!opt.modifyImgSrc) {
      finalSrc = appendSuffix(src, srcRaw)
      loadSrc = finalSrc
    } else if (!lmd) {
      loadSrc = finalSrc
    }
    originalImage.setAttribute('src', loadSrc)

    const alt = img.alt
    if (alt) img.setAttribute('alt', alt)
    const title = img.title

    if (opt.hideTitle) {
      img.removeAttribute('title')
    } else if (title) {
      img.setAttribute('title', title)
    }

    let decoding = img.getAttribute('decoding')
    if (!decoding) decoding = opt.asyncDecode ? 'async' : false
    let loading = img.getAttribute('loading')
    if (!loading) loading = opt.lazyLoad ? 'lazy' : false
    img.removeAttribute('decoding')
    img.removeAttribute('loading')

    const sizeSrc = img.getAttribute('src') || finalSrc

    if (imgExtReg.test(sizeSrc)) {
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
          title
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
