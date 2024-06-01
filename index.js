import path from 'path'
import fetch from "sync-fetch"
import sizeOf from 'image-size'

const setImgSize = (token, img, imgData, option) => {
  if (!imgData) return token;
  let w = imgData.width;
  let h = imgData.height;
  //console.log('w: ' + w + ', h: ' + h);
  const imgName = path.basename(img, path.extname(img));
  if (option.scaleSuffix) {
    const reg = /[@._-]([0-9]+)(x|dpi|ppi)$/;
    const rs = imgName.match(reg);
    if (rs) {
      if (rs[2] === 'x') {
        w = Math.round(w / rs[1]);
        h = Math.round(h / rs[1]);
      }
      if (/(dpi|ppi)/.test(rs[2])) {
        w = Math.round(w * 96 / rs[1]);
        h = Math.round(h * 96 / rs[1]);
      }
    }
  }
  const imgTitle = token.attrGet('title');
  if (imgTitle && option.resize) {
    const resizeReg = /(?:(?:(?:大きさ|サイズ)の?変更|リサイズ|resize(?:d to)?)? *[:：]? *([0-9]+)([%％]|px)|([0-9]+)([%％]|px)に(?:(?:大きさ|サイズ)を?変更|リサイズ))/i;
    const hasResizeSetting = imgTitle.match(resizeReg);
    if(hasResizeSetting) {
      const resizeValue = +hasResizeSetting[1];
      const resizeUnit = hasResizeSetting[2];
      //console.log('w: ' + w + ', h: ' + h);
      if (resizeUnit.match(/[%％]/)) {
        w = Math.round(w * resizeValue / 100);
        h = Math.round(h * resizeValue / 100);
      }
      if (resizeUnit.match(/px/)) {
        const bw = w;
        w = Math.round(resizeValue);
        h = Math.round(h * resizeValue / bw);
      }
    }
  }
  //console.log('w: ' + w + ', h: ' + h);
  token.attrJoin('width', w);
  token.attrJoin('height', h);
  return token;
}

const addAsyncDecode = (imgCont) => {
  imgCont = imgCont.replace(/( *?\/)?>$/, ' decoding="async"$1>');
  return imgCont;
}

const addLazyLoad = (imgCont) => {
  imgCont = imgCont.replace(/( *?\/)?>$/, ' loading="lazy"$1>');
  return imgCont;
}

const setLocalImgSrc = (imgSrc, option, env) => {
  let img = '';
  if (option.mdPath) {
    img = path.dirname(option.mdPath);
  } else {
    if (env !== undefined) {
      if (env.mdPath) {
        img = path.dirname(env.mdPath);
      }
    }
  }
  img += path.sep + imgSrc;
  img = decodeURI(img);
  return img;
}

const mditRendererImage = (md, option) => {
  const opt = {
    scaleSuffix: false,
    mdPath: '',
    lazyLoad: false,
    resize: false,
    asyncDecode: false,
  };
  if (option !== undefined) {
    for (let o in option) {
        opt[o] = option[o];
    }
  }

  md.renderer.rules['image'] = (tokens, idx, options, env, slf) => {
    let endTagCont = '>';
    if (options.xhtmlOut) {
      endTagCont = ' />';
    }
    const token = tokens[idx];
    let imgAlt = md.utils.escapeHtml(token.content);
    let imgSrc = md.utils.escapeHtml(token.attrGet('src'));
    let imgTitle = md.utils.escapeHtml(token.attrGet('title'));
    let imgCont = '<img src="' + decodeURI(imgSrc) + '"' + endTagCont;
    imgCont = imgCont.replace(/( src=".*?")/, '$1 alt="' + imgAlt + '"');
    if (imgTitle) {
      imgCont = imgCont.replace(/( *?\/)?>$/, ' title="' + imgTitle + '"$1>');
    }
    if (option.asyncDecode) {
      imgCont = addAsyncDecode(imgCont, option);
    }
    if (option.lazyLoad) {
      imgCont = addLazyLoad(imgCont, option);
    }

    let isNotLocal = /^https?:\/\//.test(imgSrc);
    let imgData = {};

    if (isNotLocal) {
      try {
        const response = fetch(imgSrc);
        const buffer = response.buffer();
        imgData = sizeOf(buffer);
      } catch {
        console.error('[renderder-image]No image: ' + imgSrc);
      }
      if (imgData.width !== undefined) {
        setImgSize(token, imgSrc, imgData, option);
        imgCont = imgCont.replace(/( *?\/)?>$/, ' width="' + token.attrGet('width') + '" height="' + token.attrGet('height') + '"$1>');
      }

    } else {
      imgSrc = setLocalImgSrc(imgSrc, option, env)
      try {
        imgData = sizeOf(imgSrc);
      } catch {
        console.error('[renderder-image]No image: ' + imgSrc);
      }
      if (imgData.width !== undefined) {
        setImgSize(token, imgSrc, imgData, option);
        imgCont = imgCont.replace(/( *?\/)?>$/, ' width="' + token.attrGet('width') + '" height="' + token.attrGet('height') + '"$1>');
      }
    }

    return imgCont;
  }
}

export default mditRendererImage