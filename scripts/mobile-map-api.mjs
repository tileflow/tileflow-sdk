// Native hosts share method names, event payload classifications and public error types.
import {constantName, documentation} from './mobile-codegen.mjs';

const swiftLimit = (name) => name.replace(/Ms$/u, 'Milliseconds');
const kotlinLimit = (name) => constantName(name.replace(/Ms$/u, 'Millis'));
const lines = (values, render) => values.map(render).join('\n');
/** `33554432` → `33_554_432`, as swift-format groups literals of seven digits or more. */
const grouped = (value) =>
  String(value).length < 7 ? String(value) : String(value).replaceAll(/\B(?=(\d{3})+$)/gu, '_');
/** An error's public documentation, specialized for a platform where its guidance differs. */
const describe = (error, platform) => error.documentation?.[platform] ?? error.description;
const rendererErrors = (contract) =>
  Object.keys(contract.errors).filter((code) => contract.errors[code].sources.includes('renderer'));

function swiftContract(contract, banner) {
  const events = Object.keys(contract.events);
  return `${banner}
enum MapContract {
${lines(Object.entries(contract.limits), ([name, value]) => `  static let ${swiftLimit(name)} = ${grouped(value)}`)}

  enum Method: String {
${lines(contract.methods, (name) => `    case ${name}`)}
  }

  enum Event: String, CaseIterable {
${lines(events, (name) => `    case ${name}`)}

    /// The least detailed level that includes the event, or nil when it needs no subscription.
    var level: TileflowEventLevel? {
      switch self {
${lines(events, (name) => `      case .${name}: ${contract.events[name].level ? `.${contract.events[name].level}` : 'nil'}`)}
      }
    }
  }

  enum ErrorReason: String, CaseIterable {
${lines(Object.keys(contract.errorReasons), (name) => `    case ${name}`)}
  }

  /// Error codes that can originate in the renderer.
  static let rendererErrors: Set<String> = [
${lines(rendererErrors(contract), (code) => `    "${code}",`)}
  ]
}
`;
}

function swiftEnumeration(name, values) {
  return `public enum ${name}: String, CaseIterable, Sendable {
${lines(Object.entries(values), ([value, text]) => `${documentation(text, '  ', 'swift')}\n  case ${value}`)}
}`;
}

function swiftPublic(contract, banner) {
  const errors = Object.entries(contract.errors);
  return `${banner}
extension TileflowMapError {
  /// The error taxonomy the SDK shares with its renderer.
  public enum Code: String, CaseIterable, Sendable {
${lines(errors, ([code, error]) => `${documentation(describe(error, 'swift'), '    ', 'swift')}\n    case ${code}`)}

    /// Whether the same work can succeed later without the application changing anything: the
    /// condition passes, the SDK retries, or a reload starts again. Terminal codes need the
    /// application to change its request or configuration, or the account to change.
    public var isRecoverable: Bool {
      switch self {
${lines(errors, ([code, error]) => `      case .${code}: ${error.recoverable}`)}
      }
    }
  }

${lines(errors, ([code, error]) => `${documentation(describe(error, 'swift'), '  ', 'swift')}\n  public static let ${code} = TileflowMapError(.${code})`)}
}

/// How much the map reports. Each level includes the events of the levels before it; events beyond
/// the chosen level never leave the renderer.
${swiftEnumeration('TileflowEventLevel', contract.eventLevels).replace(
  /\n\}$/u,
  `

  /// Whether this level reports everything \`other\` reports.
  public func includes(_ other: TileflowEventLevel) -> Bool {
    Self.allCases.firstIndex(of: self)! >= Self.allCases.firstIndex(of: other)!
  }
}`,
)}

/// Who moved the camera.
${swiftEnumeration('TileflowCameraChangeReason', contract.cameraReasons)}

/// The kind of resource a warning or error concerns.
${swiftEnumeration('TileflowResourceKind', contract.resourceKinds)}
`;
}

