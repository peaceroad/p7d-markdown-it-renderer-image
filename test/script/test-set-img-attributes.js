/**
 * Test for set-img-attributes.js (DOM script)
 * 
 * Tests DOM image processing functionality including:
 * - Image attribute setting (width/height/loading/decoding)
 * - lid/lmd/url path transformations 
 * - Relative path normalization
 * - Error handling
 * 
 * Run with: npm run test:script
 */

import assert from 'assert'
import path from 'path'

let __dirname = path.dirname(new URL(import.meta.url).pathname)
const isWindows = (process.platform === 'win32')
if (isWindows) {
  __dirname = __dirname.replace(/^\/+/, '').replace(/\//g, '\\')
}

// Lightweight DOM element mock
class MockElement {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName
    this.attributes = new Map()
    this.complete = true
    this.naturalWidth = 800
    this.naturalHeight = 600
    this.onload = null
    this.onerror = null
    
    // Set initial attributes
    Object.entries(attributes).forEach(([key, value]) => {
      this.attributes.set(key, value)
    })
  }
  
  getAttribute(name) {
    return this.attributes.get(name) || ''
  }
  
  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }
  
  removeAttribute(name) {
    this.attributes.delete(name)
  }
  
  get src() { return this.getAttribute('src') }
  get alt() { return this.getAttribute('alt') }
  get title() { return this.getAttribute('title') }
}

// Mock Image constructor for Node.js environment
class MockImage extends MockElement {
  constructor() {
    super('img')
    this.complete = true
    this.naturalWidth = 800
    this.naturalHeight = 600
  }
}

// Lightweight document mock
const createMockDocument = (images, metaTag = null) => {
  return {
    querySelectorAll: (selector) => {
      if (selector === 'img') {
        return images
      }
      return []
    },
    querySelector: (selector) => {
      if (selector === 'meta[name="markdown-frontmatter"]') {
        return metaTag
      }
      return null
    }
  }
}

// Helper function to test setImageAttributes in mock environment
const testSetImageAttributes = async (images, options = {}, markdownContent = null, metaContent = null, captureLoadSrc = null) => {
  // Mock global document and Image
  const originalDocument = global.document
  const originalImage = global.Image
  const metaTag = metaContent
    ? new MockElement('meta', { name: 'markdown-frontmatter', content: metaContent })
    : null
  global.document = createMockDocument(images, metaTag)
  
  // Create dynamic MockImage that returns naturalWidth/Height from the image element
  global.Image = class DynamicMockImage extends MockElement {
    constructor() {
      super('img')
      this.complete = true
      // Default values
      this.naturalWidth = 800
      this.naturalHeight = 600
      this.onload = null
      this.onerror = null
    }
    
    setAttribute(name, value) {
      super.setAttribute(name, value)
      if (name === 'src') {
        if (typeof captureLoadSrc === 'function') captureLoadSrc(value)
        // Find the corresponding image element to get its dimensions
        const correspondingImg = images.find(img => img.getAttribute('src') === value)
        if (correspondingImg) {
          this.naturalWidth = correspondingImg.naturalWidth || 800
          this.naturalHeight = correspondingImg.naturalHeight || 600
        }
        
        // Set complete to true and trigger load event
        this.complete = true
        if (this.onload) {
          setTimeout(() => {
            this.onload()
          }, 0)
        }
      }
    }
    
    get src() {
      return this.getAttribute('src')
    }
    
    set src(value) {
      this.setAttribute('src', value)
    }
  }
  
  try {
    // Dynamic import setImageAttributes (after mocking)
    const scriptPath = path.resolve(__dirname, '../../script/set-img-attributes.js')
    const scriptUrl = new URL(`file:///${scriptPath.replace(/\\/g, '/')}`).href
    const setImageAttributes = (await import(scriptUrl)).default
    
    // Use legacy API: (markdownCont, option)
    await setImageAttributes(markdownContent, { autoHideResizeTitle: false, ...options })
    
    return images
  } finally {
    // Restore globals
    global.document = originalDocument
    global.Image = originalImage
  }
}

