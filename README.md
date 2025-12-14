# p7d-markdown-it-renderer-image

A markdown-it plugin. This adds width and height attributes to img elements.

## Use

```js
import fs from 'fs'
import mdit from 'markdown-it'
import mditRendererImage from '@peaceroad/markdown-it-renderer-image'
const md = mdit().use(mditRendererImage);

const mdPat = '/tmp/markdown.md';
const mdCont = fs.readFileSync(mdPat, 'utf-8');
// ![The cat is sitting nearby.](cat.jpg "The photo taken by k_taka.")

console.log(md.render(mdCont, {mdPath: mdPat}));
// If /tmp/cat.jpg is exists:
// <p><img src="cat.jpg" alt="The cat is sitting nearby." title="The photo taken by k_taka." width="400" height="300"></p>
```

Or,

```js
import fs from 'fs'
import mdit from 'markdown-it'
import mditRendererImage from '@peaceroad/markdown-it-renderer-image'
const mdPat = '/tmp/markdown.md';
const md = mdit().use(mditRendererImage, {mdPath: mdPat});
const mdCont = fs.readFileSync(mdPat, 'utf-8');

console.log(md.render(mdCont));
```

## Option

### Setting dpi by filename scale suffix

You can adjust the height and width attributes by using the option `{scaleSuffix: true}`.

```js
const md = mdit().use(mditRendererImage, {scaleSuffix: true});

console.log(md.render('![A cat.](cat@2x.jpg)', {mdPath: mdPat}));
// <p><img src="cat@2x.jpg" alt="A cat." width="200" height="150"></p>

console.log(md.render('![A cat.](cat_300dpi.jpg)', {mdPath: mdPat}));
// <p><img src="cat_300dpi.jpg" alt="A cat." width="128" height="96"></p>

console.log(md.render('![A cat.](cat_300ppi.jpg)', {mdPath: mdPat}));
// <p><img src="cat_300ppi.jpg" alt="A cat." width="128" height="96"></p>
```

This is identified by `imageFileName.match(/[@._-]([0-9]+)(x|dpi|ppi)$/)`


### Resizing layout image by title attribute

Option to resize based on the value of the title attribute: `{resize: true}`

```js
const md = mdit().use(mditRendererImage, {resize: true});

console.log(md.render('![A cat.](cat.jpg "Resize:50%")', {mdPath: mdPat}));
// <p><img src="cat.jpg" alt="A cat." width="200" height="150"></p>

console.log(md.render('![A cat.](cat.jpg "リサイズ：50%")', {mdPath: mdPat}));
// <p><img src="cat.jpg" alt="A cat." width="200" height="150"></p>

console.log(md.render('![A cat.](cat.jpg "サイズ変更：50%")', {mdPath: mdPat}));
// <p><img src="cat.jpg" alt="A cat." width="200" height="150"></p>

console.log(md.render('![A cat.](cat.jpg "The photo taken by k_taka. The shown photo have been resized to 50%.")', {mdPath: mdPat}));
// <p><img src="cat.jpg" alt="A cat." title="The photo taken by k_taka. The shown photo have been resized to 50%." width="200" height="150"></p>

console.log(md.render('![Figure](cat.jpg "resize:320px")', {mdPath: mdPat}));
// <p><img src="cat.jpg" alt="Figure" title="resize:320px" width="320" height="240"></p>

console.log(md.render('![Figure](cat@2x.jpg "resize:320px"))', {mdPath: mdPat}));
// <p><img src="cat@2x.jpg" alt="Figure" title="resize:320px" width="320" height="240"></p>
```

This is identified by `imgTitle.match(/(?:(?:(?:大きさ|サイズ)の?変更|リサイズ|resize(?:d to)?) *[:：]? *([0-9]+)([%％]|px)|([0-9]+)([%％]|px)[にへ](?:(?:大きさ|サイズ)を?変更|リサイズ))/i)`

If `px` is specified, the numerical value is treated as the width after resizing.

---

Notice: Other Markdown extended notations may specify a caption in the title attribute. Therefore, think carefully about whether to enable this option.

If you want to use resize functionality while hiding the title attribute from the final HTML output, you can combine this with next `{hideTitle: true}` option.

---

### Hiding title attribute

By default, the title attribute is removed **only when** `resize` is enabled and the title matches the resize pattern. Set `{hideTitle: false}` to always keep title, or leave it on when you want resize hints without keeping the title attribute.

```js
const md = mdit().use(mditRendererImage, {hideTitle: true});

console.log(md.render('![Alt text](image.jpg "resize: 50%")'));
// <p><img src="image.jpg" alt="Alt text" width="200" height="150"></p>
```

### Setting lazy load

By using `{lazyLoad: true}`, it can have `loading="lazy"` attribute.

```js
const md = mdit().use(mditRendererImage, {lazyLoad: true});

console.log(md.render('![A cat.](cat.jpg)', {mdPath: mdPat}));
// <p><img src="cat.jpg" alt="A cat." loading="lazy" width="400" height="300"></p>
```