function kotlinContract(contract, banner) {
  const events = Object.keys(contract.events);
  return `${banner}
package dev.tileflow.sdk.model

import dev.tileflow.sdk.TileflowEventLevel

internal object MapContract {
${lines(Object.entries(contract.limits), ([name, value]) => `    const val ${kotlinLimit(name)} = ${grouped(value)}${name.endsWith('Ms') ? 'L' : ''}`)}

    enum class Method(val wireName: String) {
${lines(contract.methods, (name) => `        ${constantName(name)}("${name}"),`)}
    }

    /**
     * [level] is the least detailed level that includes the event, or null when it needs no
     * subscription.
     */
    enum class Event(val wireName: String, val level: TileflowEventLevel?) {
${lines(events, (name) => `        ${constantName(name)}("${name}", ${contract.events[name].level ? `TileflowEventLevel.${constantName(contract.events[name].level)}` : 'null'}),`)}
    }

    enum class ErrorReason(val wireName: String) {
${lines(Object.keys(contract.errorReasons), (name) => `        ${constantName(name)}("${name}"),`)}
    }

    /** Error codes that can originate in the renderer. */
    val RENDERER_ERRORS: Set<String> =
        setOf(
${lines(rendererErrors(contract), (code) => `            "${code}",`)}
        )
}
`;
}

function kotlinEnumeration(name, values, summary) {
  return `${documentation(summary, '', 'kotlin')}
public enum class ${name}(internal val wireName: String) {
${lines(Object.entries(values), ([value, text]) => `${documentation(text, '    ', 'kotlin')}\n    ${constantName(value)}("${value}"),`)}
    ;

    internal companion object {
        fun fromWire(value: String?): ${name}? =
            entries.firstOrNull { it.wireName == value }
    }
}`;
}