// Test execution function
const runTest = async (testNumber, testName, testFn) => {
  console.log(`Test: ${testNumber} >>> ${testName}`)
  try {
    await testFn()
    // No output on success - silence is golden
  } catch (error) {
    console.error(`✗ Fail`)
    console.error(error.message)
    console.error(error.stack)
    process.exit(1)
  }
  console.log() // Add empty line after each test
}

// Test 1: Basic image attribute setting
console.log('===========================================================')
console.log('test-set-img-attributes.js - script test')
console.log('Starting tests...')
await runTest(1, 'Basic image attribute setting', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'Cat image', title: 'Cute cat' })
  ]
  
  await testSetImageAttributes(images, {
    scaleSuffix: false,
    resize: false,
    lazyLoad: true,
    asyncDecode: true
  })
  
  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'cat.jpg')
  assert.strictEqual(img.getAttribute('alt'), 'Cat image')
  assert.strictEqual(img.getAttribute('title'), 'Cute cat')
  assert.strictEqual(img.getAttribute('loading'), 'lazy')
  assert.strictEqual(img.getAttribute('decoding'), 'async')
})

// Test 2: Invalid extension image (early return test)
await runTest(2, 'Invalid extension early return', async () => {
  const images = [
    new MockElement('img', { src: 'document.pdf', alt: 'PDF file' })
  ]
  
  await testSetImageAttributes(images, {
    lazyLoad: true,
    asyncDecode: true
  })
  
  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'document.pdf')
  assert.strictEqual(img.getAttribute('alt'), 'PDF file')
  // Basic attributes are still set even for invalid extensions
  assert.strictEqual(img.getAttribute('loading'), 'lazy')
  assert.strictEqual(img.getAttribute('decoding'), 'async')
})

// Test 3: Multiple image processing
await runTest(3, 'Multiple image processing', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' }),
    new MockElement('img', { src: 'dog.png', alt: 'dog' }),
    new MockElement('img', { src: 'bird.gif', alt: 'bird' })
  ]
  
  await testSetImageAttributes(images, {
    lazyLoad: true,
    resize: true
  })
  
  images.forEach(img => {
    assert.strictEqual(img.getAttribute('loading'), 'lazy')
    assert.ok(img.getAttribute('width'))
    assert.ok(img.getAttribute('height'))
  })
})

// Test 4: imgSrcPrefix option test
await runTest(4, 'ImgSrcPrefix option test', async () => {
  const images = [
    new MockElement('img', { src: 'test.jpg', alt: 'test' })
  ]
  
  await testSetImageAttributes(images, {
    imgSrcPrefix: '/static/images/'
  })
  
  const img = images[0]
  const finalSrc = img.getAttribute('src')
  console.log('Actual src:', finalSrc)
  // imgSrcPrefix alone doesn't modify src without frontmatter
  assert.strictEqual(finalSrc, 'test.jpg')
})

// Test 5: metadata-based path processing
await runTest(5, 'Metadata-based path processing', async () => {
  const images = [
    new MockElement('img', { src: './test.jpg', alt: 'test' })
  ]
  
  const markdownWithYaml = `---
lmd: /assets/images
lid: blog/2023
url: https://example.com/
---

# Test Content
Some markdown content here.`
  
  console.log('YAML frontmatter test: lmd=/assets/images, lid=blog/2023, url=https://example.com/')
  
  await testSetImageAttributes(images, {}, markdownWithYaml)
  
  const img = images[0]
  const finalSrc = img.getAttribute('src')
  // The exact result depends on how modifyImgSrc processes the path
  assert.ok(finalSrc.includes('test.jpg'))
})

// Test 6: Image size (width/height) attribute setting test
await runTest(6, 'Image size attribute setting', async () => {
  const images = [
    new MockElement('img', { src: 'test1.jpg', alt: 'test1' }),
    new MockElement('img', { src: 'test2.png', alt: 'test2' }),
  ]
  
  // Set different mock sizes for each image
  images[0].naturalWidth = 1200
  images[0].naturalHeight = 800
  images[1].naturalWidth = 600
  images[1].naturalHeight = 400
  
  await testSetImageAttributes(images, {
    resize: true  // Enable resize to set width/height
  })
  
  // Check if width and height attributes are properly set
  assert.strictEqual(images[0].getAttribute('width'), '1200')
  assert.strictEqual(images[0].getAttribute('height'), '800')
  assert.strictEqual(images[1].getAttribute('width'), '600')
  assert.strictEqual(images[1].getAttribute('height'), '400')
})

