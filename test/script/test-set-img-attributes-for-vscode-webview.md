---
url: https://example.com/article/
lid: ../images/
---

# VSCode WebView Test for set-img-attributes.js

This file tests the actual DOM manipulation behavior of `set-img-attributes.js` in VSCode WebView environment.

## Purpose

This test validates that the `set-img-attributes.js` script works correctly in a real browser environment, specifically in VSCode's markdown preview WebView. It complements the Node.js unit tests by testing actual DOM manipulation and image loading.

## Test Coverage

- Real DOM image manipulation in browser environment
- Frontmatter parsing and option processing
- Image src attribute transformation (lid/url/lmd)
- Image size detection and attribute setting
- Console logging for debugging and verification

## How to Use

1. Open this file in VSCode
2. Open Markdown Preview (Ctrl+Shift+V)
3. Open browser developer tools and check console logs
4. Observe the image src transformation and attribute setting

## Test Images

## Basic Image

![Cat Image](../images/cat.jpg)

## Relative Path Image

![Another Cat](../cat.jpg)

## Script Code

The following script tests the DOM manipulation:

<script type="module">
import { createContext, applyImageTransforms } from '../../script/set-img-attributes.js'

// VSCode WebView operation test
document.addEventListener('DOMContentLoaded', async () => {
  console.log('=== VSCode WebView lid test started ===')
  
  // Check images in DOM
  const images = document.querySelectorAll('img')
  console.log(`Found images: ${images.length}`)
  
  images.forEach((img, i) => {
    console.log(`Image${i+1}: src="${img.src}", original="${img.getAttribute('src')}"`)
  })
  
  // Execute DOM manipulation with frontmatter settings
  const markdownContent = `---
lid: ../images/
url: https://example.com/article/
---

![Cat Image](../images/cat.jpg)
![Another Cat](../cat.jpg)`

  try {
    const context = await createContext(markdownContent, {
      resolveSrc: true,
      scaleSuffix: true
    }, document)
    await applyImageTransforms(document, context)
    
    console.log('=== After DOM manipulation ===')
    images.forEach((img, i) => {
      console.log(`Image${i+1}: final src="${img.src}", width="${img.width}", height="${img.height}"`)
    })
  } catch (error) {
    console.error('DOM manipulation error:', error)
  }
})
</script>
