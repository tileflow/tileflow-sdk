/** Network-free contract cases shared by Node tests and an application running packed Core. */
export function checkNativeUrlContract(native, developmentOrigin) {
  const generation = 'a'.repeat(64);
  const root = `${developmentOrigin}/generations/${generation}`;
  const documentUrl = `${root}/styles/streets/light.json`;
  const options = {documentUrl, developmentOrigin};
  const rows = [];
  const value = (id, run, expected) => {
    try {
      const actual = run();
      rows.push({id, passed: actual === expected, actual, expected});
    } catch (error) {
      rows.push({
        id,
        passed: false,
        expected,
        error: {name: error.name, code: error.code, field: error.field},
      });
    }
  };
  const rejected = (id, run, code, field) => {
    try {
      const actual = run();
      rows.push({id, passed: false, actual, expected: {code, field}});
    } catch (error) {
      const passed =
        error instanceof native.TileflowNativeUrlError &&
        error.code === code &&
        error.field === field &&
        error.cause === undefined &&
        !String(error.message).includes('secret-value');
      rows.push({
        id,
        passed,
        actual: {name: error.name, code: error.code, field: error.field},
        expected: {code, field},
      });
    }
  };
  const resource = (url, overrides = {}) =>
    native.resolveTileflowNativeResourceUrl(url, {...options, ...overrides});
  value(
    'absolute-manifest',
    () => native.resolveTileflowNativeManifestUrl(documentUrl, {developmentOrigin}),
    documentUrl,
  );
  value(
    'https-manifest',
    () => native.resolveTileflowNativeManifestUrl('https://maps.example.test/manifest.json'),
    'https://maps.example.test/manifest.json',
  );
  value(
    'style-from-manifest',
    () => resource('styles/streets/light.json', {documentUrl: `${root}/manifest.json`}),
    documentUrl,
  );
  value(
    'sprite-from-style',
    () => resource('../../icons/streets/sprite'),
    `${root}/icons/streets/sprite`,
  );
  value(
    'tilejson-from-style',
    () => resource('../../sources/world.json'),
    `${root}/sources/world.json`,
  );
  value(
    'tiles-from-tilejson',
    () =>
      resource('../tiles/{z}/{x}/{y}{ratio}.pbf', {
        documentUrl: `${root}/sources/world.json`,
        template: 'tile',
      }),
    `${root}/tiles/{z}/{x}/{y}{ratio}.pbf`,
  );
  value(
    'glyphs-from-style',
    () => resource('../../fonts/{fontstack}/{range}.pbf', {template: 'glyphs'}),
    `${root}/fonts/{fontstack}/{range}.pbf`,
  );
  value('root-relative', () => resource('/icons/sprite'), `${developmentOrigin}/icons/sprite`);
  value('query-only', () => resource('?theme=dark'), `${documentUrl}?theme=dark`);
  value(
    'encoded-dot-segments',
    () => resource('%2e%2e/%2e%2e/icons/sprite'),
    `${root}/icons/sprite`,
  );
  value(
    'escaped-placeholder-stays-escaped',
    () => resource('../../tiles/%7Bz%7D', {template: 'tile'}),
    `${root}/tiles/%7Bz%7D`,
  );
  value(
    'international-host',
    () => native.resolveTileflowNativeManifestUrl('https://bücher.example.test/a.json'),
    'https://xn--bcher-kva.example.test/a.json',
  );
  value(
    'mapped-host-and-default-port',
    () => native.resolveTileflowNativeManifestUrl('https://ＭＡＰＳ.example.test:443/a.json'),
    'https://maps.example.test/a.json',
  );
  value(
    'escaped-host',
    () => native.resolveTileflowNativeManifestUrl('https://m%61ps.example.test/a.json'),
    'https://maps.example.test/a.json',
  );
  value(
    'canonical-development-origin',
    () =>
      native.resolveTileflowNativeManifestUrl('http://127.0.0.1:80/a.json', {
        developmentOrigin: 'http://127.0.0.1',
      }),
    'http://127.0.0.1/a.json',
  );
  rejected(
    'http-without-explicit-origin',
    () => native.resolveTileflowNativeManifestUrl(documentUrl),
    'NATIVE_URL_HTTPS_REQUIRED',
    'manifestUrl',
  );
  rejected(
    'different-development-origin',
    () => resource('http://other.example.test/secret-value'),
    'NATIVE_URL_HTTPS_REQUIRED',
    'resourceUrl',
  );
  rejected(
    'credentials',
    () => resource('https://user:secret-value@maps.example.test/a'),
    'NATIVE_URL_INVALID',
    'resourceUrl',
  );
  rejected(
    'fragments',
    () => resource('icons/sprite#secret-value'),
    'NATIVE_URL_INVALID',
    'resourceUrl',
  );
  rejected(
    'encoded-host-template',
    () => resource('https://%7Bz%7D.example.test/a', {template: 'tile'}),
    'NATIVE_URL_TEMPLATE_INVALID',
    'resourceUrl',
  );
  rejected(
    'unicode-host-template',
    () => resource('https://｛z｝.example.test/a', {template: 'tile'}),
    'NATIVE_URL_TEMPLATE_INVALID',
    'resourceUrl',
  );
  rejected(
    'bounded-input',
    () => resource('a'.repeat(native.tileflowNativeUrlLimits.maximumLength + 1)),
    'NATIVE_URL_INVALID',
    'resourceUrl',
  );
  return rows;
}
