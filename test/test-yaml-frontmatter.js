import assert from 'assert'
import fs from 'fs'
import path from 'path'
import mdit from 'markdown-it'
import mditMeta from 'markdown-it-meta'
import mditRendererImage from '../index.js'
import { parseFrontmatter, normalizeRelativePath, getFrontmatter } from '../script/img-util.js'

let __dirname = path.dirname(new URL(import.meta.url).pathname)
const isWindows = (process.platform === 'win32')
if (isWindows) {
  __dirname = __dirname.replace(/^\/+/, '').replace(/\//g, '\\')
}


const md = mdit().use(mditRendererImage, {scaleSuffix: true, resize: true});

let mdMeta = mdit().use(mditMeta).use(mditRendererImage, {
  modifyImgSrc: true,
  scaleSuffix: true,
  resize: true,
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})


let mdMetaWithImgSrcPrefix = mdit().use(mditMeta).use(mditRendererImage, {
  modifyImgSrc: true,
  scaleSuffix: true,
  resize: true,
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter-with-imgSrcPrefix.md',
  imgSrcPrefix: 'https://example.com/assets/images/',
})

let mdMetaWithLidRelative = mdit().use(mditMeta).use(mditRendererImage, {
  modifyImgSrc: true,
  scaleSuffix: true,
  resize: true,
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter-with-lidRelative.md',
})

let mdFrontmatter = mdit().use(mditRendererImage, {
  modifyImgSrc: true,
  disableRemoteSize: true,
  suppressErrors: 'local',
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})

let mdOptionBase = mdit().use(mditRendererImage, {
  modifyImgSrc: true,
  disableRemoteSize: true,
  suppressErrors: 'local',
  urlImageBase: 'https://image.example.com/assets/',
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})

let mdProtocolRelative = mdit().use(mditRendererImage, {
  modifyImgSrc: true,
  disableRemoteSize: true,
  suppressErrors: 'local',
  outputUrlMode: 'protocol-relative',
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})

let mdPathOnly = mdit().use(mditRendererImage, {
  modifyImgSrc: true,
  disableRemoteSize: true,
  suppressErrors: 'local',
  outputUrlMode: 'path-only',
  mdPath: __dirname + path.sep + 'examples-yaml-frontmatter.md',
})

const testData = {
  noOption: __dirname + path.sep +  'examples-yaml-frontmatter.txt',
  withImgSrcPrefix: __dirname + path.sep + 'examples-yaml-frontmatter-with-imgSrcPrefix.txt',
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
pass = runTest(mdMetaWithImgSrcPrefix, testData.withImgSrcPrefix, pass)
pass = runTest(mdMetaWithLidRelative, testData.withLidRelative, pass)

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

  const envUrlImageBase = {
    frontmatter: {
      url: 'https://example.com/page',
      urlimagebase: 'https://image.example.com/assets/',
      urlimage: '2025',
    },
  }
  const hUrlImageBase = mdFrontmatter.render('![Alt](foo/bar/cat.jpg)', envUrlImageBase)
  assert.strictEqual(hUrlImageBase, '<p><img src="https://image.example.com/assets/page/2025/cat.jpg" alt="Alt"></p>\n')

  const envUrlImageBaseAlias = {
    frontmatter: {
      url: 'https://example.com/page',
      urlImageBase: 'https://image.example.com/assets/',
    },
  }
  const hUrlImageBaseAlias = mdFrontmatter.render('![Alt](cat.jpg)', envUrlImageBaseAlias)
  assert.strictEqual(hUrlImageBaseAlias, '<p><img src="https://image.example.com/assets/page/cat.jpg" alt="Alt" width="400" height="300"></p>\n')

  const envUrlImageAlias = {
    frontmatter: {
      url: 'https://example.com/page',
      urlImage: 'https://image.example.com/assets/',
    },
  }
  const hUrlImageAlias = mdFrontmatter.render('![Alt](cat.jpg)', envUrlImageAlias)
  assert.strictEqual(hUrlImageAlias, '<p><img src="https://image.example.com/assets/cat.jpg" alt="Alt" width="400" height="300"></p>\n')

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

  const envUrlImageRelative = {
    frontmatter: {
      url: 'https://example.com/page',
      urlimage: '2025',
    },
  }
  const hUrlImageRelative = mdFrontmatter.render('![Alt](foo/bar/cat.jpg)', envUrlImageRelative)
  assert.strictEqual(hUrlImageRelative, '<p><img src="https://example.com/page/2025/cat.jpg" alt="Alt"></p>\n')

  const envUrlImageEmpty = {
    frontmatter: {
      url: 'https://example.com/page',
      urlimagebase: 'https://image.example.com/assets/',
      urlimage: '',
    },
  }
  const hUrlImageEmpty = mdFrontmatter.render('![Alt](foo/bar/cat.jpg)', envUrlImageEmpty)
  assert.strictEqual(hUrlImageEmpty, '<p><img src="https://image.example.com/assets/page/cat.jpg" alt="Alt"></p>\n')

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
  assert.strictEqual(hImageScale, '<p><img src="cat.jpg" alt="Alt" width="200" height="150"></p>\n')

  const envImageScaleClamp = {
    frontmatter: {
      imagescale: '200%',
    },
  }
  const hImageScaleClamp = mdFrontmatter.render('![Alt](cat.jpg)', envImageScaleClamp)
  assert.strictEqual(hImageScaleClamp, '<p><img src="cat.jpg" alt="Alt" width="400" height="300"></p>\n')
} catch (e) {
  pass = false
  console.log('incorrect(urlimage/urlimagebase): ')
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
  assert.strictEqual(getFrontmatter(null, {}), null)
  assert.strictEqual(getFrontmatter(123, {}), null)
  const fm = getFrontmatter({ url: 123, urlimage: {}, lid: true, lmd: [] }, {})
  assert.strictEqual(fm.url, '')
  assert.strictEqual(fm.urlimage, '')
  assert.strictEqual(fm.lid, '')
  assert.strictEqual(fm.lmd, '')
} catch (e) {
  pass = false
  console.log('incorrect(non-string guards): ')
  console.log(e.message)
}

if (pass) console.log('All tests passed')
if (!pass) process.exitCode = 1
