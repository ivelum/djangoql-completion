export function DOMReady(callback) {
  if (document.readyState !== 'loading') {
    callback();
  } else {
    document.addEventListener('DOMContentLoaded', callback);
  }
}

export function setUrlParams(url, params) {
  const parts = url.split('?');
  const path = parts[0];
  let queryString = parts.slice(1).join('?');
  const pairs = queryString.split('&');
  let pair;
  let key;
  let value;
  let i;

  Object.keys(params).forEach((k) => {
    key = encodeURI(k);
    value = encodeURI(params[key]);
    i = pairs.length;
    while (i--) {
      pair = pairs[i].split('=');
      if (pair[0] === key) {
        pair[1] = value;
        pairs[i] = pair.join('=');
        break;
      }
    }
    if (i < 0) {
      pairs.push(`${key}=${value}`);
    }
  });
  queryString = pairs.join('&');
  return queryString ? [path, queryString].join('?') : path;
}

export function escapeRegExp(str) {
  // http://stackoverflow.com
  // /questions/3446170/escape-string-for-use-in-javascript-regex
  // eslint-disable-next-line no-useless-escape
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}