// Test 7: getImageName function operation verification
await runTest(7, 'GetImageName function operation', async () => {
  const images = [
    new MockElement('img', { src: 'folder/test@2x.jpg', alt: 'test' })
  ]
  
  // Test with scaleSuffix enabled
  await testSetImageAttributes(images, {
    scaleSuffix: true
  })
  
  const img = images[0]
  // Check if width and height are set
  assert.ok(img.getAttribute('width'))
  assert.ok(img.getAttribute('height'))
})

// Test 8: Error handling test
await runTest(8, 'Error handling', async () => {
  const images = [
    new MockElement('img', { src: 'broken.jpg', alt: 'broken' })
  ]
  
  // Mock global document and Image with error conditions
  const originalDocument = global.document
  const originalImage = global.Image
  global.document = createMockDocument(images)
  global.Image = class MockImageWithError extends MockElement {
    constructor() {
      super('img')
      this.complete = true
      this.naturalWidth = 0  // Simulate error - no natural dimensions
      this.naturalHeight = 0
    }
  }
  
  try {
    const scriptPath = path.resolve(__dirname, '../../script/set-img-attributes.js')
    const scriptUrl = new URL(`file:///${scriptPath.replace(/\\/g, '/')}`).href
    const setImageAttributes = (await import(scriptUrl)).default
    await setImageAttributes('', {
      lazyLoad: true,
      asyncDecode: true
    })
    
    const img = images[0]
    // Even if an error occurs, lazyLoad and asyncDecode are still set
    assert.strictEqual(img.getAttribute('loading'), 'lazy')
    assert.strictEqual(img.getAttribute('decoding'), 'async')
    // width and height are not set due to naturalWidth/naturalHeight being 0
    assert.strictEqual(img.getAttribute('width'), '')
    assert.strictEqual(img.getAttribute('height'), '')
  } finally {
    // Restore global document and Image
    global.document = originalDocument
    global.Image = originalImage
  }
})

// Test 8.5: file:// auto suppresses local errors when not overridden
await runTest(8.5, 'file:// auto suppresses local errors', async () => {
  const images = [
    new MockElement('img', { src: 'broken.jpg', alt: 'broken' })
  ]
  const originalDocument = global.document
  const originalImage = global.Image
  const originalLocation = global.location
  const originalConsoleError = console.error
  let errorCount = 0
  global.location = { protocol: 'file:' }
  console.error = () => { errorCount += 1 }
  global.document = createMockDocument(images)
  global.Image = class MockImageWithError extends MockElement {
    constructor() {
      super('img')
      this.complete = false
      this.naturalWidth = 0
      this.naturalHeight = 0
    }
    setAttribute(name, value) {
      super.setAttribute(name, value)
      if (name === 'src') {
        setTimeout(() => {
          if (this.onerror) this.onerror()
        }, 0)
      }
    }
  }
  try {
    const scriptPath = path.resolve(__dirname, '../../script/set-img-attributes.js')
    const scriptUrl = new URL(`file:///${scriptPath.replace(/\\/g, '/')}`).href
    const setImageAttributes = (await import(scriptUrl)).default
    await setImageAttributes('', {})
    assert.strictEqual(errorCount, 0)
  } finally {
    if (originalLocation === undefined) {
      delete global.location
    } else {
      global.location = originalLocation
    }
    console.error = originalConsoleError
    global.document = originalDocument
    global.Image = originalImage
  }
})

// Test 9: Relative path normalization test
await runTest(9, 'Relative path normalization', async () => {
  const images = [
    new MockElement('img', { src: './folder/../test.jpg', alt: 'test' }),
    new MockElement('img', { src: '../images/./photo.png', alt: 'photo' }),
    new MockElement('img', { src: './nested/./file.gif', alt: 'file' })
  ]
  
  const markdownWithYaml = `---
lmd: ../assets/images/
lid: ../blog/content/
url: https://example.com/
---

# Test Content
Testing relative path normalization.`
  
  console.log('YAML frontmatter test: lmd=../assets/images/, lid=../blog/content/, url=https://example.com/ - testing relative path normalization')
  
  await testSetImageAttributes(images, {}, markdownWithYaml)
  
  // Check that ./ and ../ are removed from final src
  images.forEach(img => {
    const finalSrc = img.getAttribute('src')
    console.log('Final src:', finalSrc)
    // Should not contain ./ or ../
    assert.ok(!finalSrc.includes('./'), `Src contains ./: ${finalSrc}`)
    assert.ok(!finalSrc.includes('../'), `Src contains ../: ${finalSrc}`)
  })
})

