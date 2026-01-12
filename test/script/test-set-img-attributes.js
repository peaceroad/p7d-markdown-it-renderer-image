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
const createMockDocument = (images) => {
  return {
    querySelectorAll: (selector) => {
      if (selector === 'img') {
        return images
      }
      return []
    }
  }
}

// Helper function to test setImageAttributes in mock environment
const testSetImageAttributes = async (images, options = {}, markdownContent = null) => {
  // Mock global document and Image
  const originalDocument = global.document
  const originalImage = global.Image
  global.document = createMockDocument(images)
  
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
    await setImageAttributes(markdownContent, { hideTitle: false, ...options })
    
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
    hideTitle: true
  })

  const img = images[0]
  assert.strictEqual(img.getAttribute('title'), '')
  assert.strictEqual(img.getAttribute('data-img-resize'), 'resize:50%')
  assert.strictEqual(img.getAttribute('width'), '400')
  assert.strictEqual(img.getAttribute('height'), '300')
})

// Test 12: keep title clears data attribute
await runTest(12, 'Keep title clears data attribute', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat', title: 'resize:50%', 'data-img-resize': 'resize:25%' })
  ]

  await testSetImageAttributes(images, {
    resize: true,
    hideTitle: false
  })

  const img = images[0]
  assert.strictEqual(img.getAttribute('title'), 'resize:50%')
  assert.strictEqual(img.getAttribute('data-img-resize'), '')
})

// Test 13: non-resize title clears data attribute
await runTest(13, 'Non-resize title clears data attribute', async () => {
  const images = [
    new MockElement('img', { src: 'cat.jpg', alt: 'cat', title: 'A caption', 'data-img-resize': 'resize:50%' })
  ]

  await testSetImageAttributes(images, {
    resize: true,
    hideTitle: true
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

console.log('All tests passed')
