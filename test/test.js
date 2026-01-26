import assert from 'assert'
import fs from 'fs'
import path from 'path'
import mdit from 'markdown-it'
import mditRendererImage from '../index.js'

let __dirname = path.dirname(new URL(import.meta.url).pathname)
const isWindows = (process.platform === 'win32')
if (isWindows) {
  __dirname = __dirname.replace(/^\/+/, '').replace(/\//g, '\\')
}

const commonOpt = { scaleSuffix: true, resize: true, autoHideResizeTitle: false }
const md = mdit().use(mditRendererImage, commonOpt);
//const mdLazy = mdit().use(mditRendererImage, {scaleSuffix: true, lazyLoad: true, asyncDecode: true});
const mdLazy = mdit().use(mditRendererImage, { ...commonOpt, lazyLoad: true });
const mdEnvPat = mdit().use(mditRendererImage, { ...commonOpt, mdPath: __dirname + '/examples.md' });
const mdHideDefault = mdit().use(mditRendererImage, { scaleSuffix: true, resize: true });
const mdResizeDataAttr = mdit().use(mditRendererImage, { resize: true, resizeDataAttr: 'data-img-resize' });
const mdNoUpscale = mdit().use(mditRendererImage, { resize: true });

const loadExamples = (file) => {
  const example = __dirname + '/' + file;
  const exampleCont = fs.readFileSync(example, 'utf-8').trim();
  let ms = [];
  let ms0 = exampleCont.split(/\n*\[Markdown\]\n/);
  let n = 1;
  while(n < ms0.length) {
    let mhs = ms0[n].split(/\n+\[HTML[^\]]*?\]\n/);
    let i = 1;
    while (i < mhs.length) {
      if (mhs[i] === undefined) {
        mhs[i] = '';
      } else {
        mhs[i] = mhs[i].replace(/$/,'\n');
      }
      i++;
    }
    ms[n] = {
      markdown: mhs[0],
      html: mhs[1],
      htmlLazy: mhs[2],
    };
    n++;
  }
  return ms;
}

let mdPat = __dirname + '/examples.md';
const ms = loadExamples('examples.txt');
const msHide = loadExamples('examples-hideTitle-default.txt');

let pass = true

const isRemoteImgHtml = (html) => /<img[^>]+src="(?:https?:)?\/\/[^"]+"/i.test(html)
const stripSizeAttrs = (html) => html.replace(/\s+width="[^"]*"/g, '').replace(/\s+height="[^"]*"/g, '')
const htmlMatches = (actual, expected) => {
  if (actual === expected) return true
  if (!isRemoteImgHtml(expected)) return false
  return stripSizeAttrs(actual) === stripSizeAttrs(expected)
}

console.log('===========================================================')
console.log('test.js - examples.txt')

let n = 1;

const h0 = md.render(fs.readFileSync(__dirname + '/test.md', 'utf-8').trim(), {'mdPath': __dirname + '/test.md'});
const c0 = '<p><img src="cat.jpg" alt="A cat" width="400" height="300"></p>\n';
try {
  assert.ok(htmlMatches(h0, c0));
} catch(e) {
  pass = false
  console.log('incorrect(0): ');
  console.log('H: ' + h0 +'C: ' + c0);
};

const hResizeDataAttr = mdResizeDataAttr.render('![Figure](cat.jpg "resize:50%")', {'mdPath': mdPat});
const cResizeDataAttr = '<p><img src="cat.jpg" alt="Figure" width="200" height="150" data-img-resize="50%"></p>\n';
try {
  assert.ok(htmlMatches(hResizeDataAttr, cResizeDataAttr));
} catch(e) {
  pass = false
  console.log('incorrect(resizeDataAttr): ');
  console.log('H: ' + hResizeDataAttr +'C: ' + cResizeDataAttr);
};

const hNoUpscale = mdNoUpscale.render('![Figure](cat.jpg "resize:200%")', {'mdPath': mdPat});
const cNoUpscale = '<p><img src="cat.jpg" alt="Figure" width="400" height="300" data-img-resize="200%"></p>\n';
try {
  assert.ok(htmlMatches(hNoUpscale, cNoUpscale));
} catch(e) {
  pass = false
  console.log('incorrect(noUpscale): ');
  console.log('H: ' + hNoUpscale +'C: ' + cNoUpscale);
};

while(n < ms.length) {
  //if (n !== 1) { n++; continue };
  console.log('Test: ' + n + ' >>>');
  //console.log(ms[n].markdown);

  const m = ms[n].markdown;
  const renderEnv = {
    mdPath: mdPat,
  }
  const h = md.render(m, renderEnv);
  try {
    assert.ok(htmlMatches(h, ms[n].html));
  } catch(e) {
    pass = false
    console.log('incorrect: ');
    console.log('H: ' + h +'C: ' + ms[n].html);
  };

  if (ms[n].htmlLazy !== undefined) {
    const hLazy = mdLazy.render(m, renderEnv);
    try {
      assert.ok(htmlMatches(hLazy, ms[n].htmlLazy));
    } catch(e) {
      pass = false
      console.log('incorrect(Lazy): ');
      console.log('H: ' + hLazy +'C: ' + ms[n].htmlLazy);
    };
  }

  if (ms[n].html !== undefined) {
    const hEnvPat = mdEnvPat.render(m);
    try {
      assert.ok(htmlMatches(hEnvPat, ms[n].html));
    } catch(e) {
      pass = false
      console.log('incorrect(mdEnvPat): ');
      console.log('H: ' + hEnvPat +'C: ' + ms[n].html);
    };
  }

  n++;
}

if (pass) console.log('\nAll tests passed')

console.log('===========================================================')
console.log('test.js - examples-hideTitle-default.txt')

n = 1;
while(n < msHide.length) {
  console.log('Test (autoHideResizeTitle default): ' + n + ' >>>');

  const m = msHide[n].markdown;
  const renderEnv = { mdPath: mdPat }
  const h = mdHideDefault.render(m, renderEnv);
  try {
    assert.ok(htmlMatches(h, msHide[n].html));
  } catch(e) {
    pass = false
    console.log('incorrect(autoHideResizeTitle default): ');
    console.log('H: ' + h +'C: ' + msHide[n].html);
  };

  n++;
}

if (pass) console.log('\nAll tests passed (including autoHideResizeTitle default)')
if (!pass) process.exitCode = 1