// Test 10: lid starting with ../ test
await runTest(10, 'lid starting with ../ test', async () => {
  const images = [
    new MockElement('img', { src: '../content/image1.jpg', alt: 'image1' }),
    new MockElement('img', { src: './image2.png', alt: 'image2' })
  ]
  
  const markdownWithYaml = `---
lid: ../content/
url: https://example.com/
---

# Test Content
Testing lid starting with ../`
  
  console.log('YAML frontmatter test: lid=../content/, url=https://example.com/ - testing lid starting with ../')
  
  await testSetImageAttributes(images, {}, markdownWithYaml)
  
  images.forEach(img => {
    const finalSrc = img.getAttribute('src')
    console.log('Final src for lid ../ test:', finalSrc)
    // The final src should be properly processed and normalized
    assert.ok(!finalSrc.includes('./'), `Src contains ./: ${finalSrc}`)
    assert.ok(!finalSrc.includes('../'), `Src contains ../: ${finalSrc}`)
    assert.ok(finalSrc.includes('example.com'), `Src should contain URL: ${finalSrc}`)
  })
})

// Test 11: resize title removal preserves data attribute
await runTest(11, 'Resize title removal preserves data attribute', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat', title: 'resize:50%' })
  ]
  images[0].naturalWidth = 800
  images[0].naturalHeight = 600

  await testSetImageAttributes(images, {
    resize: true,
    autoHideResizeTitle: true
  })

  const img = images[0]
  assert.strictEqual(img.getAttribute('title'), '')
  assert.strictEqual(img.getAttribute('data-img-resize'), '50%')
  assert.strictEqual(img.getAttribute('width'), '400')
  assert.strictEqual(img.getAttribute('height'), '300')
})

// Test 12: keep title clears data attribute
await runTest(12, 'Keep title clears data attribute', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat', title: 'resize:50%', 'data-img-resize': '25%' })
  ]

  await testSetImageAttributes(images, {
    resize: true,
    autoHideResizeTitle: false
  })

  const img = images[0]
  assert.strictEqual(img.getAttribute('title'), 'resize:50%')
  assert.strictEqual(img.getAttribute('data-img-resize'), '')
})

// Test 13: non-resize title clears data attribute
await runTest(13, 'Non-resize title clears data attribute', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat', title: 'A caption', 'data-img-resize': '50%' })
  ]

  await testSetImageAttributes(images, {
    resize: true,
    autoHideResizeTitle: true
  })

  const img = images[0]
  assert.strictEqual(img.getAttribute('title'), 'A caption')
  assert.strictEqual(img.getAttribute('data-img-resize'), '')
})

// Test 14: preserve query/hash when src is modified
await runTest(14, 'Preserve query/hash on modified src', async () => {
  const images = [
    new MockElement('img', { src: './images/cat.jpg?ver=1#top', alt: 'cat' })
  ]

  const markdownWithYaml = `---
lid: images/
url: https://example.com/
---`

  await testSetImageAttributes(images, {}, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'https://example.com/cat.jpg?ver=1#top')
})

// Test 15: protocol-relative src should not be normalized
await runTest(15, 'Protocol-relative src unchanged', async () => {
  const images = [
    new MockElement('img', { src: '//example.com/cat.jpg?x=1', alt: 'cat' })
  ]

  await testSetImageAttributes(images, {})

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), '//example.com/cat.jpg?x=1')
})

// Test 16: readMeta applies rendererImage options
await runTest(16, 'readMeta applies rendererImage options', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' })
  ]
  const metaContent = JSON.stringify({
    _extensionSettings: {
      rendererImage: {
        lazyLoad: true,
        asyncDecode: true
      }
    }
  })

  await testSetImageAttributes(images, { readMeta: true }, null, metaContent)

  const img = images[0]
  assert.strictEqual(img.getAttribute('loading'), 'lazy')
  assert.strictEqual(img.getAttribute('decoding'), 'async')
})

