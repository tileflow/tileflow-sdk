import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Cocoa setters differing from the style-spec spelling. Matches MapLibre Native's Darwin
// style-spec-cocoa-conventions-v8.json at ios-v7.0.0; Objective-C boolean getters use "is".
const cocoaAliases = {
  'circle-pitch-scale': 'circleScaleAlignment',
  'circle-translate': 'circleTranslation',
  'circle-translate-anchor': 'circleTranslationAnchor',
  'fill-antialias': 'fillAntialiased',
  'fill-extrusion-translate': 'fillExtrusionTranslation',
  'fill-extrusion-translate-anchor': 'fillExtrusionTranslationAnchor',
  'fill-extrusion-vertical-gradient': 'fillExtrusionHasVerticalGradient',
  'fill-translate': 'fillTranslation',
  'fill-translate-anchor': 'fillTranslationAnchor',
  'icon-allow-overlap': 'iconAllowsOverlap',
  'icon-ignore-placement': 'iconIgnoresPlacement',
  'icon-image': 'iconImageName',
  'icon-keep-upright': 'keepsIconUpright',
  'icon-optional': 'iconOptional',
  'icon-rotate': 'iconRotation',
  'icon-size': 'iconScale',
  'icon-translate': 'iconTranslation',
  'icon-translate-anchor': 'iconTranslationAnchor',
  'line-dasharray': 'lineDashPattern',
  'line-translate': 'lineTranslation',
  'line-translate-anchor': 'lineTranslationAnchor',
  'raster-brightness-max': 'maximumRasterBrightness',
  'raster-brightness-min': 'minimumRasterBrightness',
  'raster-hue-rotate': 'rasterHueRotation',
  'raster-resampling': 'rasterResamplingMode',
  'symbol-avoid-edges': 'symbolAvoidsEdges',
  'text-allow-overlap': 'textAllowsOverlap',
  'text-field': 'text',
  'text-font': 'textFontNames',
  'text-ignore-placement': 'textIgnoresPlacement',
  'text-justify': 'textJustification',
  'text-keep-upright': 'keepsTextUpright',
  'text-max-angle': 'maximumTextAngle',
  'text-max-width': 'maximumTextWidth',
  'text-optional': 'textOptional',
  'text-rotate': 'textRotation',
  'text-size': 'textFontSize',
  'text-translate': 'textTranslation',
  'text-translate-anchor': 'textTranslationAnchor',
  'text-writing-mode': 'textWritingModes',
  visibility: 'visibilityExpression',
};

export async function readNativeStylePins(root) {
  const [swift, gradle] = await Promise.all([
    readFile(resolve(root, 'platforms/ios/Package.swift'), 'utf8'),
    readFile(resolve(root, 'platforms/android/tileflow/build.gradle.kts'), 'utf8'),
  ]);
  const ios = /maplibre-gl-native-distribution", exact: "([\d.]+)"/u.exec(swift)?.[1];
  const android = /org\.maplibre\.gl:android-sdk-opengl:([\d.]+)"/u.exec(gradle)?.[1];
  if (!ios || !android)
    throw new Error('Expected exact MapLibre Native versions on both platforms.');
  return {ios, android};
}

/** Style Spec issue URLs denote a pending implementation; only released versions count. */
function available(since, pin) {
  if (since === 'supported') return true;
  if (typeof since !== 'string' || !/^\d+\.\d+\.\d+$/u.test(since)) return false;
  const required = since.split('.').map(Number);
  const actual = pin.split('.').map(Number);
  for (let i = 0; i < required.length; i++) {
    if (actual[i] !== required[i]) return actual[i] > required[i];
  }
  return true;
}

export function nativePropertyNote(spec, platform, pin) {
  const support = spec['sdk-support'];
  if (!available(support?.['basic functionality']?.[platform], pin))
    return ' The native renderer rejects this property.';
  if (
    spec.expression?.parameters?.includes('feature') &&
    !available(support?.['data-driven styling']?.[platform], pin)
  )
    return ' The native renderer rejects expressions that read feature data for this property.';
  return '';
}

