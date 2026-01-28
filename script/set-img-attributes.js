let utilsPromise = null

const loadUtils = async () => {
  if (!utilsPromise) {
    utilsPromise = import('./img-util.js')
  }
  return utilsPromise
}

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isAbsolutePath = (value) => {
  if (!value) return false
  if (value.startsWith('//')) return true
  if (value.startsWith('/')) return true
  return /^[A-Za-z]:\//.test(value)
}
const toFileUrl = (value) => {
  if (!value) return ''
  const normalized = String(value).replace(/\\/g, '/')
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
const getAttr = (element, name) => {
  if (!element) return ''
  const value = element.getAttribute ? element.getAttribute(name) : null
  return value == null ? '' : value
}
const hasAttr = (element, name) => {
  if (!element) return false
  if (typeof element.hasAttribute === 'function') return element.hasAttribute(name)
  if (element.attributes && typeof element.attributes.has === 'function') return element.attributes.has(name)
  return element.getAttribute && element.getAttribute(name) != null
}
const setAttrIfChanged = (element, name, value) => {
  if (!element || typeof element.setAttribute !== 'function') return
  const nextValue = String(value)
  if (getAttr(element, name) === nextValue) return
  element.setAttribute(name, nextValue)
}
const removeAttrIfPresent = (element, name) => {
  if (!element || typeof element.removeAttribute !== 'function') return
  if (!hasAttr(element, name)) return
  element.removeAttribute(name)
}
const originalSrcAttr = 'data-img-src-raw'
const collectImages = (root) => {
  if (!root) return []
  if (Array.isArray(root)) return root
  if (typeof root.querySelectorAll === 'function') return Array.from(root.querySelectorAll('img'))
  if (root.tagName === 'IMG') return [root]
  if (typeof root.length === 'number' && typeof root[Symbol.iterator] === 'function') return Array.from(root)
  return []
}

export const createContext = async (markdownCont = '', option = {}, root = null) => {
  const {
    setImgSize,
    parseFrontmatter,
    getFrontmatter,
    normalizeRelativePath,
    resolveImageBase,
    normalizeResizeValue,
    resizeValueReg,
    normalizeExtensions,
    isHttpUrl,
    isProtocolRelativeUrl,
    isFileUrl,
    hasUrlScheme,
    hasSpecialScheme,
    stripQueryHash,
    getBasename,
    getImageName,
    applyOutputUrlMode,
  } = await loadUtils()

  const opt = {
    scaleSuffix: false, // scale by @2x or dpi/ppi suffix
    resize: false, // resize by title hint
    lazyLoad: false, // add loading="lazy"
    asyncDecode: false, // add decoding="async"
    checkImgExtensions: 'png,jpg,jpeg,gif,webp', // size only these extensions
    resolveSrc: true, // resolve final src using frontmatter
    urlImageBase: '', // fallback base when frontmatter lacks urlimagebase
    outputUrlMode: 'absolute', // absolute | protocol-relative | path-only
    previewMode: 'output', // output | markdown | local
    previewOutputSrcAttr: 'data-img-output-src', // store final src when previewMode !== output
    setDomSrc: true, // write img.src in DOM
    autoHideResizeTitle: true, // remove title when resize hint used
    resizeDataAttr: 'data-img-resize', // store resize hint when title removed
    loadSrcResolver: null, // override loadSrc for size measurement
    loadSrcMap: null, // map markdown src to loadSrc for size measurement
    awaitSizeProbes: true, // await image load for size calculation
    sizeProbeTimeoutMs: 3000, // timeout for size probe (0 disables)
    onImageProcessed: null, // per-image callback
    noUpscale: true, // internal: prevent final size from exceeding original pixels
    suppressErrors: 'none', // 'none' | 'all' | 'local' | 'remote'
    readMeta: false, // read meta[name="markdown-frontmatter"]
  }
  const safeOption = option && typeof option === 'object' ? { ...option } : null
  if (safeOption && Object.prototype.hasOwnProperty.call(safeOption, 'noUpscale')) {
    delete safeOption.noUpscale
  }
  if (safeOption) Object.assign(opt, safeOption)
  const optionOverrides = new Set(safeOption ? Object.keys(safeOption) : [])

  const readMetaFrontmatter = () => {
    if (!opt.readMeta) return null
    const base = root && typeof root.querySelector === 'function'
      ? root
      : (typeof document !== 'undefined' ? document : null)
    if (!base || typeof base.querySelector !== 'function') return null
    const metaTag = base.querySelector('meta[name="markdown-frontmatter"]')
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
    const setFunc = (key, value) => {
      if (optionOverrides.has(key)) return
      if (typeof value === 'function') targetOpt[key] = value
    }
    const setString = (key, value) => {
      if (optionOverrides.has(key)) return
      if (typeof value === 'string') targetOpt[key] = value
    }
    const setNumber = (key, value) => {
      if (optionOverrides.has(key)) return
      if (Number.isFinite(value)) targetOpt[key] = value
    }
    const setObject = (key, value) => {
      if (optionOverrides.has(key)) return
      if (value && typeof value === 'object' && !Array.isArray(value)) targetOpt[key] = value
    }

    setBool('scaleSuffix', rendererSettings.scaleSuffix)
    setBool('resize', rendererSettings.resize)
    setBool('lazyLoad', rendererSettings.lazyLoad)
    setBool('asyncDecode', rendererSettings.asyncDecode)
    setBool('resolveSrc', rendererSettings.resolveSrc)
    setBool('setDomSrc', rendererSettings.setDomSrc)
    setBool('awaitSizeProbes', rendererSettings.awaitSizeProbes)
    setString('previewMode', rendererSettings.previewMode)
    setString('urlImageBase', rendererSettings.urlImageBase)
    setString('outputUrlMode', rendererSettings.outputUrlMode)
    setString('checkImgExtensions', rendererSettings.checkImgExtensions)
    setString('resizeDataAttr', rendererSettings.resizeDataAttr)
    setString('previewOutputSrcAttr', rendererSettings.previewOutputSrcAttr)
    setString('suppressErrors', rendererSettings.suppressErrors)
    setFunc('loadSrcResolver', rendererSettings.loadSrcResolver)
    setFunc('onImageProcessed', rendererSettings.onImageProcessed)
    setObject('loadSrcMap', rendererSettings.loadSrcMap)
    setNumber('sizeProbeTimeoutMs', rendererSettings.sizeProbeTimeoutMs)

    if (!optionOverrides.has('autoHideResizeTitle') && typeof rendererSettings.autoHideResizeTitle === 'boolean') {
      targetOpt.autoHideResizeTitle = rendererSettings.autoHideResizeTitle
    }
  }

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
  const suppressErrorsOverridden = optionOverrides.has('suppressErrors')
    || (extensionSettings?.rendererImage
      && Object.prototype.hasOwnProperty.call(extensionSettings.rendererImage, 'suppressErrors'))
  if (extensionSettings) {
    if (extensionSettings.notSetImageElementAttributes || extensionSettings.disableRendererImage) {
      return { skip: true, opt: currentOpt }
    }
    if (extensionSettings.rendererImage) {
      applyRendererOptions(currentOpt, extensionSettings.rendererImage)
    }
  }
  if (!['none', 'all', 'local', 'remote'].includes(currentOpt.suppressErrors)) {
    console.warn(`[renderer-image(dom)] Invalid suppressErrors value: ${currentOpt.suppressErrors}. Using 'none'.`)
    currentOpt.suppressErrors = 'none'
  }
  const isFileProtocol = typeof location !== 'undefined' && location && location.protocol === 'file:'
  if (!suppressErrorsOverridden && isFileProtocol && currentOpt.suppressErrors === 'none') {
    currentOpt.suppressErrors = 'local'
  }
  const allowedPreviewModes = new Set(['output', 'markdown', 'local'])
  if (!allowedPreviewModes.has(currentOpt.previewMode)) {
    console.warn(`[renderer-image(dom)] Invalid previewMode: ${currentOpt.previewMode}. Using 'output'.`)
    currentOpt.previewMode = 'output'
  }
  if (!Number.isFinite(currentOpt.sizeProbeTimeoutMs) || currentOpt.sizeProbeTimeoutMs < 0) {
    currentOpt.sizeProbeTimeoutMs = 0
  }

  const resolvedFrontmatter = getFrontmatter(frontmatter, currentOpt) || {}
  const { url, urlimage, urlimagebase, lid, lmd, imageDir, hasImageDir, imageScale } = resolvedFrontmatter
  const imageBase = resolveImageBase({
    url,
    urlimage,
    urlimagebase: urlimagebase || currentOpt.urlImageBase,
  })
  const lidPattern = lid
    ? new RegExp('^(?:\\.\\/)?' + escapeForRegExp(lid).replace(/\//g, '\\/'))
    : null
  let adjustedLmd = ''
  if (lmd) {
    adjustedLmd = String(lmd).replace(/\\/g, '/')
    if (!isProtocolRelativeUrl(adjustedLmd) && !isFileUrl(adjustedLmd) && !hasUrlScheme(adjustedLmd) && !hasSpecialScheme(adjustedLmd)) {
      if (isAbsolutePath(adjustedLmd)) {
        adjustedLmd = toFileUrl(adjustedLmd)
      }
    }
    if (adjustedLmd && !adjustedLmd.endsWith('/')) adjustedLmd += '/'
  }
  const resizeDataAttr = typeof currentOpt.resizeDataAttr === 'string' && currentOpt.resizeDataAttr.trim()
    ? currentOpt.resizeDataAttr
    : ''
  const outputSrcAttr = typeof currentOpt.previewOutputSrcAttr === 'string' && currentOpt.previewOutputSrcAttr.trim()
    ? currentOpt.previewOutputSrcAttr
    : ''
  const extPattern = normalizeExtensions(currentOpt.checkImgExtensions).join('|')
  const imgExtReg = extPattern
    ? new RegExp('\\.(?:' + extPattern + ')(?=$|[?#])', 'i')
    : /a^/
  const loadSrcResolver = typeof currentOpt.loadSrcResolver === 'function' ? currentOpt.loadSrcResolver : null
  const loadSrcMap = currentOpt.loadSrcMap && typeof currentOpt.loadSrcMap === 'object'
    ? currentOpt.loadSrcMap
    : null
  const onImageProcessed = typeof currentOpt.onImageProcessed === 'function' ? currentOpt.onImageProcessed : null

  return {
    opt: currentOpt,
    imageBase,
    lidPattern,
    adjustedLmd,
    imgExtReg,
    resizeDataAttr,
    outputSrcAttr,
    loadSrcResolver,
    loadSrcMap,
    imageDir,
    hasImageDir,
    imageScale,
    onImageProcessed,
    utils: {
      setImgSize,
      normalizeRelativePath,
      normalizeResizeValue,
      resizeValueReg,
      normalizeExtensions,
      isHttpUrl,
      isProtocolRelativeUrl,
      isFileUrl,
      hasUrlScheme,
      hasSpecialScheme,
      stripQueryHash,
      getBasename,
      getImageName,
      applyOutputUrlMode,
    },
  }
}

export const applyImageTransforms = async (root, contextOrOptions = {}, markdownCont = '') => {
  if (!root) throw new Error('[renderer-image(dom)] root element is required')
  const context = contextOrOptions && contextOrOptions.opt
    ? contextOrOptions
    : await createContext(markdownCont, contextOrOptions, root)
  if (context.skip) return { total: 0, processed: 0, pending: 0, sized: 0, failed: 0, timeout: 0, skipped: 0 }

  const {
    opt: currentOpt,
    imageBase,
    lidPattern,
    adjustedLmd,
    imgExtReg,
    resizeDataAttr,
    outputSrcAttr,
    loadSrcResolver,
    loadSrcMap,
    imageDir,
    hasImageDir,
    imageScale,
    onImageProcessed,
    utils,
  } = context
  const {
    setImgSize,
    normalizeRelativePath,
    normalizeResizeValue,
    resizeValueReg,
    isHttpUrl,
    isProtocolRelativeUrl,
    isFileUrl,
    hasSpecialScheme,
    stripQueryHash,
    getBasename,
    getImageName,
    applyOutputUrlMode,
  } = utils

  const images = collectImages(root)
  const summary = {
    total: images.length,
    processed: 0,
    pending: 0,
    sized: 0,
    failed: 0,
    timeout: 0,
    skipped: 0,
  }

  const probeImage = (img, payload) => {
    const {
      loadSrc,
      sizeSrc,
      resizeTitleForSize,
    } = payload
    const imgName = getImageName(sizeSrc)
    const isRemoteForError = isHttpUrl(loadSrc) || isProtocolRelativeUrl(loadSrc)
    const suppressByType = currentOpt.suppressErrors === 'all'
      || (currentOpt.suppressErrors === 'local' && !isRemoteForError)
      || (currentOpt.suppressErrors === 'remote' && isRemoteForError)
    const suppressLoadErrors = suppressByType
    const timeoutMs = currentOpt.sizeProbeTimeoutMs

    return new Promise((resolve) => {
      let settled = false
      let timeoutId = null
      const done = (status, width = 0, height = 0) => {
        if (settled) return
        settled = true
        if (timeoutId) clearTimeout(timeoutId)
        const info = {
          status,
          width,
          height,
          loadSrc,
          finalSrc: payload.finalSrc,
          displaySrc: payload.displaySrc,
        }
        if (onImageProcessed) onImageProcessed(img, info)
        resolve(info)
      }

      const originalImage = new Image()
      originalImage.onload = () => {
        if (settled) return
        if (!originalImage.naturalWidth || !originalImage.naturalHeight) {
          done('failed')
          return
        }
        const { width, height } = setImgSize(
          imgName,
          { width: originalImage.naturalWidth, height: originalImage.naturalHeight },
          currentOpt.scaleSuffix,
          currentOpt.resize,
          resizeTitleForSize,
          imageScale,
          currentOpt.noUpscale
        )
        setAttrIfChanged(img, 'width', width)
        setAttrIfChanged(img, 'height', height)
        done('sized', width, height)
      }
      originalImage.onerror = () => {
        if (settled) return
        if (!suppressLoadErrors) {
          console.error(`[renderer-image(dom)] Can't load image: ${loadSrc}`)
        }
        done('failed')
      }

      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          done('timeout')
        }, timeoutMs)
      }

      try {
        originalImage.setAttribute('src', loadSrc)
        if (originalImage.complete) {
          originalImage.onload()
        }
      } catch (error) {
        if (!suppressLoadErrors) console.error(`[renderer-image(dom)] ${loadSrc}`, error)
        done('failed')
      }
    })
  }

  const tasks = []

  for (const img of images) {
    if (!img) continue
    if (typeof img.isConnected === 'boolean' && !img.isConnected) {
      summary.skipped += 1
      continue
    }
    summary.processed += 1

    const storedOriginalSrc = getAttr(img, originalSrcAttr)
    const useStored = currentOpt.previewMode !== 'output' && storedOriginalSrc
    const srcRaw = useStored ? storedOriginalSrc : (getAttr(img, 'src') || '')
    const srcBase = stripQueryHash(srcRaw)
    const srcSuffix = srcRaw.slice(srcBase.length)
    const isLocalSrc = !isHttpUrl(srcRaw)
      && !isProtocolRelativeUrl(srcRaw)
      && !isFileUrl(srcRaw)
      && !hasSpecialScheme(srcRaw)

    let src = srcBase
    let finalSrc = srcRaw
    let loadSrc = srcRaw
    let localDisplaySrc = ''

    if (currentOpt.resolveSrc) {
      if (isLocalSrc) {
        if (lidPattern) src = src.replace(lidPattern, '')

        const localNormalized = normalizeRelativePath(src)
        if (adjustedLmd) {
          localDisplaySrc = adjustedLmd + localNormalized + srcSuffix
          loadSrc = localDisplaySrc
        }

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
    } else {
      finalSrc = applyOutputUrlMode(src + srcSuffix, currentOpt.outputUrlMode)
    }

    if (!currentOpt.resolveSrc) {
      loadSrc = finalSrc
    } else if (!adjustedLmd || !isLocalSrc) {
      loadSrc = finalSrc
    }
    if (loadSrcResolver) {
      const resolved = loadSrcResolver(srcRaw, {
        finalSrc,
        loadSrc,
        isLocalSrc,
        isRemote: isHttpUrl(loadSrc) || isProtocolRelativeUrl(loadSrc),
      })
      if (typeof resolved === 'string' && resolved) {
        loadSrc = resolved
      }
    } else if (loadSrcMap) {
      const mapped = loadSrcMap[srcRaw] || loadSrcMap[finalSrc]
      if (typeof mapped === 'string' && mapped) {
        loadSrc = mapped
      }
    }

    let displaySrc = finalSrc
    if (currentOpt.previewMode === 'markdown' && isLocalSrc) {
      displaySrc = storedOriginalSrc || srcRaw
    }
    if (currentOpt.previewMode === 'local' && isLocalSrc) {
      displaySrc = localDisplaySrc || storedOriginalSrc || srcRaw
    }

    if (currentOpt.previewMode !== 'output') {
      if (!storedOriginalSrc && srcRaw) setAttrIfChanged(img, originalSrcAttr, srcRaw)
      if (outputSrcAttr && finalSrc) setAttrIfChanged(img, outputSrcAttr, finalSrc)
    } else {
      removeAttrIfPresent(img, originalSrcAttr)
      if (outputSrcAttr) removeAttrIfPresent(img, outputSrcAttr)
    }

    if (currentOpt.setDomSrc) {
      setAttrIfChanged(img, 'src', displaySrc)
    }

    const alt = img.alt
    if (alt) setAttrIfChanged(img, 'alt', alt)
    const titleAttr = getAttr(img, 'title')
    const storedTitle = resizeDataAttr ? getAttr(img, resizeDataAttr) : ''
    const titleResizeValue = currentOpt.resize ? normalizeResizeValue(titleAttr) : ''
    let storedResizeValue = ''
    if (currentOpt.resize && storedTitle) {
      const normalizedStored = String(storedTitle).trim().replace('％', '%').toLowerCase()
      if (resizeValueReg.test(normalizedStored)) storedResizeValue = normalizedStored
    }
    const resizeValue = titleResizeValue || (!titleAttr ? storedResizeValue : '')
    const resizeTitleForSize = titleResizeValue
      ? titleAttr
      : (!titleAttr && storedResizeValue ? `resize:${storedResizeValue}` : '')

    const removeTitle = currentOpt.autoHideResizeTitle && !!titleResizeValue
    if (removeTitle) {
      if (resizeDataAttr && resizeValue) setAttrIfChanged(img, resizeDataAttr, resizeValue)
      removeAttrIfPresent(img, 'title')
    } else if (titleAttr) {
      setAttrIfChanged(img, 'title', titleAttr)
    }
    if (resizeDataAttr && !removeTitle) {
      if (titleAttr) {
        removeAttrIfPresent(img, resizeDataAttr)
      } else if (storedTitle && !storedResizeValue) {
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

    const sizeSrc = finalSrc || srcRaw || loadSrc
    if (!sizeSrc || !imgExtReg.test(sizeSrc)) {
      summary.skipped += 1
      if (onImageProcessed) {
        onImageProcessed(img, {
          status: 'skipped',
          loadSrc,
          finalSrc,
          displaySrc,
        })
      }
      continue
    }

    const payload = {
      loadSrc,
      sizeSrc,
      resizeTitleForSize,
      finalSrc,
      displaySrc,
    }
    const promise = probeImage(img, payload).then((info) => {
      if (info.status === 'sized') summary.sized += 1
      else if (info.status === 'timeout') summary.timeout += 1
      else if (info.status === 'failed') summary.failed += 1
      else summary.skipped += 1
      return info
    })
    summary.pending += 1
    tasks.push(promise)
  }

  if (currentOpt.awaitSizeProbes) {
    await Promise.allSettled(tasks)
    summary.pending = 0
  } else {
    for (const task of tasks) task.catch(() => {})
  }

  return summary
}

export const startObserver = async (root, contextOrOptions = {}, markdownCont = '') => {
  if (!root) throw new Error('[renderer-image(dom)] root element is required')
  if (typeof MutationObserver !== 'function') {
    return { disconnect: () => {} }
  }

  let context = contextOrOptions && contextOrOptions.opt
    ? contextOrOptions
    : await createContext(markdownCont, contextOrOptions, root)

  let scheduled = false
  let running = false
  let pending = false
  let pendingAll = false
  const pendingImages = new Set()

  const runProcess = async () => {
    if (running) {
      pending = true
      return
    }
    running = true
    do {
      pending = false
      const useAll = pendingAll
      const targets = useAll ? root : Array.from(pendingImages)
      pendingAll = false
      pendingImages.clear()
      if (!context || !context.opt) {
        context = await createContext(markdownCont, contextOrOptions, root)
      }
      await applyImageTransforms(targets, context)
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
    if (!context?.opt?.readMeta || !isElementNode(node)) return false
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
    if (!context?.opt?.readMeta || !nodes) return false
    for (const node of nodes) {
      if (!isElementNode(node)) continue
      if (isMetaNode(node)) return true
      if (node.querySelector && node.querySelector('meta[name="markdown-frontmatter"]')) return true
    }
    return false
  }

  const attributeFilter = ['src', 'title', 'alt']
  if (context?.opt?.readMeta) attributeFilter.push('content')

  const observer = new MutationObserver((mutations) => {
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
      context = null
    }
    if (shouldSchedule) scheduleProcess()
  })

  const rootNode = root.documentElement || root.body || root
  observer.observe(rootNode, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter,
  })

  return {
    disconnect: () => observer.disconnect(),
  }
}
