import assert from 'assert'
import fs from 'fs'
import path from 'path'
import mdit from 'markdown-it'
import { Worker } from 'worker_threads'
import mditFigureWithPCaption from '@peaceroad/markdown-it-figure-with-p-caption'
import mditRendererImage, { runInPreview } from '../index.js'

let __dirname = path.dirname(new URL(import.meta.url).pathname)
const isWindows = (process.platform === 'win32')
if (isWindows) {
  __dirname = __dirname.replace(/^\/+/, '').replace(/\//g, '\\')
}

const commonOpt = { scaleSuffix: true, resize: true, autoHideResizeTitle: false }
const md = mdit().use(mditRendererImage, commonOpt);
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

try {
  await assert.rejects(runInPreview(), /runInPreview is a browser-only API/)
  assert.throws(
    () => mdit().use(mditRendererImage, { resize: true, noUpscale: false }),
    /noUpscale option was removed/
  )
  const presetOptions = { checkImgExtensions: '', disableRemoteSize: true }
  assert.strictEqual(
    mdit('commonmark').use(mditRendererImage, presetOptions).render('![Alt](cat.jpg)'),
    '<p><img src="cat.jpg" alt="Alt" /></p>\n'
  )
  assert.strictEqual(
    mdit('zero').use(mditRendererImage, presetOptions).render('![Alt](cat.jpg)'),
    '<p>![Alt](cat.jpg)</p>\n'
  )
  const mdV15Compatibility = mdit().use(mditRendererImage, presetOptions)
  assert.strictEqual(
    mdV15Compatibility.render('![a *b* `code` &copy;](cat.jpg)'),
    '<p><img src="cat.jpg" alt="a b code ©"></p>\n'
  )
  const referenceTokens = mdV15Compatibility.parse(
    '[Image Label]: cat.jpg\n\n![a\\*b][Image Label]',
    {}
  )
  const referenceImage = referenceTokens
    .flatMap((token) => token.children || [])
    .find((token) => token.type === 'image')
  assert.strictEqual(referenceImage?.meta?.label, 'IMAGE LABEL')
  assert.strictEqual(
    mdV15Compatibility.renderer.render(referenceTokens, mdV15Compatibility.options, {}),
    '<p><img src="cat.jpg" alt="a*b"></p>\n'
  )
  const figureOptions = { imageOnlyParagraphWithoutCaption: true }
  for (const plugins of [
    [mditRendererImage, mditFigureWithPCaption],
    [mditFigureWithPCaption, mditRendererImage],
  ]) {
    const mdWithFigure = mdit()
    for (const plugin of plugins) {
      mdWithFigure.use(
        plugin,
        plugin === mditRendererImage ? presetOptions : figureOptions
      )
    }
    assert.strictEqual(
      mdWithFigure.render('![a *b* `code` &copy;](cat.jpg)'),
      '<figure class="f-img">\n<img src="cat.jpg" alt="a b code ©">\n</figure>\n'
    )
  }
  let runtimeMdPathReads = 0
  const runtimeMdPath = {
    toString: () => {
      runtimeMdPathReads += 1
      return path.join(__dirname, 'test.md')
    },
  }
  const mdLazyRuntimePath = mdit().use(mditRendererImage, {
    disableRemoteSize: true,
    suppressErrors: 'all',
  })
  mdLazyRuntimePath.render('![Alt](cat.bmp)', { mdPath: runtimeMdPath })
  mdLazyRuntimePath.render('![Alt](https://example.com/cat.jpg)', { mdPath: runtimeMdPath })
  assert.strictEqual(runtimeMdPathReads, 0)
  mdLazyRuntimePath.render('![Alt](cat.jpg)', { mdPath: runtimeMdPath })
  assert.strictEqual(runtimeMdPathReads, 1)
  const mdNonSizedAttributes = mdit().use(mditRendererImage, {
    scaleSuffix: true,
    lazyLoad: true,
    asyncDecode: true,
  })
  assert.strictEqual(
    mdNonSizedAttributes.render('![Alt](icon@2x.bmp)'),
    '<p><img src="icon@2x.bmp" alt="Alt" data-img-scale-suffix="2x" decoding="async" loading="lazy"></p>\n'
  )
  const originalConsoleWarn = console.warn
  const duplicateUseWarnings = []
  try {
    console.warn = (...args) => {
      duplicateUseWarnings.push(args.map((value) => String(value)).join(' '))
    }
    const mdDuplicateUse = mdit().use(mditRendererImage, {
      resolveSrc: true,
      disableRemoteSize: true,
      suppressErrors: 'all',
      urlImageBase: 'https://a.example/',
      mdPath: path.join(__dirname, 'test.md'),
    })
    assert.throws(
      () => mdDuplicateUse.use(mditRendererImage, { noUpscale: false }),
      /noUpscale option was removed/
    )
    mdDuplicateUse.use(mditRendererImage, {
      resolveSrc: true,
      disableRemoteSize: true,
      suppressErrors: 'all',
      lazyLoad: true,
      urlImageBase: 'https://b.example/',
      mdPath: path.join(__dirname, 'test.md'),
    })
    const hDuplicateUse = mdDuplicateUse.render('![](cat.jpg)')
    assert.strictEqual(hDuplicateUse, '<p><img src="https://a.example/cat.jpg" alt="" width="400" height="300"></p>\n')
    assert.ok(duplicateUseWarnings.some((message) => message.includes('already installed')))
  } finally {
    console.warn = originalConsoleWarn
  }
} catch (error) {
  pass = false
  console.log('incorrect(setup guards): ')
  console.log(error.message)
}

const isRemoteImgHtml = (html) => /<img[^>]+src="(?:https?:)?\/\/[^"]+"/i.test(html)
const stripSizeAttrs = (html) => html.replace(/\s+width="[^"]*"/g, '').replace(/\s+height="[^"]*"/g, '')
const htmlMatches = (actual, expected) => {
  if (actual === expected) return true
  if (!isRemoteImgHtml(expected)) return false
  return stripSizeAttrs(actual) === stripSizeAttrs(expected)
}