// Test 17: readMeta skip flags prevent processing
await runTest(17, 'readMeta skip flags prevent processing', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' })
  ]
  const metaContent = JSON.stringify({
    _extensionSettings: {
      notSetImageElementAttributes: true
    }
  })

  await testSetImageAttributes(images, { readMeta: true, lazyLoad: true }, null, metaContent)

  const img = images[0]
  assert.strictEqual(img.getAttribute('loading'), '')
  assert.strictEqual(img.getAttribute('width'), '')
  assert.strictEqual(img.getAttribute('height'), '')
})

// Test 18: webview URI lmd should not be prefixed with file://
await runTest(18, 'Webview URI lmd preserved', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
lmd: https://file+.vscode-resource.vscode-cdn.net/abc/123
---`

  const loadSrcs = []
  await testSetImageAttributes(images, {}, markdownWithYaml, null, (value) => loadSrcs.push(value))

  const loadSrc = loadSrcs.find(value => value.includes('vscode-resource'))
  assert.ok(loadSrc, 'Expected loadSrc for webview URI to be captured')
  assert.ok(loadSrc.startsWith('https://file+.vscode-resource.vscode-cdn.net/abc/123/'), `Unexpected loadSrc: ${loadSrc}`)
  assert.ok(!loadSrc.startsWith('file:///https://'), `Unexpected file URL prefix: ${loadSrc}`)
})

// Test 19: urlimagebase + urlimage (relative) uses basename
await runTest(19, 'urlimagebase with urlimage relative uses basename', async () => {
  const images = [
    new MockElement('img', { src: 'foo/bar/cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
url: https://example.com/page
urlimagebase: https://image.example.com/assets/
urlimage: 2025
---`

  await testSetImageAttributes(images, {}, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'https://image.example.com/assets/page/2025/cat.jpg')
})

// Test 20: urlimage empty keeps basename only
await runTest(20, 'urlimage empty keeps basename only', async () => {
  const images = [
    new MockElement('img', { src: 'foo/bar/cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
url: https://example.com/page
urlimagebase: https://image.example.com/assets/
urlimage:
---`

  await testSetImageAttributes(images, {}, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'https://image.example.com/assets/page/cat.jpg')
})

// Test 21: urlimage relative uses basename
await runTest(21, 'urlimage relative uses basename', async () => {
  const images = [
    new MockElement('img', { src: 'foo/bar/cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
url: https://example.com/page
urlimage: 2025
---`

  await testSetImageAttributes(images, {}, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'https://example.com/page/2025/cat.jpg')
})

// Test 22: urlImageBase alias applies base with url path
await runTest(22, 'urlImageBase alias applies base', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
url: https://example.com/page
urlImageBase: https://image.example.com/assets/
---`

  await testSetImageAttributes(images, {}, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'https://image.example.com/assets/page/cat.jpg')
})

// Test 23: urlImage alias applies base
await runTest(23, 'urlImage alias applies base', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
url: https://example.com/page
urlImage: https://image.example.com/assets/
---`

  await testSetImageAttributes(images, {}, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'https://image.example.com/assets/cat.jpg')
})

// Test 24: outputUrlMode protocol-relative
await runTest(24, 'outputUrlMode protocol-relative', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
url: https://example.com/page
urlimage: https://image.example.com/assets/
---`

  await testSetImageAttributes(images, { outputUrlMode: 'protocol-relative' }, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), '//image.example.com/assets/cat.jpg')
})

// Test 25: outputUrlMode path-only
await runTest(25, 'outputUrlMode path-only', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
url: https://example.com/page
urlimage: https://image.example.com/assets/
---`

  await testSetImageAttributes(images, { outputUrlMode: 'path-only' }, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), '/assets/cat.jpg')
})

// Test 26: option urlImageBase without frontmatter
await runTest(26, 'urlImageBase option without frontmatter', async () => {
  const images = [
    new MockElement('img', { src: 'foo/bar/cat.jpg', alt: 'cat' })
  ]

  await testSetImageAttributes(images, { urlImageBase: 'https://image.example.com/assets/' })

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'https://image.example.com/assets/foo/bar/cat.jpg')
})

