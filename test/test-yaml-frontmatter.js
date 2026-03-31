import assert from 'assert'
import fs from 'fs'
import path from 'path'
import mdit from 'markdown-it'
import mditMeta from 'markdown-it-meta'
import mditRendererImage from '../index.js'
import { parseFrontmatter, normalizeRelativePath, getFrontmatter, classifyResizeHint, normalizeConditionalResize, setImgSize } from '../script/img-util.js'

let __dirname = path.dirname(new URL(import.meta.url).pathname)
const isWindows = (process.platform === 'win32')
if (isWindows) {
  __dirname = __dirname.replace(/^\/+/, '').replace(/\//g, '\\')
}


const md = mdit().use(mditRendererImage, { scaleSuffix: true, resize: true })

let mdMeta = mdit().use(mditMeta).use(mditRendererImage, {
  resolveSrc: true,
  scaleSuffix: true,
  resize: true,
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})


let mdMetaWithLidRelative = mdit().use(mditMeta).use(mditRendererImage, {
  resolveSrc: true,
  scaleSuffix: true,
  resize: true,
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter-with-lidRelative.md',
})

let mdFrontmatter = mdit().use(mditRendererImage, {
  resolveSrc: true,
  disableRemoteSize: true,
  suppressErrors: 'local',
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})

let mdOptionBase = mdit().use(mditRendererImage, {
  resolveSrc: true,
  disableRemoteSize: true,
  suppressErrors: 'local',
  urlImageBase: 'https://image.example.com/assets/',
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})

let mdProtocolRelative = mdit().use(mditRendererImage, {
  resolveSrc: true,
  disableRemoteSize: true,
  suppressErrors: 'local',
  outputUrlMode: 'protocol-relative',
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})

let mdPathOnly = mdit().use(mditRendererImage, {
  resolveSrc: true,
  disableRemoteSize: true,
  suppressErrors: 'local',
  outputUrlMode: 'path-only',
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})

const testData = {
  noOption: __dirname + path.sep +  'examples-yaml-frontmatter.txt',
  withLidRelative: __dirname + path.sep + 'examples-yaml-frontmatter-with-lidRelative.txt',
}

const getTestData = (pat) => {
  let ms = [];
  if(!fs.existsSync(pat)) {
    console.log('No exist: ' + pat)
    return ms
  }
  const exampleCont = fs.readFileSync(pat, 'utf-8').trim();

  let ms0 = exampleCont.split(/\n*\[Markdown\]\n/);
  let n = 1;
  while(n < ms0.length) {
    let mhs = ms0[n].split(/\n+\[HTML[^\]]*?\]\n/);
    let i = 1;
    while (i < 2) {
      if (mhs[i] === undefined) {
        mhs[i] = '';
      } else {
        mhs[i] = mhs[i].replace(/$/,'\n');
      }
      i++;
    }
    
    ms[n] = {
      "markdown": mhs[0],
      "html": mhs[1],
    };
    n++;
  }
  return ms
}

const runTest = (mdInstance, pat, pass, testId) => {
  console.log('===========================================================')
  console.log(`test-yaml-frontmatter.js - ${path.basename(pat)}`)
  let ms = getTestData(pat)
  if (ms.length === 0) return pass
  let n = 1;
  let end = ms.length - 1
  if(testId) {
    if (testId[0]) n = testId[0]
    if (testId[1]) {
      if (ms.length >= testId[1]) {
        end = testId[1]
      }
    }
  }

  while(n <= end) {

    if (!ms[n]) {
      n++
      continue
    }

    const m = ms[n].markdown;
    
    // Extract frontmatter using parseFrontmatter
    const frontmatter = parseFrontmatter(m)
    
    // Remove frontmatter from markdown content
    const contentWithoutFrontmatter = m.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '')
    
    // Set environment with frontmatter
    const env = { frontmatter }
    
    const h = mdInstance.render(contentWithoutFrontmatter, env)
    console.log('Test: ' + n + ' >>>');
    try {
      assert.strictEqual(h, ms[n].html);
    } catch(e) {
      pass = false
      console.log(ms[n].markdown);
      console.log('incorrect:');
      console.log('H: ' + h +'C: ' + ms[n].html);
    }
    n++;
  }
  return pass
}

let pass = true
pass = runTest(mdMeta, testData.noOption, pass)
pass = runTest(mdMetaWithLidRelative, testData.withLidRelative, pass)

