import assert from 'assert'
import fs from 'fs'
import path from 'path'
import mdit from 'markdown-it'
import mditMeta from 'markdown-it-meta'
import mditRendererImage from '../index.js'
import { parseFrontmatter } from '../script/img-util.js'

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

if (pass) console.log('All tests passed')