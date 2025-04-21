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

const md = mdit().use(mditRendererImage, {scaleSuffix: true, resize: true});
//const mdLazy = mdit().use(mditRendererImage, {scaleSuffix: true, lazyLoad: true, asyncDecode: true});
const mdLazy = mdit().use(mditRendererImage, {scaleSuffix: true, lazyLoad: true});
const mdEnvPat = mdit().use(mditRendererImage, {scaleSuffix: true, resize: true, mdPath: __dirname + '/examples.md'});


const example = __dirname + '/examples.txt';
let mdPat = __dirname + '/examples.md';
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

let pass = true

n = 1;

const h0 = md.render(fs.readFileSync('./test/test.md', 'utf-8').trim(), {'mdPath': './test/test.md'});
const c0 = '<p><img src="cat.jpg" alt="A cat" width="400" height="300"></p>\n';
try {
  assert.strictEqual(h0, c0);
} catch(e) {
  pass = false
  console.log('incorrect(0): ');
  console.log('H: ' + h0 +'C: ' + c0);
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
    assert.strictEqual(h, ms[n].html);
  } catch(e) {
    pass = false
    console.log('incorrect: ');
    console.log('H: ' + h +'C: ' + ms[n].html);
  };

  if (ms[n].htmlLazy !== undefined) {
    const hLazy = mdLazy.render(m, renderEnv);
    try {
      assert.strictEqual(hLazy, ms[n].htmlLazy);
    } catch(e) {
      pass = false
      console.log('incorrect(Lazy): ');
      console.log('H: ' + hLazy +'C: ' + ms[n].htmlLazy);
    };
  }

  if (ms[n].html !== undefined) {
    const hEnvPat = mdEnvPat.render(m);
    try {
      assert.strictEqual(hEnvPat, ms[n].html);
    } catch(e) {
      pass = false
      console.log('incorrect(mdEnvPat): ');
      console.log('H: ' + hEnvPat +'C: ' + ms[n].html);
    };
  }

  n++;
}

if (pass) console.log('\nAll tests passed')
