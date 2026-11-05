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
const runtimeErrors = (contract) =>
  Object.keys(contract.errors).filter((code) => contract.errors[code].sources.includes('runtime'));

function swiftContract(contract, banner) {
  const events = Object.keys(contract.events);
  return `${banner}
enum ProtocolContract {
  static let version = ${contract.version}
  static let minimumVersion = ${contract.minimumVersion}
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

  /// Error codes the renderer may send. Any other code from the renderer is a protocol fault.
  static let runtimeErrors: Set<String> = [
${lines(runtimeErrors(contract), (code) => `    "${code}",`)}
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
package dev.tileflow.sdk.bridge

import dev.tileflow.sdk.TileflowEventLevel

internal object ProtocolContract {
    const val VERSION = ${contract.version}
    const val MINIMUM_VERSION = ${contract.minimumVersion}
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

    /** Error codes the renderer may send. Any other code from the renderer is a protocol fault. */
    val RUNTIME_ERRORS: Set<String> =
        setOf(
${lines(runtimeErrors(contract), (code) => `            "${code}",`)}
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

export function renderMapApi(contract, banner) {
  return {
    'platforms/ios/Sources/Tileflow/Bridge/ProtocolContract.swift': swiftContract(contract, banner),
    'platforms/ios/Sources/Tileflow/ProtocolTypes.swift': swiftPublic(contract, banner),
    'platforms/android/tileflow/src/main/java/dev/tileflow/sdk/bridge/ProtocolContract.kt':
      kotlinContract(contract, banner),
    'platforms/android/tileflow/src/main/java/dev/tileflow/sdk/ProtocolTypes.kt':
      kotlinPublic(contract, banner),
  };
}
