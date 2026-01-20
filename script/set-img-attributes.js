export default async (markdownCont, option) => {
  const { setImgSize, parseFrontmatter, getFrontmatter, normalizeRelativePath, resolveImageBase, resizeReg } = await import('./img-util.js')

  const isHttpUrl = (value) => /^https?:\/\//i.test(value)
  const isProtocolRelativeUrl = (value) => /^\/\//.test(value)
  const isFileUrl = (value) => /^file:\/\//i.test(value)
  const hasUrlScheme = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  const hasSpecialScheme = (value) => /^(data|blob|vscode-resource|vscode-webview-resource|vscode-file):/i.test(value)
  const stripQueryHash = (value) => value.split(/[?#]/)[0]
  const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const getAttr = (element, name) => {
    const value = element.getAttribute(name)
    return value == null ? '' : value
  }
  const hasAttr = (element, name) => {
    if (typeof element.hasAttribute === 'function') return element.hasAttribute(name)
    if (element.attributes && typeof element.attributes.has === 'function') return element.attributes.has(name)
    return element.getAttribute(name) != null
  }
  const setAttrIfChanged = (element, name, value) => {
    const nextValue = String(value)
    if (getAttr(element, name) === nextValue) return
    element.setAttribute(name, nextValue)
  }
  const removeAttrIfPresent = (element, name) => {
    if (!hasAttr(element, name)) return
    element.removeAttribute(name)
  }
  const getImageName = (imgSrc) => {
    const cleanSrc = stripQueryHash(imgSrc)
    const lastDotIndex = cleanSrc.lastIndexOf('.')
    const lastSlashIndex = Math.max(cleanSrc.lastIndexOf('/'), cleanSrc.lastIndexOf('\\'))

    if (lastDotIndex > lastSlashIndex) {
      return cleanSrc.substring(lastSlashIndex + 1, lastDotIndex)
    }
    return cleanSrc.substring(lastSlashIndex + 1)
  }
  const getBasename = (imgSrc) => {
    const cleanSrc = stripQueryHash(imgSrc || '')
    const lastSlashIndex = Math.max(cleanSrc.lastIndexOf('/'), cleanSrc.lastIndexOf('\\'))
    return cleanSrc.substring(lastSlashIndex + 1)
  }
  const applyOutputUrlMode = (value, mode) => {
    if (!value || !mode || mode === 'absolute') return value
    if (mode === 'protocol-relative') {
      return value.replace(/^https?:\/\//i, '//')
    }
    if (mode === 'path-only') {
      if (value.startsWith('//') || /^https?:\/\//i.test(value)) {
        const target = value.startsWith('//') ? `https:${value}` : value
        try {
          const parsed = new URL(target)
          return `${parsed.pathname}${parsed.search}${parsed.hash}`
        } catch {
          return value
        }
      }
    }
    return value
  }

  const opt = {
    scaleSuffix: false, // scale by @2x or dpi/ppi suffix
    resize: false, // resize by title hint
    lazyLoad: false, // add loading="lazy"
    asyncDecode: false, // add decoding="async"
    checkImgExtensions: 'png,jpg,jpeg,gif,webp', // size only these extensions
    modifyImgSrc: true, // rewrite src using frontmatter
    imgSrcPrefix: '', // replace origin of base URL
    urlImageBase: '', // fallback base when frontmatter lacks urlimagebase
    outputUrlMode: 'absolute', // absolute | protocol-relative | path-only
    hideTitle: false, // legacy alias (use autoHideResizeTitle)
    autoHideResizeTitle: true, // remove title when resize hint used
    resizeDataAttr: 'data-img-resize', // store resize hint when title removed
    suppressErrors: 'none', // 'none' | 'all' | 'local' | 'remote'
    suppressLoadErrors: false, // legacy alias (use suppressErrors)
    readMeta: false, // read meta[name="markdown-frontmatter"]
    observe: false, // watch DOM changes
  }
  if (option) Object.assign(opt, option)
  const optionOverrides = new Set(option ? Object.keys(option) : [])
  if (optionOverrides.has('hideTitle') && !optionOverrides.has('autoHideResizeTitle')) {
    opt.autoHideResizeTitle = opt.hideTitle
    optionOverrides.add('autoHideResizeTitle')
  }
  if (optionOverrides.has('suppressLoadErrors') && !optionOverrides.has('suppressErrors')) {
    opt.suppressErrors = opt.suppressLoadErrors ? 'all' : 'none'
    optionOverrides.add('suppressErrors')
  }

  const readMetaFrontmatter = () => {
    if (!opt.readMeta) return null
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null
    const metaTag = document.querySelector('meta[name="markdown-frontmatter"]')
    if (!metaTag) return null
    const content = metaTag.getAttribute('content')
    if (!content) return null
    const parseJson = (value) => {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    }
    let parsed = parseJson(content)
    if (!parsed && content.includes('&quot;')) {
      parsed = parseJson(content.replace(/&quot;/g, '"'))
    }
    return parsed && typeof parsed === 'object' ? parsed : null
  }

  const applyRendererOptions = (targetOpt, rendererSettings) => {
    if (!rendererSettings || typeof rendererSettings !== 'object') return
    const setBool = (key, value) => {
      if (optionOverrides.has(key)) return
      if (typeof value === 'boolean') targetOpt[key] = value
    }
    const setString = (key, value) => {
      if (optionOverrides.has(key)) return
      if (typeof value === 'string') targetOpt[key] = value
    }

    setBool('scaleSuffix', rendererSettings.scaleSuffix)
    setBool('resize', rendererSettings.resize)
    setBool('lazyLoad', rendererSettings.lazyLoad)
    setBool('asyncDecode', rendererSettings.asyncDecode)
    setBool('modifyImgSrc', rendererSettings.modifyImgSrc)
    setString('imgSrcPrefix', rendererSettings.imgSrcPrefix)
    setString('urlImageBase', rendererSettings.urlImageBase)
    setString('outputUrlMode', rendererSettings.outputUrlMode)
    setString('checkImgExtensions', rendererSettings.checkImgExtensions)
    setString('resizeDataAttr', rendererSettings.resizeDataAttr)
    setString('suppressErrors', rendererSettings.suppressErrors)
    if (!optionOverrides.has('suppressErrors') && typeof rendererSettings.suppressLoadErrors === 'boolean') {
      targetOpt.suppressErrors = rendererSettings.suppressLoadErrors ? 'all' : 'none'
    }

    if (!optionOverrides.has('scaleSuffix') && typeof rendererSettings.disableScaleSuffix === 'boolean') {
      targetOpt.scaleSuffix = !rendererSettings.disableScaleSuffix
    }
    if (!optionOverrides.has('resize') && typeof rendererSettings.disableResize === 'boolean') {
      targetOpt.resize = !rendererSettings.disableResize
    }
    if (!optionOverrides.has('lazyLoad') && typeof rendererSettings.disableLazyLoad === 'boolean') {
      targetOpt.lazyLoad = !rendererSettings.disableLazyLoad
    }

    if (!optionOverrides.has('autoHideResizeTitle') && typeof rendererSettings.autoHideResizeTitle === 'boolean') {
      targetOpt.autoHideResizeTitle = rendererSettings.autoHideResizeTitle
    }
    if (!optionOverrides.has('autoHideResizeTitle') && typeof rendererSettings.hideTitle === 'boolean') {
      targetOpt.autoHideResizeTitle = rendererSettings.hideTitle
    }
    if (!optionOverrides.has('autoHideResizeTitle') && typeof rendererSettings.keepTitle === 'boolean') {
      targetOpt.autoHideResizeTitle = !rendererSettings.keepTitle
    }
  }

  const buildContext = () => {
    let frontmatter = {}
    if (markdownCont) frontmatter = parseFrontmatter(markdownCont)

    const meta = readMetaFrontmatter()
    let extensionSettings = null
    if (meta) {
      if (meta._extensionSettings && typeof meta._extensionSettings === 'object') {
        extensionSettings = meta._extensionSettings
      }
      const { _extensionSettings, ...frontmatterFromMeta } = meta
      if (Object.keys(frontmatterFromMeta).length > 0) {
        frontmatter = { ...frontmatter, ...frontmatterFromMeta }
      }
    }

    const currentOpt = { ...opt }
    if (extensionSettings) {
      if (extensionSettings.notSetImageElementAttributes || extensionSettings.disableRendererImage) {
        return { skip: true }
      }
      if (extensionSettings.rendererImage) {
        applyRendererOptions(currentOpt, extensionSettings.rendererImage)
      }
    }

    if (!['none', 'all', 'local', 'remote'].includes(currentOpt.suppressErrors)) {
      console.warn(`[renderer-image(dom)] Invalid suppressErrors value: ${currentOpt.suppressErrors}. Using 'none'.`)
      currentOpt.suppressErrors = 'none'
    }

    const resolvedFrontmatter = getFrontmatter(frontmatter, currentOpt) || {}
    const { url, urlimage, urlimagebase, lid, lmd, imageDir, hasImageDir, imageScale } = resolvedFrontmatter
    const imageBase = resolveImageBase({
      url,
      urlimage,
      urlimagebase: urlimagebase || currentOpt.urlImageBase,
    }, currentOpt)
    const lidPattern = lid
      ? new RegExp('^(?:\\.\\/)?' + escapeForRegExp(lid).replace(/\//g, '\\/'))
      : null
    let adjustedLmd = ''
    if (lmd) {
      adjustedLmd = lmd.replace(/\\/g, '/')
      if (!isProtocolRelativeUrl(adjustedLmd) && !isFileUrl(adjustedLmd) && !hasUrlScheme(adjustedLmd) && !hasSpecialScheme(adjustedLmd)) {
        adjustedLmd = 'file:///' + adjustedLmd.replace(/^\/+/, '')
      }
      if (adjustedLmd && !adjustedLmd.endsWith('/')) adjustedLmd += '/'
    }
    const resizeDataAttr = typeof currentOpt.resizeDataAttr === 'string' && currentOpt.resizeDataAttr.trim()
      ? currentOpt.resizeDataAttr
      : ''
    const imgExtReg = new RegExp('\\.(?:' + currentOpt.checkImgExtensions.split(',').join('|') + ')(?=$|[?#])', 'i')

    return {
      opt: currentOpt,
      imageBase,
      lidPattern,
      adjustedLmd,
      imgExtReg,
      resizeDataAttr,
      imageDir,
      hasImageDir,
      imageScale,
    }
  }

  const processImages = async (targetImages = null) => {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return []

    const context = buildContext()
    if (context.skip) return []

    const { opt: currentOpt, imageBase, lidPattern, adjustedLmd, imgExtReg, resizeDataAttr, imageDir, hasImageDir, imageScale } = context
    const images = targetImages ? Array.from(targetImages) : Array.from(document.querySelectorAll('img'))
    if (images.length === 0) return []
    const setImagePromises = images.map(async (img) => {
      if (typeof img.isConnected === 'boolean' && !img.isConnected) return
      const srcRaw = img.getAttribute('src') || ''
      const srcBase = stripQueryHash(srcRaw)
      const srcSuffix = srcRaw.slice(srcBase.length)
      const isLocalSrc = !isHttpUrl(srcRaw) && !isProtocolRelativeUrl(srcRaw) && !isFileUrl(srcRaw)

      let src = srcBase
      let finalSrc = srcRaw
      let loadSrc = srcRaw

      if (currentOpt.modifyImgSrc) {
        if (isLocalSrc) {
          if (lidPattern) src = src.replace(lidPattern, '')

          const localNormalized = normalizeRelativePath(src)
          if (adjustedLmd) loadSrc = adjustedLmd + localNormalized + srcSuffix

          let nextSrc = localNormalized
          if (imageBase && !localNormalized.startsWith('/')) {
            if (hasImageDir) {
              nextSrc = getBasename(nextSrc)
              if (imageDir) nextSrc = `${imageDir}${nextSrc}`
            }
            nextSrc = `${imageBase}${nextSrc}`
          }
          src = normalizeRelativePath(nextSrc)
        }
        finalSrc = applyOutputUrlMode(src + srcSuffix, currentOpt.outputUrlMode)
        setAttrIfChanged(img, 'src', finalSrc)
      }

      // Decide source used for size measurement
      if (!currentOpt.modifyImgSrc) {
        finalSrc = applyOutputUrlMode(src + srcSuffix, currentOpt.outputUrlMode)
        loadSrc = finalSrc
      } else if (!adjustedLmd || !isLocalSrc) {
        loadSrc = finalSrc
      }

      const alt = img.alt
      if (alt) setAttrIfChanged(img, 'alt', alt)
      const titleAttr = getAttr(img, 'title')
      const storedTitle = resizeDataAttr ? getAttr(img, resizeDataAttr) : ''
      const titleHasResizeHint = !!(titleAttr && resizeReg.test(titleAttr))
      const storedHasResizeHint = !!(storedTitle && resizeReg.test(storedTitle))
      const resizeTitle = titleHasResizeHint
        ? titleAttr
        : (!titleAttr && storedHasResizeHint ? storedTitle : '')
      const hasResizeHint = currentOpt.resize && !!resizeTitle

      const removeTitle = currentOpt.autoHideResizeTitle && hasResizeHint
      if (removeTitle) {
        if (resizeDataAttr && resizeTitle) setAttrIfChanged(img, resizeDataAttr, resizeTitle)
        removeAttrIfPresent(img, 'title')
      } else if (titleAttr) {
        setAttrIfChanged(img, 'title', titleAttr)
      }
      if (resizeDataAttr && !removeTitle) {
        if (titleAttr) {
          removeAttrIfPresent(img, resizeDataAttr)
        } else if (storedTitle && !storedHasResizeHint) {
          removeAttrIfPresent(img, resizeDataAttr)
        }
      }
      const currentDecoding = getAttr(img, 'decoding')
      const desiredDecoding = currentDecoding || (currentOpt.asyncDecode ? 'async' : '')
      if (desiredDecoding) {
        setAttrIfChanged(img, 'decoding', desiredDecoding)
      } else {
        removeAttrIfPresent(img, 'decoding')
      }
      const currentLoading = getAttr(img, 'loading')
      const desiredLoading = currentLoading || (currentOpt.lazyLoad ? 'lazy' : '')
      if (desiredLoading) {
        setAttrIfChanged(img, 'loading', desiredLoading)
      } else {
        removeAttrIfPresent(img, 'loading')
      }

      const sizeSrc = getAttr(img, 'src') || finalSrc

      if (imgExtReg.test(sizeSrc)) {
        const originalImage = new Image()
        const isRemoteForError = isHttpUrl(loadSrc) || isProtocolRelativeUrl(loadSrc)
        const suppressByType = currentOpt.suppressErrors === 'all'
          || (currentOpt.suppressErrors === 'local' && !isRemoteForError)
          || (currentOpt.suppressErrors === 'remote' && isRemoteForError)
        const suppressLoadErrors = currentOpt.suppressLoadErrors || suppressByType
        originalImage.setAttribute('src', loadSrc)
        try {
          let loadError = false
          if (!originalImage.complete) {
            await new Promise((resolve) => {
              originalImage.onload = resolve
              originalImage.onerror = () => {
                loadError = true
                resolve()
              }
            })
          }
          if (loadError && !suppressLoadErrors) {
            console.error(`[renderer-image(dom)] Can't load image: ${loadSrc}`)
          }
        } catch (error) {
          if (!suppressLoadErrors) console.error(`[renderer-image(dom)] ${src}`, error)
        }

        if (originalImage.naturalWidth && originalImage.naturalHeight) {
          const imgName = getImageName(sizeSrc)
          const { width, height } = setImgSize(
            imgName,
            { width: originalImage.naturalWidth, height: originalImage.naturalHeight },
            currentOpt.scaleSuffix,
            currentOpt.resize,
            resizeTitle,
            imageScale
          )

          setAttrIfChanged(img, 'width', width)
          setAttrIfChanged(img, 'height', height)
        }
      }
    })

    return Promise.all(setImagePromises)
  }

  if (!opt.observe) {
    return processImages()
  }

  if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
    let scheduled = false
    let running = false
    let pending = false
    let pendingAll = false
    const pendingImages = new Set()
    let observer = null

    const runProcess = async () => {
      if (running) {
        pending = true
        return
      }
      running = true
      do {
        pending = false
        const useAll = pendingAll
        const targets = useAll ? null : Array.from(pendingImages)
        pendingAll = false
        pendingImages.clear()
        await processImages(targets)
      } while (pending)
      running = false
    }

    const scheduleProcess = () => {
      if (scheduled) return
      scheduled = true
      const run = () => {
        scheduled = false
        runProcess()
      }
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run)
      } else {
        setTimeout(run, 50)
      }
    }

    const isElementNode = (node) => node && node.nodeType === 1
    const isMetaNode = (node) => {
      if (!opt.readMeta || !isElementNode(node)) return false
      return node.tagName === 'META' && node.getAttribute('name') === 'markdown-frontmatter'
    }
    const isImageNode = (node) => isElementNode(node) && node.tagName === 'IMG'

    const collectImagesFromNodes = (nodes) => {
      if (!nodes) return
      for (const node of nodes) {
        if (!isElementNode(node)) continue
        if (isImageNode(node)) {
          pendingImages.add(node)
          continue
        }
        if (node.querySelectorAll) {
          const images = node.querySelectorAll('img')
          for (const image of images) pendingImages.add(image)
        }
      }
    }

    const hasMetaInNodes = (nodes) => {
      if (!opt.readMeta || !nodes) return false
      for (const node of nodes) {
        if (!isElementNode(node)) continue
        if (isMetaNode(node)) return true
        if (node.querySelector && node.querySelector('meta[name="markdown-frontmatter"]')) return true
      }
      return false
    }

    const attributeFilter = ['src', 'title', 'alt']
    if (opt.readMeta) attributeFilter.push('content')

    const startObserver = () => {
      if (observer) return
      const root = document.documentElement || document.body
      if (!root) return
      observer = new MutationObserver((mutations) => {
        let shouldSchedule = false
        let metaChanged = false
        for (const mutation of mutations) {
          if (!mutation) continue
          if (mutation.type === 'attributes') {
            const target = mutation.target
            if (isImageNode(target) && ['src', 'title', 'alt'].includes(mutation.attributeName)) {
              pendingImages.add(target)
              shouldSchedule = true
              continue
            }
            if (isMetaNode(target) && mutation.attributeName === 'content') {
              metaChanged = true
              shouldSchedule = true
              continue
            }
            continue
          }
          if (mutation.type !== 'childList') continue
          if (mutation.addedNodes && mutation.addedNodes.length > 0) {
            collectImagesFromNodes(mutation.addedNodes)
            if (pendingImages.size > 0) shouldSchedule = true
            if (hasMetaInNodes(mutation.addedNodes)) {
              metaChanged = true
              shouldSchedule = true
            }
          }
          if (mutation.removedNodes && mutation.removedNodes.length > 0) {
            if (hasMetaInNodes(mutation.removedNodes)) {
              metaChanged = true
              shouldSchedule = true
            }
          }
        }
        if (metaChanged) {
          pendingAll = true
          pendingImages.clear()
        }
        if (shouldSchedule) scheduleProcess()
      })
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter,
      })
    }

    startObserver()
  }

  return processImages()
}