console.log('===========================================================')
console.log('test-yaml-frontmatter.js - md.meta fallback safety')
try {
  const rawMetaMarkdown = `---
url: https://example.com/article/number
---

![](cat.jpg)`
  const hMetaFallback = mdMeta.render(rawMetaMarkdown)
  assert.strictEqual(hMetaFallback, '<p><img src="https://example.com/article/number/cat.jpg" alt="" width="400" height="300"></p>\n')

  const hMetaNoLeak = mdMeta.render('![](cat.jpg)')
  assert.strictEqual(hMetaNoLeak, '<p><img src="cat.jpg" alt="" width="400" height="300"></p>\n')

  const hEnvPriority = mdMeta.render(rawMetaMarkdown, {
    frontmatter: {
      url: 'https://override.example.com/base/',
    },
  })
  assert.strictEqual(hEnvPriority, '<p><img src="https://override.example.com/base/cat.jpg" alt="" width="400" height="300"></p>\n')
} catch (e) {
  pass = false
  console.log('incorrect(md.meta fallback safety): ')
  console.log(e.message)
}

console.log('===========================================================')
console.log('test-yaml-frontmatter.js - urlimage/urlimagebase')
try {
  const envUrlImage = {
    frontmatter: {
      url: 'https://example.com/page',
      urlimage: 'https://image.example.com/assets/',
    },
  }
  const hUrlImage = mdFrontmatter.render('![Alt](images/cat.jpg)', envUrlImage)
  assert.strictEqual(hUrlImage, '<p><img src="https://image.example.com/assets/images/cat.jpg" alt="Alt"></p>\n')

  const envUrlImageBaseIgnored = {
    frontmatter: {
      url: 'https://example.com/page',
      urlimagebase: 'https://image.example.com/assets/',
      urlimage: '2025',
    },
  }
  const hUrlImageBaseIgnored = mdFrontmatter.render('![Alt](foo/bar/cat.jpg)', envUrlImageBaseIgnored)
  assert.strictEqual(hUrlImageBaseIgnored, '<p><img src="https://image.example.com/assets/page/foo/bar/cat.jpg" alt="Alt"></p>\n')

  const envUrlImageBaseHtml = {
    frontmatter: {
      url: 'https://example.com/page/index.html',
      urlimagebase: 'https://image.example.com/assets/',
    },
  }
  const hUrlImageBaseHtml = mdFrontmatter.render('![Alt](cat.jpg)', envUrlImageBaseHtml)
  assert.strictEqual(hUrlImageBaseHtml, '<p><img src="https://image.example.com/assets/page/cat.jpg" alt="Alt" width="400" height="300"></p>\n')

  const envUrlImageBaseDotDir = {
    frontmatter: {
      url: 'https://example.com/v1.2/',
      urlimagebase: 'https://image.example.com/assets/',
    },
  }
  const hUrlImageBaseDotDir = mdFrontmatter.render('![Alt](cat.jpg)', envUrlImageBaseDotDir)
  assert.strictEqual(hUrlImageBaseDotDir, '<p><img src="https://image.example.com/assets/v1.2/cat.jpg" alt="Alt" width="400" height="300"></p>\n')

  const envUrlImageRelativeIgnored = {
    frontmatter: {
      url: 'https://example.com/page',
      urlimage: '2025',
    },
  }
  const hUrlImageRelativeIgnored = mdFrontmatter.render('![Alt](foo/bar/cat.jpg)', envUrlImageRelativeIgnored)
  assert.strictEqual(hUrlImageRelativeIgnored, '<p><img src="https://example.com/page/foo/bar/cat.jpg" alt="Alt"></p>\n')

  const envUrlImageEmpty = {
    frontmatter: {
      url: 'https://example.com/page',
      urlimagebase: 'https://image.example.com/assets/',
      urlimage: '',
    },
  }
  const hUrlImageEmpty = mdFrontmatter.render('![Alt](foo/bar/cat.jpg)', envUrlImageEmpty)
  assert.strictEqual(hUrlImageEmpty, '<p><img src="https://image.example.com/assets/page/foo/bar/cat.jpg" alt="Alt"></p>\n')

  const hOptionBase = mdOptionBase.render('![Alt](foo/bar/cat.jpg)')
  assert.strictEqual(hOptionBase, '<p><img src="https://image.example.com/assets/foo/bar/cat.jpg" alt="Alt"></p>\n')

  const hProtocolRelative = mdProtocolRelative.render('![Alt](cat.jpg)', envUrlImage)
  assert.strictEqual(hProtocolRelative, '<p><img src="//image.example.com/assets/cat.jpg" alt="Alt" width="400" height="300"></p>\n')

  const hPathOnly = mdPathOnly.render('![Alt](cat.jpg)', envUrlImage)
  assert.strictEqual(hPathOnly, '<p><img src="/assets/cat.jpg" alt="Alt" width="400" height="300"></p>\n')

  const envImageScale = {
    frontmatter: {
      imagescale: '50%',
    },
  }
  const hImageScale = mdFrontmatter.render('![Alt](cat.jpg)', envImageScale)
  assert.strictEqual(hImageScale, '<p><img src="cat.jpg" alt="Alt" width="200" height="150" data-img-resize="50%" data-img-resize-origin="imagescale"></p>\n')

  const envImageScaleClamp = {
    frontmatter: {
      imagescale: '200%',
    },
  }
  const hImageScaleClamp = mdFrontmatter.render('![Alt](cat.jpg)', envImageScaleClamp)
  assert.strictEqual(hImageScaleClamp, '<p><img src="cat.jpg" alt="Alt" width="400" height="300" data-img-resize="100%" data-img-resize-origin="imagescale"></p>\n')
} catch (e) {
  pass = false
  console.log('incorrect(urlimage/urlimagebase): ')
  console.log(e.message)
}