const startProtocolRelativeImageServer = async (imagePath) => {
  const serverScript = [
    "const { parentPort, workerData } = require('worker_threads')",
    "const http = require('http')",
    "const fs = require('fs')",
    "const imagePath = workerData.imagePath",
    "const svg = Buffer.from('<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 360\"></svg>')",
    "const server = http.createServer((req, res) => {",
    "  if (req.url === '/diagram.svg') {",
    "    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': svg.length })",
    "    res.end(svg)",
    "    return",
    "  }",
    "  if (req.url !== '/cat.jpg') {",
    "    res.writeHead(404)",
    "    res.end('not found')",
    "    return",
    "  }",
    "  const stat = fs.statSync(imagePath)",
    "  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': stat.size })",
    "  fs.createReadStream(imagePath).pipe(res)",
    "})",
    "server.listen(0, '127.0.0.1', () => {",
    "  const address = server.address()",
    "  parentPort.postMessage({ type: 'listening', port: address.port })",
    "})",
    "parentPort.on('message', (message) => {",
    "  if (message !== 'stop') return",
    "  server.close(() => process.exit(0))",
    "})",
  ].join(';')

  const worker = new Worker(serverScript, {
    eval: true,
    workerData: { imagePath },
  })
  let stopped = false
  worker.once('exit', () => {
    stopped = true
  })

  const port = await new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    const onMessage = (message) => {
      if (!message || message.type !== 'listening') return
      settled = true
      cleanup()
      resolve(Number(message.port))
    }
    const onError = (error) => {
      settled = true
      cleanup()
      reject(error)
    }
    const onExit = (code) => {
      if (settled) return
      cleanup()
      reject(new Error(`image server exited before reporting a port (code: ${code})`))
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
  })

  const stop = async () => {
    if (stopped) return
    await new Promise((resolve) => {
      let resolved = false
      const finish = () => {
        if (resolved) return
        resolved = true
        resolve()
      }
      worker.once('exit', () => finish())
      worker.postMessage('stop')
      setTimeout(() => {
        worker.terminate().finally(() => finish())
      }, 1000)
    })
  }

  return { worker, port, stop }
}

console.log('===========================================================')
console.log('test.js - examples.txt')

let n = 1;

const h0 = md.render(fs.readFileSync(__dirname + '/test.md', 'utf-8').trim(), {'mdPath': __dirname + '/test.md'});
const c0 = '<p><img src="cat.jpg" alt="A cat" width="400" height="300"></p>\n';
try {
  assert.ok(htmlMatches(h0, c0));
} catch {
  pass = false
  console.log('incorrect(0): ');
  console.log('H: ' + h0 +'C: ' + c0);
};

