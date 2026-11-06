import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const plugin = require('../plugin/transforms.cjs');

const credential = `tf_public_${'a'.repeat(48)}`;
const env = {TILEFLOW_MAP_CREDENTIAL: credential, TILEFLOW_SEARCH_CREDENTIAL: ` ${credential} `};

test('credentials come only from the environment, never from props', () => {
  for (const key of ['mapCredential', 'apiKey', 'token', 'servicesSecret']) {
    assert.throws(() => plugin.settings({[key]: credential}, {}), /environment variables/u);
  }
  assert.throws(() => plugin.settings({}, {TILEFLOW_MAP_CREDENTIAL: 'pk.mapbox'}), /tf_public_/u);
  assert.throws(() => plugin.settings({colour: 'red'}, {}), /unknown plugin prop/u);
  const settings = plugin.settings({}, env);
  assert.equal(settings.apiOrigin, 'https://api.tileflow.dev');
  assert.deepEqual(
    settings.credentials.map(({plist, value}: {plist: string; value: string}) => [plist, value]),
    [
      ['TileflowMapCredential', credential],
      ['TileflowSearchCredential', credential],
    ],
  );
});

test('the API origin must be an origin', () => {
  assert.equal(
    plugin.settings({apiOrigin: 'HTTPS://API.Example.test/'}, {}).apiOrigin,
    'https://api.example.test',
  );
  for (const apiOrigin of [
    'api.example.test',
    'https://api.example.test/v1',
    'https://u:p@api.example.test',
    'ftp://a.test',
  ]) {
    assert.throws(() => plugin.settings({apiOrigin}, {}), /apiOrigin/u);
  }
});

test('Info.plist gets the native configuration, and background updates when asked', () => {
  const settings = plugin.settings({offline: {backgroundUpdates: true}}, env);
  const plist = plugin.infoPlist(
    {
      TileflowRoutingCredential: 'stale',
      UIBackgroundModes: ['audio'],
      BGTaskSchedulerPermittedIdentifiers: [],
    },
    settings,
  );
  assert.equal(plist.TileflowAPIOrigin, 'https://api.tileflow.dev');
  assert.equal(plist.TileflowMapCredential, credential);
  assert.equal(plist.TileflowSearchCredential, credential);
  assert.equal(plist.TileflowRoutingCredential, undefined);
  assert.deepEqual(plist.BGTaskSchedulerPermittedIdentifiers, ['dev.tileflow.offline.update']);
  assert.deepEqual(plist.UIBackgroundModes, ['audio', 'fetch']);
  assert.deepEqual(plugin.infoPlist(plist, settings), plist);
  const without = plugin.infoPlist({}, plugin.settings({}, {}));
  assert.equal(without.BGTaskSchedulerPermittedIdentifiers, undefined);
  assert.equal(without.TileflowMobileConfiguration, undefined);
});

test('Android string resources replace earlier Tileflow values', () => {
  const settings = plugin.settings({}, env);
  const xml = plugin.stringsXml(
    {
      resources: {
        string: [
          {$: {name: 'app_name'}, _: 'App'},
          {$: {name: 'tileflow_map_credential'}, _: 'stale'},
        ],
      },
    },
    settings,
  );
  const strings = Object.fromEntries(
    xml.resources.string.map((item: {$: {name: string}; _: string}) => [item.$.name, item._]),
  );
  assert.deepEqual(strings, {
    app_name: 'App',
    tileflow_api_origin: 'https://api.tileflow.dev',
    tileflow_map_credential: credential,
    tileflow_search_credential: credential,
  });
  assert.deepEqual(plugin.stringsXml(xml, settings), xml);
});

const appDelegate = `import Expo
import React

@main
class AppDelegate: ExpoAppDelegate {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
}
`;

test('the AppDelegate registers the background task and forwards background sessions once', () => {
  const settings = plugin.settings({offline: {backgroundUpdates: true}}, {});
  const changed = plugin.appDelegate(appDelegate, settings);
  assert.match(changed, /^import TileflowReactNative$/mu);
  assert.match(
    changed,
    /Bool \{\n {4}\/\/ @tileflow\/react-native[^\n]*\n {4}TileflowReactNativeApp\.registerBackgroundTasks\(\)/u,
  );
  const forward = changed.indexOf('handleEventsForBackgroundURLSession identifier');
  assert.ok(forward > 0 && forward < changed.indexOf('class ReactNativeDelegate'));
  assert.equal(plugin.appDelegate(changed, settings), changed);
  assert.equal(plugin.appDelegate(appDelegate, plugin.settings({}, {})), appDelegate);
});

test('the Podfile calls the Tileflow hook after React Native', () => {
  const podfile = `  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
    )
  end
`;
  const changed = plugin.podfile(
    podfile,
    plugin.settings({ios: {swiftPackagePath: '/sdk/swift'}}, {}),
  );
  assert.match(changed, /\)\n {4}tileflow_post_install\(installer\)\n/u);
  assert.match(changed, /^ENV\['TILEFLOW_SWIFT_PACKAGE_PATH'\] \|\|= "\/sdk\/swift"\n/u);
  assert.equal(
    plugin.podfile(changed, plugin.settings({ios: {swiftPackagePath: '/sdk/swift'}}, {})),
    changed,
  );
  assert.doesNotMatch(
    plugin.podfile(changed, plugin.settings({}, {})),
    /TILEFLOW_SWIFT_PACKAGE_PATH/u,
  );
});