console.log('===========================================================')
console.log('test-yaml-frontmatter.js - dotted and nested frontmatter aliases')
try {
  const parsedNested = parseFrontmatter(`---
page:
  url: https://example.com/page
images:
  baseUrl: https://image.example.com/assets/
  stripLocalPrefix: images/
local:
  markdownDir: C:\\Users\\me\\Pictures
---`)
  assert.deepStrictEqual(parsedNested, {
    page: {
      url: 'https://example.com/page',
    },
    images: {
      baseUrl: 'https://image.example.com/assets/',
      stripLocalPrefix: 'images/',
    },
    local: {
      markdownDir: 'C:\\Users\\me\\Pictures',
    },
  })

  const fmDotted = getFrontmatter({
    'page.url': 'https://example.com/page',
    'images.baseUrl': 'https://image.example.com/assets/',
    'images.stripLocalPrefix': 'images',
    'local.markdownDir': 'C:\\Users\\me\\Pictures',
    'images.scale': '50%',
  })
  assert.strictEqual(fmDotted.url, 'https://example.com/page/')
  assert.strictEqual(fmDotted.urlimagebase, 'https://image.example.com/assets/')
  assert.strictEqual(fmDotted.lid, 'images/')
  assert.strictEqual(fmDotted.lmd, 'C:/Users/me/Pictures/')
  assert.strictEqual(fmDotted.imageScaleResizeValue, '50%')

  const hDottedBase = mdFrontmatter.render('![Alt](cat.jpg)', {
    frontmatter: {
      'page.url': 'https://example.com/page',
      'images.baseUrl': 'https://image.example.com/assets/',
    },
  })
  assert.strictEqual(hDottedBase, '<p><img src="https://image.example.com/assets/page/cat.jpg" alt="Alt" width="400" height="300"></p>\n')

  const hNestedDirUrl = mdFrontmatter.render('![Alt](cat.jpg)', {
    frontmatter: {
      page: {
        url: 'https://example.com/page',
      },
      images: {
        dirUrl: 'https://image.example.com/assets/',
      },
    },
  })
  assert.strictEqual(hNestedDirUrl, '<p><img src="https://image.example.com/assets/cat.jpg" alt="Alt" width="400" height="300"></p>\n')

  const frontmatterWarnings = []
  const fmLegacyFallback = getFrontmatter({
    'images.dirUrl': '2025',
    urlimage: 'https://legacy.example.com/assets/',
  }, {
    onWarning: (message) => frontmatterWarnings.push(message),
  })
  assert.strictEqual(fmLegacyFallback.urlimage, 'https://legacy.example.com/assets/')
  assert.ok(frontmatterWarnings.some((message) => message.includes('Ignoring images.dirUrl')))
} catch (e) {
  pass = false
  console.log('incorrect(dotted and nested aliases): ')
  console.log(e.message)
}