### Setting async decode

By using `{asyncDecode: true}`, it can have `decoding="async"` attribute.

```js
const md = mdit().use(mditRendererImage, {asyncDecode: true});

console.log(md.render('![A cat.](cat.jpg)', {mdPath: mdPat}));
// <p><img src="cat.jpg" alt="A cat." decoding="async" width="400" height="300"></p>
```

### Check image extension

By default, the image (extension) that specifies the width and height is limited to png, jpg, jpeg, gif, and webp. If you want to include other formats (for example svg), set `{checkImgExtensions: 'png,jpg,jpeg,gif,webp,svg' }`. Extensions are matched before query/hash, so `image.jpg?ver=1` is handled.

### Remote image sizing

Remote images are fetched synchronously to read dimensions (blocks until fetch completes). This is **enabled by default**; disable it explicitly if you do not want remote fetch during render:

```js
const md = mdit().use(mditRendererImage, {
  disableRemoteSize: true, // opt out of remote fetch
  remoteTimeout: 3000,      // ms timeout for remote fetch (default: 5000)
  remoteMaxBytes: 16 * 1024 * 1024, // skip remote images larger than this when content-length is present (default 16MB)
  suppressErrors: 'remote', // 'none' | 'all' | 'local' | 'remote'
})
```

Image dimension results are cached per render (`cacheMax`: default 64 entries). Set `cacheMax: 0` to disable caching.

### Image source modification

You can control how image sources are processed and modified:

#### modifyImgSrc

When `{modifyImgSrc: true}`, the plugin will modify image src attributes based on frontmatter metadata (lid, lmd, url). This is useful for converting local development paths to production URLs.

```js
const md = mdit().use(mditRendererImage, {modifyImgSrc: true});
```

#### imgSrcPrefix

Adds a prefix to image URLs when used with the `url` frontmatter option:

```js
const md = mdit().use(mditRendererImage, {
  modifyImgSrc: true,
  imgSrcPrefix: 'https://cdn.example.com/'
});
```


### YAML Frontmatter Options

When `modifyImgSrc: true` is enabled, you can use these frontmatter options to control image source modification:

- **lid** (Local Image Directory): Replaces the directory path in image URLs relative to the markdown file's directory, useful for converting local development paths to production paths
- **lmd** (Local Media Directory): Similar to `lid` but specifically for media files, uses absolute paths and provides more granular control over media file paths (used in DOM/browser environments only)
- **url**: Sets a base URL prefix for images

#### Local Development and VS Code Environment

```yaml
---
url: https://example.com/article/
lid: images
---

![Sample Image](./images/sample.jpg)

<!-- // Result: <img src="https://example.com/article/sample.jpg" alt="Sample Image" width="400" height="300"> -->
```

#### Browser DOM Manipulation

```yaml
---
url: https://example.com/article/
lmd: C:\Users\User\manuscript
---

![Sample Image](sample.jpg)

<!-- // Result: <img src="https://example.com/article/sample.jpg" alt="Sample Image" width="400" height="300"> -->
```

Or with file:// protocol:

```yaml
---
url: https://example.com/article/
lmd: file:///C:/Users/User/manuscript
---

![Sample Image](sample.jpg)

<!-- // Result: <img src="https://example.com/article/sample.jpg" alt="Sample Image" width="400" height="300"> -->
```

## Browser Support

This plugin consists of three main components:

- `index.js`: The main markdown-it plugin for server-side rendering and image attribute processing
- `script/img-util.js`: Utility functions for image processing (shared between server and browser)
- `script/set-img-attributes.js`: Browser-side functionality for setting image attributes directly in the DOM

## Browser Usage

This script is designed for browser environments only (requires DOM access).

### Direct ES6 Module Import

```html
<script type="module">
import setImgAttributes from '<package-directory>/script/set-img-attributes.js'

// Set attributes for all existing images in the DOM
// First parameter can be null when processing existing DOM images
await setImgAttributes(null, {
  scaleSuffix: true,
  resize: true,
  lazyLoad: true,
  asyncDecode: true,
  hideTitle: true
})
</script>
```

### With Bundler (Webpack, etc.)

```js
import setImgAttributes from '@peaceroad/markdown-it-renderer-image/script/set-img-attributes.js'

// Example usage in your application
txt.addEventListener('input', async () => {
  let markdownCont = txt.value
  // ... render HTML with markdown-it ...
  html.innerHTML = renderedHtml
  
  try {
    await setImgAttributes(markdownCont, {
      scaleSuffix: true,
      resize: true,
      lazyLoad: true,
      asyncDecode: false,
      modifyImgSrc: true,
      imgSrcPrefix: 'https://example.com/images/',
      hideTitle: true
    })
  } catch (error) {
    console.error('Error setting image attributes:', error)
  }
})
```

## Testing

Run tests to verify functionality:

- `npm test` - Run main plugin tests and YAML frontmatter tests
- `npm run test:script` - Run browser script tests for DOM manipulation