export function nativePropertyRecords(layers, platform, pin) {
  const records = [];
  for (const layer of layers) {
    for (const {kind: group, name, identifier, property: spec} of layer.properties) {
      const support = spec['sdk-support'];
      if (!available(support?.['basic functionality']?.[platform], pin)) continue;
      const values = Object.entries(spec.values ?? {})
        .filter(([, entry]) => {
          const basic = entry['sdk-support']?.['basic functionality'];
          return !basic || available(basic[platform], pin);
        })
        .map(([value]) => value);
      records.push({
        key: [layer.type, group, name].join('/'),
        kind: spec.type,
        ...(platform === 'ios' && {cocoaKey: cocoaAliases[name] ?? identifier}),
        elementKind: spec.value,
        length: spec.length,
        minimum: spec.minimum,
        maximum: spec.maximum,
        values,
        expressions: !!spec.expression,
        dataDriven: available(support?.['data-driven styling']?.[platform], pin),
        transition: spec.transition === true,
      });
    }
  }
  return records;
}

function argumentsFor(record, swift) {
  const args = [];
  for (const [name, value] of Object.entries(record)) {
    if (name === 'key' || value === undefined || value === false) continue;
    let literal = JSON.stringify(value);
    if (Array.isArray(value)) {
      if (!value.length) continue;
      const items = value.map((item) => JSON.stringify(item)).join(', ');
      literal = swift ? `[${items}]` : `setOf(${items})`;
    }
    if (!swift && (name === 'minimum' || name === 'maximum') && Number.isInteger(value))
      literal += '.0';
    args.push(name + (swift ? ': ' : ' = ') + literal);
  }
  return args.join(', ');
}

export function nativePropertyTable(layers, expressions, platform, pin, banner) {
  const swift = platform === 'ios';
  const operators = Object.keys(expressions).map((name) => JSON.stringify(name));
  const operatorLines = [];
  for (let i = 0; i < operators.length; i += 6)
    operatorLines.push(operators.slice(i, i + 6).join(', '));
  const cases = nativePropertyRecords(layers, platform, pin).map((record) => {
    const key = JSON.stringify(record.key);
    const args = argumentsFor(record, swift);
    return swift
      ? `    case ${key}: return .init(${args})`
      : `            ${key} -> NativeStyleProperty(${args})`;
  });
  if (swift)
    return (
      banner +
      `
struct NativeStyleProperty {
  let kind: String
  let cocoaKey: String
  var elementKind: String? = nil
  var length: Int? = nil
  var minimum: Double? = nil
  var maximum: Double? = nil
  var values: Set<String> = []
  var expressions = false
  var dataDriven = false
  var transition = false
}

enum NativeStyleSpecification {
  private static let operators: Set<String> = [
    ${operatorLines.join(',\n    ')},
  ]

  static func isExpressionOperator(name: String) -> Bool { operators.contains(name) }

  static func property(layer: String, group: String, name: String) -> NativeStyleProperty? {
    switch "\\(layer)/\\(group)/\\(name)" {
${cases.join('\n')}
    default: return nil
    }
  }
}
`
    );
  return (
    banner +
    `
package dev.tileflow.sdk

internal data class NativeStyleProperty(
    val kind: String,
    val elementKind: String? = null,
    val length: Int? = null,
    val minimum: Double? = null,
    val maximum: Double? = null,
    val values: Set<String> = emptySet(),
    val expressions: Boolean = false,
    val dataDriven: Boolean = false,
    val transition: Boolean = false,
)

internal object NativeStyleSpecification {
    private val operators = setOf(
        ${operatorLines.join(',\n        ')},
    )

    fun isExpressionOperator(name: String): Boolean = name in operators

    fun property(layer: String, group: String, name: String): NativeStyleProperty? =
        when ("$layer/$group/$name") {
${cases.join('\n')}
            else -> null
        }
}
`
  );
}
