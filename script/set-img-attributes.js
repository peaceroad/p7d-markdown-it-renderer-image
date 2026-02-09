import {
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
  isAbsolutePath,
  toFileUrl,
  escapeForRegExp,
  stripQueryHash,
  getBasename,
  getImageName,
  applyOutputUrlMode,
} from './img-util.js'
import { defaultSharedOptions, defaultDomOptions, defaultNodeOptions } from './default-options.js'

export { defaultSharedOptions, defaultDomOptions, defaultNodeOptions }

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
const observedImgAttributes = new Set(['src', 'title', 'alt'])
const allowedPreviewModes = new Set(['output', 'markdown', 'local'])
const allowedLoadSrcStrategies = new Set(['output', 'raw', 'display'])
const emptySummary = Object.freeze({
  total: 0,
  processed: 0,
  pending: 0,
  sized: 0,
  failed: 0,
  timeout: 0,
  skipped: 0,
})
const createSummary = (total = 0) => ({
  ...emptySummary,
  total,
})
const safeInvokeImageProcessed = (handler, img, info, suppressErrors = false) => {
  if (!handler) return
  try {
    handler(img, info)
  } catch (error) {
    if (!suppressErrors && typeof console !== 'undefined' && console && typeof console.error === 'function') {
      console.error('[renderer-image(dom)] onImageProcessed hook failed.', error)
    }
  }
}
const normalizePrefixMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const entries = []
  for (const [from, to] of Object.entries(value)) {
    if (!from || typeof from !== 'string') continue
    if (typeof to !== 'string') continue
    entries.push([from, to])
  }
  return entries.sort((a, b) => b[0].length - a[0].length)
}
const applyPrefixMap = (value, entries) => {
  const text = String(value || '')
  if (!text || !entries || entries.length === 0) return text
  for (const [from, to] of entries) {
    if (text.startsWith(from)) return to + text.slice(from.length)
  }
  return text
}
const isImgTag = (node) => !!(node && typeof node.tagName === 'string' && node.tagName.toUpperCase() === 'IMG')
const collectImages = (root) => {
  if (!root) return []
  if (Array.isArray(root)) return root.filter(isImgTag)
  if (isImgTag(root)) return [root]
  if (typeof root.querySelectorAll === 'function') return Array.from(root.querySelectorAll('img'))
  if (typeof root.length === 'number' && typeof root[Symbol.iterator] === 'function') return Array.from(root).filter(isImgTag)
  return []
}