test('iOS deployment targets rise to the SDK minimum only', () => {
  assert.deepEqual(plugin.podfileProperties({'ios.deploymentTarget': '15.1'}), {
    'ios.deploymentTarget': '16.0',
  });
  assert.deepEqual(plugin.podfileProperties({'ios.deploymentTarget': '17.0'}), {
    'ios.deploymentTarget': '17.0',
  });
  const configurations = plugin.deploymentTargets({
    a: {buildSettings: {IPHONEOS_DEPLOYMENT_TARGET: '15.1'}},
    b: {buildSettings: {IPHONEOS_DEPLOYMENT_TARGET: '"16.4"'}},
    c: {buildSettings: {}},
  });
  assert.equal(configurations.a.buildSettings.IPHONEOS_DEPLOYMENT_TARGET, '16.0');
  assert.equal(configurations.b.buildSettings.IPHONEOS_DEPLOYMENT_TARGET, '"16.4"');
});

test('Expo routes Tileflow artifacts exclusively to its Maven repository', () => {
  const gradle = `allprojects {\n  repositories {\n    google()\n    mavenCentral()\n  }\n}\n`;
  const settings = plugin.settings({}, {});
  const changed = plugin.projectBuildGradle(gradle);
  assert.ok(changed.startsWith(gradle));
  assert.match(changed, /exclusiveContent \{[\s\S]*includeGroup\('dev\.tileflow'\)/u);
  assert.match(changed, /gradleProperty\('tileflowMavenRepository'\)/u);
  assert.match(changed, /https:\/\/maven\.tileflow\.dev/u);
  assert.equal(plugin.projectBuildGradle(changed), changed);
  assert.deepEqual(plugin.gradleProperties([], settings), [
    {type: 'property', key: 'android.minSdkVersion', value: '26'},
  ]);
});

test('a candidate overrides the repository without keeping stale Gradle configuration', () => {
  const gradle = `allprojects {
  repositories {
    maven { url = uri("/stale/maven") } // Tileflow native candidate
    mavenCentral()
  }
}
`;
  const settings = plugin.settings(
    {android: {mavenRepository: '/candidate/maven', nativeVersion: '0.0.0-local.1'}},
    {},
  );
  const changed = plugin.projectBuildGradle(gradle);
  assert.doesNotMatch(changed, /stale|Tileflow native candidate/u);
  assert.match(changed, /mavenCentral\(\)/u);
  assert.equal(plugin.projectBuildGradle(changed), changed);

  const properties = plugin.gradleProperties([], settings);
  assert.deepEqual(
    properties.filter(({key}: {key: string}) => key.startsWith('tileflow')),
    [
      {type: 'property', key: 'tileflowMavenRepository', value: '/candidate/maven'},
      {type: 'property', key: 'tileflowNativeVersion', value: '0.0.0-local.1'},
    ],
  );
  assert.deepEqual(plugin.gradleProperties(properties, settings), properties);
  assert.deepEqual(plugin.gradleProperties(properties, plugin.settings({}, {})), [
    {type: 'property', key: 'android.minSdkVersion', value: '26'},
  ]);
});

test('Android apps target at least API 26', () => {
  const property = (properties: {key: string; value: string}[]) =>
    properties.find((item) => item.key === 'android.minSdkVersion')?.value;
  const settings = plugin.settings({}, {});
  assert.equal(property(plugin.gradleProperties([], settings)), '26');
  assert.equal(
    property(
      plugin.gradleProperties(
        [{type: 'property', key: 'android.minSdkVersion', value: '24'}],
        settings,
      ),
    ),
    '26',
  );
  assert.equal(
    property(
      plugin.gradleProperties(
        [{type: 'property', key: 'android.minSdkVersion', value: '28'}],
        settings,
      ),
    ),
    '28',
  );
});

test('nested plugin props cannot carry credentials into Expo app config', () => {
  for (const props of [
    {ios: {mapCredential: credential}},
    {android: {apiKey: credential}},
    {offline: {token: credential}},
    {ios: {swiftPackagePath: credential}},
    {android: {nativeVersion: credential}},
  ]) {
    assert.throws(() => plugin.settings(props, {}), /environment variables/u);
  }
  const props = {offline: {backgroundUpdates: true}, ios: {swiftPackagePath: '/native/swift'}};
  const before = JSON.stringify(props);
  plugin.settings(props, env);
  assert.equal(JSON.stringify(props), before);
  assert.equal(JSON.stringify(props).includes(credential), false);
});

test('native configuration migration removes the retired map admission arrays', () => {
  const config = plugin.settings({}, env);
  const plist = plugin.infoPlist({TileflowMobileConfiguration: ['credential=stale']}, config);
  assert.equal(plist.TileflowMobileConfiguration, undefined);
  assert.equal(plist.TileflowMapCredential, credential);
  const xml = plugin.stringsXml(
    {
      resources: {
        'string-array': [
          {$: {name: 'tileflow_mobile_configuration'}, item: ['credential=stale']},
          {$: {name: 'application_values'}, item: ['retained']},
        ],
      },
    },
    config,
  );
  assert.deepEqual(xml.resources['string-array'], [
    {$: {name: 'application_values'}, item: ['retained']},
  ]);
});

test('Podfile integration uses Tileflow after the React Native hook', () => {
  const source = `post_install do |installer|
  react_native_post_install(
    installer,
    config[:reactNativePath]
  )
  $MLRN.post_install(installer)
end
`;
  const result = plugin.podfile(source, plugin.settings({}, {}));
  assert.doesNotMatch(result, /\$MLRN/u);
  assert.equal(result.match(/tileflow_post_install\(installer\)/gu)?.length, 1);
  assert.equal(plugin.podfile(result, plugin.settings({}, {})), result);
});
