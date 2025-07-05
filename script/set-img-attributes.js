export default async (markdownCont, option) => {
  const { setImgSize, parseFrontmatter, getFrontmatter, normalizeRelativePath } = await import('./img-util.js')
  const getImageName = (imgSrc) => {
    const lastDotIndex = imgSrc.lastIndexOf('.')
    const lastSlashIndex = Math.max(imgSrc.lastIndexOf('/'), imgSrc.lastIndexOf('\\'))

    if (lastDotIndex > lastSlashIndex) {
      return imgSrc.substring(lastSlashIndex + 1, lastDotIndex)
    }
    return imgSrc.substring(lastSlashIndex + 1)
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
  }
  if (option) Object.assign(opt, option)

  let frontmatter = {}
  if (markdownCont) frontmatter = parseFrontmatter(markdownCont)
  const { url, lid, lmd } = getFrontmatter(frontmatter, opt)

  const imgExtReg = new RegExp('\\.(?:' + opt.checkImgExtensions.split(',').join('|') + ')$', 'i')

  const images = document.querySelectorAll('img')
  const setImagePromises = Array.from(images).map(async (img) => {
    const srcRaw = img.getAttribute('src')

    const originalImage = new Image()
    originalImage.setAttribute('src', srcRaw)
    let src = srcRaw

    if (opt.modifyImgSrc) {
      if (!/^https?:\/\//.test(srcRaw)) {
        // Handle lid (local image directory) processing
        if (lid) {
          // Remove lid prefix from src if it matches
          const lidPattern = new RegExp('^(?:\\.\\/)?' + lid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/'))
          src = src.replace(lidPattern, '')
        }

        if (lmd) {
          let adjustedLmd = lmd.replace(/\\/g, '/')
          if (!/^file:\/\/\//.test(adjustedLmd)) adjustedLmd = 'file:///' + adjustedLmd
          originalImage.setAttribute('src', adjustedLmd + src)
        }

        if (url) src = `${url}${src}`
      }
      // Normalize the final src to remove any relative path markers
      src = normalizeRelativePath(src)
      img.setAttribute('src', src)
    }

    const alt = img.alt
    if (alt) img.setAttribute('alt', alt)
    const title = img.title
    
    if (opt.hideTitle) {
      // Remove title attribute when hideTitle is enabled
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

    if (imgExtReg.test(srcRaw)) {
      try {
        if (!originalImage.complete) {
          await new Promise((resolve) => {
            originalImage.onload = resolve
            originalImage.onerror = resolve
          })
        }
      } catch (error) {
        console.error(`[renderer-image(dom)] ${src}`, error)
      }

      if (originalImage.naturalWidth && originalImage.naturalHeight) {
        const imgName = getImageName(src)
        const { width, height } = setImgSize(imgName, { width: originalImage.naturalWidth, height: originalImage.naturalHeight }, opt.scaleSuffix, opt.resize, title)

        img.setAttribute('width', width)
        img.setAttribute('height', height)
      }
    }
    if (decoding) img.setAttribute('decoding', decoding)
    if (loading) img.setAttribute('loading', loading)
  })

  return Promise.all(setImagePromises)
}