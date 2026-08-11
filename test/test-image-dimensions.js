import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import mdit from 'markdown-it'
import mditRendererImage from '../index.js'
import { getSvgDimensionsFromData } from '../script/svg-dimensions.js'

const setUint24LE = (bytes, offset, value) => {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
}

const createPng = (width, height) => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

const createGif = (width, height) => {
  const bytes = new Uint8Array(10)
  bytes.set(new TextEncoder().encode('GIF89a'))
  new DataView(bytes.buffer).setUint16(6, width, true)
  new DataView(bytes.buffer).setUint16(8, height, true)
  return bytes
}

const createJpeg = (width, height) => Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x02,
  0xff, 0xc0, 0x00, 0x07, 0x08,
  (height >>> 8) & 0xff, height & 0xff,
  (width >>> 8) & 0xff, width & 0xff,
])

const createJpegWithLargeMetadata = (width, height) => {
  const frameOffset = 4 + 0xffff
  const bytes = new Uint8Array(frameOffset + 9)
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff])
  bytes.set([
    0xff, 0xc0, 0x00, 0x07, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
  ], frameOffset)
  return bytes
}

const createWebp = (width, height) => {
  const bytes = new Uint8Array(30)
  bytes.set(new TextEncoder().encode('RIFF'))
  bytes.set(new TextEncoder().encode('WEBP'), 8)
  bytes.set(new TextEncoder().encode('VP8X'), 12)
  setUint24LE(bytes, 24, width - 1)
  setUint24LE(bytes, 27, height - 1)
  return bytes
}

const encodeSvg = (value) => new TextEncoder().encode(value)
const encodeUtf16LeSvg = (value) => Buffer.concat([
  Buffer.from([0xff, 0xfe]),
  Buffer.from(value, 'utf16le'),
])

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-image-dimensions-'))
try {
  const cases = [
    ['sample.png', createPng(320, 240), 320, 240],
    ['sample.gif', createGif(321, 241), 321, 241],
    ['sample.jpg', createJpeg(322, 242), 322, 242],
    ['late.jpg', createJpegWithLargeMetadata(324, 244), 324, 244],
    ['sample.webp', createWebp(323, 243), 323, 243],
    ['sample.svg', encodeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"></svg>'), 640, 360],
    ['late.svg', encodeSvg(`<!--${'x'.repeat(70 * 1024)}--><svg viewBox="0 0 800 450"></svg>`), 800, 450],
    ['utf16.svg', encodeUtf16LeSvg('<svg viewBox="0 0 1024 576"></svg>'), 1024, 576],
  ]
  for (const [filename, bytes] of cases) fs.writeFileSync(path.join(tempDir, filename), bytes)
  fs.writeFileSync(
    path.join(tempDir, 'large.svg'),
    encodeSvg(`<svg viewBox="0 0 1280 720">${' '.repeat(1024 * 1024)}</svg>`)
  )

  const invalidPng = Uint8Array.from([
    0x69, 0x63, 0x6e, 0x73,
    0x00, 0x00, 0x00, 0x08,
    0x00, 0x00, 0x00, 0x00,
  ])
  fs.writeFileSync(path.join(tempDir, 'invalid.png'), invalidPng)

  const md = mdit().use(mditRendererImage, {
    mdPath: path.join(tempDir, 'document.md'),
    suppressErrors: 'all',
  })

  for (const [filename, , width, height] of cases) {
    const html = md.render(`![sample](${filename})`)
    assert.match(html, new RegExp(`width="${width}"`))
    assert.match(html, new RegExp(`height="${height}"`))
  }

  let localBytesRead = 0
  const originalReadSync = fs.readSync
  try {
    fs.readSync = (...args) => {
      const bytesRead = originalReadSync(...args)
      localBytesRead += bytesRead
      return bytesRead
    }
    const largeSvgHtml = md.render('![large](large.svg)')
    assert.match(largeSvgHtml, /width="1280"/)
    assert.match(largeSvgHtml, /height="720"/)
  } finally {
    fs.readSync = originalReadSync
  }
  assert.strictEqual(localBytesRead, 64 * 1024)

  const conditionalResizeMd = mdit().use(mditRendererImage, {
    mdPath: path.join(tempDir, 'document.md'),
    conditionalResize: {
      minWidth: 300,
      targetWidth: 160,
    },
  })
  const conditionalResizeHtml = conditionalResizeMd.render('![sample](sample.png)')
  assert.match(conditionalResizeHtml, /width="160"/)
  assert.match(conditionalResizeHtml, /height="120"/)

  const invalidHtml = md.render('![invalid](invalid.png)')
  assert.doesNotMatch(invalidHtml, /\s(?:width|height)="/)

  assert.deepStrictEqual(
    getSvgDimensionsFromData(encodeSvg(`<?xml version="1.0"?>
<!-- <svg width="1" height="1"> -->
<!DOCTYPE svg [<!ENTITY unused "ignored">]>
<svg xmlns="http://www.w3.org/2000/svg" width="10cm" height="5cm" viewBox="0 0 2 1"></svg>`)),
    { width: 378, height: 189 }
  )
  assert.deepStrictEqual(
    getSvgDimensionsFromData(encodeSvg('<svg width="320" viewBox="0 0 16 9"></svg>')),
    { width: 320, height: 180 }
  )
  assert.deepStrictEqual(
    getSvgDimensionsFromData(encodeSvg('<svg width="100%" height="100%" viewBox="0 0 640 360"></svg>')),
    { width: 640, height: 360 }
  )
  assert.deepStrictEqual(
    getSvgDimensionsFromData(encodeSvg('<svg aria-label="1 > 0" viewBox="0 0 400 225"></svg>')),
    { width: 400, height: 225 }
  )
  assert.deepStrictEqual(
    getSvgDimensionsFromData(encodeSvg('<svg data-note=\' width="999" height="999"\' viewBox="0 0 400 225"></svg>')),
    { width: 400, height: 225 }
  )
  assert.strictEqual(
    getSvgDimensionsFromData(encodeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    null
  )
  assert.strictEqual(
    getSvgDimensionsFromData(encodeSvg('<svg width="0" height="100" viewBox="0 0 16 9"></svg>')),
    null
  )
  assert.strictEqual(
    getSvgDimensionsFromData(encodeSvg('<html><svg width="640" height="360"></svg></html>')),
    null
  )
  assert.strictEqual(
    getSvgDimensionsFromData(encodeSvg('<!DOCTYPE svg [<!ENTITY w "640">]><svg width="&w;" height="360"></svg>')),
    null
  )
  assert.strictEqual(
    getSvgDimensionsFromData(encodeSvg('<svg width="640" width="320" height="360"></svg>')),
    null
  )
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}

console.log('image-dimensions integration tests passed')