console.log('===========================================================')
console.log('test-yaml-frontmatter.js - non-string guards')
try {
  assert.deepStrictEqual(parseFrontmatter(null), {})
  assert.deepStrictEqual(parseFrontmatter(123), {})
  assert.strictEqual(normalizeRelativePath(null), '')
  assert.strictEqual(normalizeRelativePath(123), '')
  assert.strictEqual(normalizeRelativePath({}), '')
  assert.strictEqual(normalizeRelativePath('/'), '')
  assert.strictEqual(normalizeRelativePath('.'), '')
  assert.strictEqual(normalizeRelativePath('..'), '..')
  assert.strictEqual(normalizeRelativePath('../cat.jpg'), '../cat.jpg')
  assert.strictEqual(normalizeRelativePath('a/..'), '')
  assert.strictEqual(normalizeRelativePath('/a/..'), '')
  assert.strictEqual(normalizeRelativePath('/a/./b'), '/a/b')
  assert.strictEqual(normalizeRelativePath('a//b'), 'a/b')
  assert.strictEqual(normalizeRelativePath('https://example.com/a/../b'), 'https://example.com/b')
  assert.strictEqual(normalizeRelativePath('https://example.com/a/b/cat.jpg'), 'https://example.com/a/b/cat.jpg')
  assert.strictEqual(getFrontmatter(null, {}), null)
  assert.strictEqual(getFrontmatter(123, {}), null)
  const fm = getFrontmatter({ url: 123, urlimage: {}, lid: true, lmd: [] }, {})
  assert.strictEqual(fm.url, '')
  assert.strictEqual(fm.urlimage, '')
  assert.strictEqual(fm.lid, '')
  assert.strictEqual(fm.lmd, '')
  const fmRelativeLid = getFrontmatter({ lid: 'a/path' }, {})
  assert.strictEqual(fmRelativeLid.lid, 'a/path/')
  const fmRelativeUrlImage = getFrontmatter({ urlimage: 'a/path' }, {})
  assert.strictEqual(fmRelativeUrlImage.urlimage, '')

  assert.deepStrictEqual(classifyResizeHint(''), {
    state: 'empty',
    normalizedResizeValue: '',
  })
  assert.deepStrictEqual(classifyResizeHint('res'), {
    state: 'pending',
    normalizedResizeValue: '',
  })
  assert.deepStrictEqual(classifyResizeHint('resize:'), {
    state: 'pending',
    normalizedResizeValue: '',
  })
  assert.deepStrictEqual(classifyResizeHint('resize:300'), {
    state: 'pending',
    normalizedResizeValue: '',
  })
  assert.deepStrictEqual(classifyResizeHint('resize:300px'), {
    state: 'valid',
    normalizedResizeValue: '300px',
  })
  assert.deepStrictEqual(classifyResizeHint('resize:50%'), {
    state: 'valid',
    normalizedResizeValue: '50%',
  })
  assert.deepStrictEqual(classifyResizeHint('リサ'), {
    state: 'pending',
    normalizedResizeValue: '',
  })
  assert.deepStrictEqual(classifyResizeHint('リサイズ:300'), {
    state: 'pending',
    normalizedResizeValue: '',
  })
  assert.deepStrictEqual(classifyResizeHint('リサイズ:300px'), {
    state: 'valid',
    normalizedResizeValue: '300px',
  })
  assert.deepStrictEqual(classifyResizeHint('hello'), {
    state: 'invalid',
    normalizedResizeValue: '',
  })
  assert.deepStrictEqual(setImgSize('cat@0x', { width: 800, height: 600 }, true, false, '', null, true), {
    width: 800,
    height: 600,
  })
  assert.deepStrictEqual(setImgSize('cat_0dpi', { width: 800, height: 600 }, true, false, '', null, true), {
    width: 800,
    height: 600,
  })
  assert.deepStrictEqual(normalizeConditionalResize({
    orientation: 'portrait',
    targetWidth: 300.4,
  }), {
    orientation: 'portrait',
    minWidth: 0,
    minHeight: 0,
    targetWidth: 300,
    targetHeight: 0,
  })
  assert.strictEqual(normalizeConditionalResize({
    orientation: 'portrait',
    targetWidth: 0.4,
  }), null)
  assert.deepStrictEqual(setImgSize('portrait.jpg', { width: 600, height: 1200 }, false, false, '', null, true, {
    orientation: 'portrait',
    minHeight: 560,
    minWidth: 560,
    targetWidth: 300,
    targetHeight: 0,
  }), {
    width: 300,
    height: 600,
  })
  assert.deepStrictEqual(setImgSize('portrait.jpg', { width: 600, height: 1200 }, false, true, 'resize:25%', null, true, {
    orientation: 'portrait',
    minHeight: 560,
    minWidth: 560,
    targetWidth: 250,
    targetHeight: 0,
  }), {
    width: 150,
    height: 300,
  })
  assert.deepStrictEqual(setImgSize('portrait.jpg', { width: 600, height: 1200 }, false, false, '', 0.5, true, {
    orientation: 'portrait',
    minHeight: 560,
    minWidth: 560,
    targetWidth: 250,
    targetHeight: 0,
  }), {
    width: 300,
    height: 600,
  })
  assert.deepStrictEqual(setImgSize('landscape.jpg', { width: 1200, height: 600 }, false, false, '', null, true, {
    orientation: 'portrait',
    minHeight: 560,
    minWidth: 560,
    targetWidth: 300,
    targetHeight: 0,
  }), {
    width: 1200,
    height: 600,
  })
} catch (e) {
  pass = false
  console.log('incorrect(non-string guards): ')
  console.log(e.message)
}

if (pass) console.log('All tests passed')
if (!pass) process.exitCode = 1