// Test 27: imagescale applies global scaling
await runTest(27, 'imagescale applies global scaling', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
imagescale: 50%
---`

  await testSetImageAttributes(images, {}, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('width'), '400')
  assert.strictEqual(img.getAttribute('height'), '300')
})

// Test 28: noUpscale caps global scaling
await runTest(28, 'noUpscale caps resize scaling', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat', title: 'resize:200%' })
  ]

  await testSetImageAttributes(images, { resize: true })

  const img = images[0]
  assert.strictEqual(img.getAttribute('width'), '800')
  assert.strictEqual(img.getAttribute('height'), '600')
})

// Test 29: imagescale clamps above 100%
await runTest(29, 'imagescale clamps above 100%', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
imagescale: 200%
---`

  await testSetImageAttributes(images, {}, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('width'), '800')
  assert.strictEqual(img.getAttribute('height'), '600')
})

// Test 30: title without resize keyword does not resize
await runTest(30, 'Title-only value ignored', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat', title: '50%' })
  ]

  await testSetImageAttributes(images, { resize: true })

  const img = images[0]
  assert.strictEqual(img.getAttribute('title'), '50%')
  assert.strictEqual(img.getAttribute('width'), '800')
  assert.strictEqual(img.getAttribute('height'), '600')
})

// Test 31: decimal resize value in title
await runTest(31, 'Decimal resize in title', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat', title: 'resize:12.5%' })
  ]

  await testSetImageAttributes(images, { resize: true })

  const img = images[0]
  assert.strictEqual(img.getAttribute('width'), '100')
  assert.strictEqual(img.getAttribute('height'), '75')
})

// Test 32: data-img-resize accepts direct values
await runTest(32, 'data-img-resize direct value', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat', 'data-img-resize': '50%' })
  ]

  await testSetImageAttributes(images, { resize: true })

  const img = images[0]
  assert.strictEqual(img.getAttribute('width'), '400')
  assert.strictEqual(img.getAttribute('height'), '300')
})

// Test 33: previewMode markdown keeps markdown src and stores final src
await runTest(33, 'previewMode markdown keeps markdown src', async () => {
  const images = [
    new MockElement('img', { src: 'cats/cat.jpg', alt: 'cat' })
  ]
  const markdownWithYaml = `---
lmd: /assets/images
url: https://example.com/page
urlimage: https://cdn.example.com/assets/
---`

  await testSetImageAttributes(images, { previewMode: 'markdown' }, markdownWithYaml)

  const img = images[0]
  assert.strictEqual(img.getAttribute('src'), 'cats/cat.jpg')
  assert.strictEqual(img.getAttribute('data-img-output-src'), 'https://cdn.example.com/assets/cats/cat.jpg')
})

// Test 34: loadSrcMap overrides measurement source
await runTest(34, 'loadSrcMap overrides loadSrc', async () => {
  const images = [
    new MockElement('img', { src: 'cats/cat.jpg', alt: 'cat' })
  ]
  const loadSrcs = []

  await testSetImageAttributes(
    images,
    { resize: true, loadSrcMap: { 'cats/cat.jpg': 'blob:cat' } },
    null,
    null,
    (value) => loadSrcs.push(value)
  )

  assert.ok(loadSrcs.includes('blob:cat'))
})

// Test 35: file:// previewMode local uses lmd display
await runTest(35, 'file:// previewMode local uses lmd for display', async () => {
  const images = [
    new MockElement('img', { src: 'cats/cat.jpg', alt: 'cat' })
  ]
  const originalLocation = global.location
  global.location = { protocol: 'file:' }
  const markdownWithYaml = `---
lmd: C:\\Users\\me\\Pictures
url: https://example.com/page
urlimage: https://cdn.example.com/assets/
---`

  try {
    await testSetImageAttributes(images, { previewMode: 'local' }, markdownWithYaml)
  } finally {
    if (originalLocation === undefined) {
      delete global.location
    } else {
      global.location = originalLocation
    }
  }

  const img = images[0]
  const src = img.getAttribute('src')
  assert.ok(src.startsWith('file:///C:/Users/me/Pictures/'), `Unexpected preview src: ${src}`)
  assert.strictEqual(img.getAttribute('data-img-output-src'), 'https://cdn.example.com/assets/cats/cat.jpg')
})

console.log('All tests passed')
