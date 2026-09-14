/**
 * Test-only adaptation of React Native 0.83.10 Libraries/Blob/URL.js.
 * Source: https://github.com/react/react-native/blob/v0.83.10/packages/react-native/Libraries/Blob/URL.js
 * Source blob: c0f496e1954f0dd12734e8a76e56c86a4b813101
 * Flow annotations, Blob APIs and unused URLSearchParams methods are omitted.
 * The constructor and string accessors used by Core retain upstream behavior.
 * This intentionally non-WHATWG implementation is not a production resolver.
 *
 * MIT License
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

function validateBaseUrl(url) {
  // Upstream credits this MIT-licensed expression to https://gist.github.com/dperini/729294.
  return /^(?:(?:(?:https?|ftp):)?\/\/)(?:(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u00a1-\uffff][a-z0-9\u00a1-\uffff_-]{0,62})?[a-z0-9\u00a1-\uffff]\.)*(?:[a-z\u00a1-\uffff]{2,}\.?))(?::\d{2,5})?(?:[/?#]\S*)?$/.test(url);
}

export class ReactNative083URL {
  constructor(url, base) {
    let baseUrl = null;
    if (!base || validateBaseUrl(url)) {
      this._url = url;
      if (this._url.includes('#')) {
        const split = this._url.split('#');
        const beforeHash = split[0];
        const website = beforeHash.split('://')[1];
        if (!website.includes('/')) this._url = split.join('/#');
      }
      if (!this._url.endsWith('/') && !(this._url.includes('?') || this._url.includes('#'))) {
        this._url += '/';
      }
    } else {
      if (typeof base === 'string') {
        baseUrl = base;
        if (!validateBaseUrl(baseUrl)) throw new TypeError(`Invalid base URL: ${baseUrl}`);
      } else {
        baseUrl = base.toString();
      }
      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, baseUrl.length - 1);
      if (!url.startsWith('/')) url = `/${url}`;
      if (baseUrl.endsWith(url)) url = '';
      this._url = `${baseUrl}${url}`;
    }
  }

  get hash() {
    const match = this._url.match(/#([^/]*)/);
    return match ? `#${match[1]}` : '';
  }

  get hostname() {
    const match = this._url.match(/^https?:\/\/(?:[^@]+@)?([^:/?#]+)/);
    return match ? match[1] : '';
  }

  get href() {
    return this.toString();
  }

  get origin() {
    const match = this._url.match(/^(https?:\/\/[^/]+)/);
    return match ? match[1] : '';
  }

  get password() {
    const match = this._url.match(/https?:\/\/.*:(.*)@/);
    return match ? match[1] : '';
  }

  get pathname() {
    const match = this._url.match(/https?:\/\/[^/]+(\/[^?#]*)?/);
    return match ? match[1] || '/' : '/';
  }

  get protocol() {
    const match = this._url.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
    return match ? match[1] + ':' : '';
  }

  get search() {
    const match = this._url.match(/\?([^#]*)/);
    return match ? `?${match[1]}` : '';
  }

  get username() {
    const match = this._url.match(/^https?:\/\/([^:@]+)(?::[^@]*)?@/);
    return match ? match[1] : '';
  }

  toString() {
    return this._url;
  }
}