export const createContext = async (markdownCont = '', option = {}, root = null) => {
  const opt = { ...defaultDomOptions }
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
    setBool('enableSizeProbe', rendererSettings.enableSizeProbe)
    setBool('awaitSizeProbes', rendererSettings.awaitSizeProbes)
    setBool('suppressNoopWarning', rendererSettings.suppressNoopWarning)
    setString('previewMode', rendererSettings.previewMode)
    setString('loadSrcStrategy', rendererSettings.loadSrcStrategy)
    setString('urlImageBase', rendererSettings.urlImageBase)
    setString('outputUrlMode', rendererSettings.outputUrlMode)
    setString('checkImgExtensions', rendererSettings.checkImgExtensions)
    setString('resizeDataAttr', rendererSettings.resizeDataAttr)
    setString('previewOutputSrcAttr', rendererSettings.previewOutputSrcAttr)
    setString('suppressErrors', rendererSettings.suppressErrors)
    setFunc('loadSrcResolver', rendererSettings.loadSrcResolver)
    setFunc('onImageProcessed', rendererSettings.onImageProcessed)
    setObject('loadSrcMap', rendererSettings.loadSrcMap)
    setObject('loadSrcPrefixMap', rendererSettings.loadSrcPrefixMap)
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
  const enableSizeProbeOverridden = optionOverrides.has('enableSizeProbe')
    || (extensionSettings?.rendererImage
      && Object.prototype.hasOwnProperty.call(extensionSettings.rendererImage, 'enableSizeProbe'))
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
  if (isFileProtocol && !enableSizeProbeOverridden) {
    currentOpt.enableSizeProbe = false
  }
  if (!allowedPreviewModes.has(currentOpt.previewMode)) {
    console.warn(`[renderer-image(dom)] Invalid previewMode: ${currentOpt.previewMode}. Using 'output'.`)
    currentOpt.previewMode = 'output'
  }
  if (currentOpt.loadSrcStrategy === 'final') currentOpt.loadSrcStrategy = 'output'
  if (!allowedLoadSrcStrategies.has(currentOpt.loadSrcStrategy)) {
    console.warn(`[renderer-image(dom)] Invalid loadSrcStrategy: ${currentOpt.loadSrcStrategy}. Using 'output'.`)
    currentOpt.loadSrcStrategy = 'output'
  }
  if (!Number.isFinite(currentOpt.sizeProbeTimeoutMs) || currentOpt.sizeProbeTimeoutMs < 0) {
    currentOpt.sizeProbeTimeoutMs = 0
  }
  if (typeof currentOpt.enableSizeProbe !== 'boolean') {
    currentOpt.enableSizeProbe = true
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
  const loadSrcPrefixEntries = normalizePrefixMap(currentOpt.loadSrcPrefixMap)
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
    loadSrcPrefixEntries,
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
  if (context.skip) return createSummary()

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
    loadSrcPrefixEntries,
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
  const summary = createSummary(images.length)

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
        safeInvokeImageProcessed(onImageProcessed, img, info, currentOpt.suppressErrors === 'all')
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

    let displaySrc = finalSrc
    if (currentOpt.previewMode === 'markdown' && isLocalSrc) {
      displaySrc = storedOriginalSrc || srcRaw
    }
    if (currentOpt.previewMode === 'local' && isLocalSrc) {
      displaySrc = localDisplaySrc || storedOriginalSrc || srcRaw
    }

    if (currentOpt.loadSrcStrategy === 'raw') {
      loadSrc = srcRaw
    } else if (currentOpt.loadSrcStrategy === 'display') {
      loadSrc = displaySrc
    }
    if (loadSrcPrefixEntries.length) {
      loadSrc = applyPrefixMap(loadSrc, loadSrcPrefixEntries)
    }
    if (loadSrcResolver) {
      try {
        const resolved = loadSrcResolver(srcRaw, {
          finalSrc,
          loadSrc,
          isLocalSrc,
          isRemote: isHttpUrl(loadSrc) || isProtocolRelativeUrl(loadSrc),
        })
        if (typeof resolved === 'string' && resolved) {
          loadSrc = resolved
        }
      } catch (error) {
        if (currentOpt.suppressErrors !== 'all') {
          console.error('[renderer-image(dom)] loadSrcResolver hook failed.', error)
        }
      }
    } else if (loadSrcMap) {
      const mapped = loadSrcMap[srcRaw] || loadSrcMap[finalSrc]
      if (typeof mapped === 'string' && mapped) {
        loadSrc = mapped
      }
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
      safeInvokeImageProcessed(onImageProcessed, img, {
        status: 'skipped',
        loadSrc,
        finalSrc,
        displaySrc,
      }, currentOpt.suppressErrors === 'all')
      continue
    }
    if (!currentOpt.enableSizeProbe) {
      summary.skipped += 1
      safeInvokeImageProcessed(onImageProcessed, img, {
        status: 'skipped',
        loadSrc,
        finalSrc,
        displaySrc,
      }, currentOpt.suppressErrors === 'all')
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
      runProcess().catch((error) => {
        if (context?.opt?.suppressErrors !== 'all') {
          console.error('[renderer-image(dom)] MutationObserver processing failed.', error)
        }
      })
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
  const isImageNode = (node) => isElementNode(node) && isImgTag(node)

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
        if (isImageNode(target) && observedImgAttributes.has(mutation.attributeName)) {
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

/**
 * High-level helper for live previews.
 * Creates context, applies transforms once, and optionally starts observation.
 */
export const runInPreview = async (setup = {}) => {
  const safeSetup = setup && typeof setup === 'object' ? setup : {}
  const root = safeSetup.root
  if (!root) throw new Error('[renderer-image(dom)] runInPreview requires root.')

  const markdownCont = typeof safeSetup.markdownCont === 'string' ? safeSetup.markdownCont : ''
  const observe = !!safeSetup.observe
  const providedContext = safeSetup.context && safeSetup.context.opt ? safeSetup.context : null

  const {
    root: _root,
    markdownCont: _markdownCont,
    observe: _observe,
    context: _context,
    ...option
  } = safeSetup

  const context = providedContext || await createContext(markdownCont, option, root)
  const summary = await applyImageTransforms(root, context)
  const observer = observe ? await startObserver(root, context, markdownCont) : null
  return { context, summary, observer }
}

/**
 * Applies image transforms to an HTML string using DOMParser.
 * Useful for source views or processing HTML without mounting it to the main DOM.
 */
export const applyImageTransformsToString = async (htmlString, contextOrOptions = {}, markdownCont = '') => {
  if (typeof DOMParser === 'undefined') {
    throw new Error('[renderer-image(dom)] DOMParser is not available.')
  }
  const parser = new DOMParser()
  const doc = parser.parseFromString(String(htmlString || ''), 'text/html')
  await applyImageTransforms(doc.body, contextOrOptions, markdownCont)
  return doc.body.innerHTML
}

let warnedDefaultExport = false
const shouldSuppressNoopWarning = (option) => {
  if (option && option.suppressNoopWarning) return true
  if (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production') return true
  return false
}
const mditRendererImageBrowser = (_md, _option) => {
  if (warnedDefaultExport || shouldSuppressNoopWarning(_option)) return Promise.resolve()
  if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
    console.warn('[renderer-image(dom)] Default export is a no-op in the browser. Use createContext/applyImageTransforms/startObserver/runInPreview instead.')
  }
  warnedDefaultExport = true
  return Promise.resolve()
}

export default mditRendererImageBrowser