const mdDir = mdit().use(mditRendererImage, { ...commonOpt, mdPath: __dirname });
const hDir = mdDir.render('![A cat](cat.jpg)', {});
const cDir = '<p><img src="cat.jpg" alt="A cat" width="400" height="300"></p>\n';
try {
  assert.ok(htmlMatches(hDir, cDir));
} catch {
  pass = false
  console.log('incorrect(mdPath dir): ');
  console.log('H: ' + hDir +'C: ' + cDir);
};

const hResizeDataAttr = mdResizeDataAttr.render('![Figure](cat.jpg "resize:50%")', {'mdPath': mdPat});
const cResizeDataAttr = '<p><img src="cat.jpg" alt="Figure" width="200" height="150" data-img-resize="50%"></p>\n';
try {
  assert.ok(htmlMatches(hResizeDataAttr, cResizeDataAttr));
} catch {
  pass = false
  console.log('incorrect(resizeDataAttr): ');
  console.log('H: ' + hResizeDataAttr +'C: ' + cResizeDataAttr);
};

const hNoUpscale = mdNoUpscale.render('![Figure](cat.jpg "resize:200%")', {'mdPath': mdPat});
const cNoUpscale = '<p><img src="cat.jpg" alt="Figure" width="400" height="300" data-img-resize="200%"></p>\n';
try {
  assert.ok(htmlMatches(hNoUpscale, cNoUpscale));
} catch {
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
  } catch {
    pass = false
    console.log('incorrect: ');
    console.log('H: ' + h +'C: ' + ms[n].html);
  };

  if (ms[n].htmlLazy !== undefined) {
    const hLazy = mdLazy.render(m, renderEnv);
    try {
      assert.ok(htmlMatches(hLazy, ms[n].htmlLazy));
    } catch {
      pass = false
      console.log('incorrect(Lazy): ');
      console.log('H: ' + hLazy +'C: ' + ms[n].htmlLazy);
    };
  }

  if (ms[n].html !== undefined) {
    const hEnvPat = mdEnvPat.render(m);
    try {
      assert.ok(htmlMatches(hEnvPat, ms[n].html));
    } catch {
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
  } catch {
    pass = false
    console.log('incorrect(autoHideResizeTitle default): ');
    console.log('H: ' + h +'C: ' + msHide[n].html);
  };

  n++;
}

if (pass) console.log('\nAll tests passed (including autoHideResizeTitle default)')

console.log('===========================================================')
console.log('test.js - protocol-relative remote fallback')
let protocolRelativeServer = null
const originalConsoleError = console.error
const protocolRelativeErrors = []
try {
  console.error = (...args) => {
    protocolRelativeErrors.push(args.map((value) => String(value)).join(' '))
  }
  protocolRelativeServer = await startProtocolRelativeImageServer(path.join(__dirname, 'cat.jpg'))
  const mdProtocolRelativeRemote = mdit().use(mditRendererImage, {
    ...commonOpt,
    mdPath: mdPat,
    remoteTimeout: 500,
  })
  const hProtocolRelativeRemote = mdProtocolRelativeRemote.render(`![Figure](//127.0.0.1:${protocolRelativeServer.port}/cat.jpg)`)
  assert.match(hProtocolRelativeRemote, /src="\/\/127\.0\.0\.1:\d+\/cat\.jpg"/)
  if (/width="400"/.test(hProtocolRelativeRemote) && /height="300"/.test(hProtocolRelativeRemote)) {
    // Preferred path: HTTP fallback reaches the local server and measures dimensions.
  } else {
    assert.ok(
      protocolRelativeErrors.some((message) => message.includes(`//127.0.0.1:${protocolRelativeServer.port}/cat.jpg (tried https and http)`)),
      `Expected https/http fallback log for protocol-relative URL. Logs: ${protocolRelativeErrors.join(' | ')}`
    )
  }
  const hRemoteSvg = mdProtocolRelativeRemote.render(`![Diagram](http://127.0.0.1:${protocolRelativeServer.port}/diagram.svg)`)
  assert.match(hRemoteSvg, /width="640"/)
  assert.match(hRemoteSvg, /height="360"/)
} catch (error) {
  pass = false
  console.log('incorrect(protocol-relative remote fallback): ')
  console.log(error.message)
} finally {
  console.error = originalConsoleError
  await protocolRelativeServer?.stop()
}

if (!pass) process.exitCode = 1