function kotlinPublic(contract, banner) {
  return `${banner}
package dev.tileflow.sdk

/**
 * The error taxonomy the SDK shares with its renderer.
 *
 * [isRecoverable] tells whether the same work can succeed later without the application changing
 * anything: the condition passes, the SDK retries, or a reload starts again. Terminal codes need
 * the application to change its request or configuration, or the account to change.
 */
public enum class TileflowErrorCode(
    internal val wireName: String,
    public val isRecoverable: Boolean,
) {
${lines(Object.entries(contract.errors), ([code, error]) => `${documentation(describe(error, 'kotlin'), '    ', 'kotlin')}\n    ${constantName(code)}("${code}", ${error.recoverable}),`)}
    ;

    internal companion object {
        fun fromWire(value: String?): TileflowErrorCode? =
            entries.firstOrNull { it.wireName == value }
    }
}

${kotlinEnumeration(
  'TileflowEventLevel',
  contract.eventLevels,
  'How much the map reports. Each level includes the events of the levels before it; events beyond the chosen level never leave the renderer.',
).replace(
  '    internal companion object {',
  `    /** Whether this level reports everything [other] reports. */
    public fun includes(other: TileflowEventLevel): Boolean = ordinal >= other.ordinal

    internal companion object {`,
)}

${kotlinEnumeration('TileflowCameraChangeReason', contract.cameraReasons, 'Who moved the camera.')}

${kotlinEnumeration('TileflowResourceKind', contract.resourceKinds, 'The kind of resource a warning or error concerns.')}
`;
}

const identifier = /^[a-z][A-Za-z0-9]*$/u;
const integer = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;

/** Validate the vocabulary before generating either host. */
export function validateMapApi(contract) {
  const problems = [];
  const fail = (message) => problems.push(message);
  const limits = contract.limits ?? {};
  for (const name of [
    'maximumDataBytes',
    'maximumDataTotalBytes',
    'maximumDataReferences',
    'maximumTrackedPoints',
    'maximumAnnotationLayers',
    'maximumThrottleMs',
    'warningWindowMs',
  ]) {
    if (!integer(limits[name], 1)) fail(`limits.${name} must be a positive integer.`);
  }
  if (limits.maximumDataBytes > limits.maximumDataTotalBytes)
    fail('limits.maximumDataBytes cannot exceed limits.maximumDataTotalBytes.');
  const names = (label, values) => {
    if (!Array.isArray(values) || values.length === 0) fail(`${label} must be a non-empty list.`);
    else {
      if (new Set(values).size !== values.length) fail(`${label} has duplicates.`);
      for (const value of values)
        if (typeof value !== 'string' || !identifier.test(value)) fail(`${label}: ${value}`);
    }
    return Array.isArray(values) ? values : [];
  };
  const described = (label, value) => {
    const keys = names(label, Object.keys(value ?? {}));
    for (const key of keys)
      if (typeof value[key] !== 'string' || !value[key].endsWith('.'))
        fail(`${label}.${key} needs a sentence of description.`);
    return keys;
  };
  const methods = names('methods', contract.methods);
  for (const required of ['initialize', 'setEvents', 'dispose'])
    if (!methods.includes(required)) fail(`methods must include ${required}.`);
  const levels = described('eventLevels', contract.eventLevels);
  const events = names('events', Object.keys(contract.events ?? {}));
  for (const name of events) {
    const event = contract.events[name];
    if (!event || typeof event !== 'object') {
      fail(`events.${name} needs an event definition.`);
      continue;
    }
    const keys = Object.keys(event).sort().join(',');
    if (keys === 'delivery') {
      if (event.delivery !== 'always') fail(`events.${name}.delivery must be "always".`);
    } else if (keys !== 'level' || !levels.includes(event.level)) {
      fail(`events.${name} needs one level from eventLevels, or delivery "always".`);
    }
  }
  if (contract.events?.error?.delivery !== 'always')
    fail('events.error must be delivered without a subscription.');
  for (const level of levels)
    if (!events.some((name) => contract.events[name]?.level === level))
      fail(`eventLevels.${level} has no events.`);
  described('cameraReasons', contract.cameraReasons);
  described('resourceKinds', contract.resourceKinds);
  described('errorReasons', contract.errorReasons);
  const errors = names('errors', Object.keys(contract.errors ?? {}));
  for (const code of errors) {
    const error = contract.errors[code];
    if (typeof error.recoverable !== 'boolean')
      fail(`errors.${code}.recoverable must be a boolean.`);
    if (
      !Array.isArray(error.sources) ||
      error.sources.length === 0 ||
      error.sources.some((source) => !['host', 'renderer'].includes(source))
    )
      fail(`errors.${code}.sources must name host, renderer or both.`);
    if (typeof error.description !== 'string' || !error.description.endsWith('.'))
      fail(`errors.${code} needs a sentence of description.`);
    for (const [platform, text] of Object.entries(error.documentation ?? {}))
      if (
        !['swift', 'kotlin'].includes(platform) ||
        typeof text !== 'string' ||
        !text.endsWith('.')
      )
        fail(`errors.${code}.documentation.${platform} must be a sentence for swift or kotlin.`);
  }
  for (const required of ['invalidRequest', 'unsupportedDevice', 'cancelled', 'disposed'])
    if (!contract.errors?.[required]?.sources?.includes('renderer'))
      fail(`errors.${required} must be available to the renderer.`);
  return problems;
}

const banner =
  '// Generated by scripts/mobile-map-api-generate.mjs. Edit platforms/map-api.json, then regenerate.\n';

export function renderMapApi(contract) {
  const problems = validateMapApi(contract);
  if (problems.length) throw new Error(`Invalid map-api.json:\n${problems.join('\n')}`);
  return {
    'platforms/ios/Sources/Tileflow/Model/MapContract.swift': swiftContract(contract, banner),
    'platforms/ios/Sources/Tileflow/MapTypes.swift': swiftPublic(contract, banner),
    'platforms/android/tileflow/src/main/java/dev/tileflow/sdk/model/MapContract.kt':
      kotlinContract(contract, banner),
    'platforms/android/tileflow/src/main/java/dev/tileflow/sdk/MapTypes.kt': kotlinPublic(
      contract,
      banner,
    ),
  };
}
