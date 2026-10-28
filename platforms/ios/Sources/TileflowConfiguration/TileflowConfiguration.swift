import Foundation

/// Process-wide Tileflow configuration.
///
/// By default every Tileflow client reads the application's Info.plist once, on first use.
/// Applications that receive their configuration at runtime call ``configure(_:)`` before they
/// use a client; the explicit configuration then replaces the Info.plist values for the process.
public enum Tileflow {
  /// Replaces the Info.plist configuration for the rest of the process.
  public static func configure(_ configuration: TileflowConfiguration) {
    ConfigurationStore.shared.set(configuration)
  }

  /// The explicit configuration, or the one in the application's Info.plist.
  public static func configuration() throws -> TileflowConfiguration {
    try ConfigurationStore.shared.current()
  }

  /// Returns to the Info.plist configuration. Test targets of this package use it.
  package static func resetConfiguration() { ConfigurationStore.shared.reset() }
}

/// The Tileflow services an application can call.
public enum TileflowService: String, Sendable, CaseIterable {
  case search
  case routing
  case elevation
  case geoIP = "geoip"
}

public enum TileflowConfigurationError: Error, Equatable, Sendable {
  /// The API origin is not an HTTPS origin, or an HTTP one on `localhost` or `127.0.0.1`.
  case invalidAPIOrigin
  /// A credential is not a publishable `tf_public_` credential.
  case invalidCredential
  /// An app identity is not a bundle ID or package name, or its certificate is not a SHA-256.
  case invalidAppIdentity
  /// An Info.plist value is not a String or is invalid.
  case invalidValue(key: String)
}

/// Where Tileflow clients send requests and which publishable credentials they use.
///
/// Search, Routing and Elevation each use their own credential when one is set, and the shared
/// services credential otherwise. The map credential authorizes only Hosted map delivery: it is
/// never used for a service, and a services credential is never used for the map. GeoIP is
/// anonymous and uses no credential.
public struct TileflowConfiguration: Sendable, Equatable, CustomStringConvertible,
  CustomDebugStringConvertible
{
  public static let defaultAPIOrigin = URL(string: "https://api.tileflow.dev")!

  /// Info.plist keys. All values are Strings.
  public enum InfoPlistKey {
    public static let apiOrigin = "TileflowAPIOrigin"
    public static let servicesCredential = "TileflowServicesCredential"
    public static let searchCredential = "TileflowSearchCredential"
    public static let routingCredential = "TileflowRoutingCredential"
    public static let elevationCredential = "TileflowElevationCredential"
    public static let mapCredential = "TileflowMapCredential"
  }

  /// The normalized API origin, without a trailing slash.
  public let apiOrigin: URL
  public var servicesCredential: TileflowCredential?
  public var searchCredential: TileflowCredential?
  public var routingCredential: TileflowCredential?
  public var elevationCredential: TileflowCredential?
  /// The Hosted map's mobile credential. Services never read it.
  public var mapCredential: TileflowCredential?
  /// The app identity sent with service requests. Nil uses the main bundle's identifier.
  public var app: TileflowAppIdentity?

  public init(
    apiOrigin: URL = defaultAPIOrigin,
    servicesCredential: TileflowCredential? = nil,
    searchCredential: TileflowCredential? = nil,
    routingCredential: TileflowCredential? = nil,
    elevationCredential: TileflowCredential? = nil,
    mapCredential: TileflowCredential? = nil,
    app: TileflowAppIdentity? = nil
  ) throws {
    guard let origin = Self.normalizedOrigin(apiOrigin.absoluteString) else {
      throw TileflowConfigurationError.invalidAPIOrigin
    }
    self.apiOrigin = origin
    self.servicesCredential = servicesCredential
    self.searchCredential = searchCredential
    self.routingCredential = routingCredential
    self.elevationCredential = elevationCredential
    self.mapCredential = mapCredential
    self.app = app
  }

  /// Reads the configuration from an Info.plist. Absent and blank keys stay unset, so a build
  /// setting that substitutes nothing leaves a key unset; any other invalid value fails the whole
  /// configuration.
  public static func infoPlist(_ bundle: Bundle = .main) throws -> TileflowConfiguration {
    // Read the unlocalized dictionary: InfoPlist.strings must not replace a credential.
    let info = bundle.infoDictionary ?? [:]
    func string(_ key: String) throws -> String? {
      guard let value = info[key] else { return nil }
      guard let text = value as? String else {
        throw TileflowConfigurationError.invalidValue(key: key)
      }
      return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : text
    }
    func credential(_ key: String) throws -> TileflowCredential? {
      guard let text = try string(key) else { return nil }
      guard let credential = try? TileflowCredential(text) else {
        throw TileflowConfigurationError.invalidValue(key: key)
      }
      return credential
    }
    var origin = defaultAPIOrigin
    if let text = try string(InfoPlistKey.apiOrigin) {
      guard let url = normalizedOrigin(text) else {
        throw TileflowConfigurationError.invalidValue(key: InfoPlistKey.apiOrigin)
      }
      origin = url
    }
    return try TileflowConfiguration(
      apiOrigin: origin,
      servicesCredential: credential(InfoPlistKey.servicesCredential),
      searchCredential: credential(InfoPlistKey.searchCredential),
      routingCredential: credential(InfoPlistKey.routingCredential),
      elevationCredential: credential(InfoPlistKey.elevationCredential),
      mapCredential: credential(InfoPlistKey.mapCredential))
  }

  /// The credential a service uses: its own, or the shared services credential. Nil for GeoIP.
  public func credential(for service: TileflowService) -> TileflowCredential? {
    switch service {
    case .search: searchCredential ?? servicesCredential
    case .routing: routingCredential ?? servicesCredential
    case .elevation: elevationCredential ?? servicesCredential
    case .geoIP: nil
    }
  }

  public var description: String { "TileflowConfiguration(apiOrigin: \(apiOrigin.absoluteString))" }
  public var debugDescription: String { description }

  /// An HTTPS origin, or HTTP on `localhost` or `127.0.0.1`, with at most a root path.
  static func normalizedOrigin(_ value: String) -> URL? {
    guard value.utf8.count <= 2048, let components = URLComponents(string: value),
      let scheme = components.scheme?.lowercased(), let host = components.host?.lowercased(),
      !host.isEmpty, components.user == nil, components.password == nil,
      components.query == nil, components.fragment == nil,
      components.path.isEmpty || components.path == "/"
    else { return nil }
    let loopback = host == "localhost" || host == "127.0.0.1"
    guard scheme == "https" || (scheme == "http" && loopback) else { return nil }
    guard host.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "." || $0 == "-") })
    else { return nil }
    var normalized = URLComponents()
    normalized.scheme = scheme
    normalized.host = host
    if let port = components.port {
      guard (1...65535).contains(port) else { return nil }
      if !(scheme == "https" && port == 443) && !(scheme == "http" && port == 80) {
        normalized.port = port
      }
    }
    return normalized.url
  }
}

/// A publishable Tileflow credential: `tf_public_` followed by 48 lowercase hexadecimal digits.
///
/// Publishable credentials are meant to ship inside applications and are restricted to the apps
/// listed for them. Server credentials must never be embedded in an application, so they are
/// rejected here. The value is never included in descriptions, reflection or errors.
public struct TileflowCredential: Sendable, Hashable, CustomStringConvertible,
  CustomDebugStringConvertible, CustomReflectable
{
  package let value: String

  public init(_ value: String) throws {
    guard value.utf8.count == 58, value.hasPrefix("tf_public_"),
      value.utf8.dropFirst(10).allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
    else { throw TileflowConfigurationError.invalidCredential }
    self.value = value
  }

  public var description: String { "TileflowCredential(tf_public_…)" }
  public var debugDescription: String { description }
  public var customMirror: Mirror { Mirror(self, children: [:]) }
}

/// The application a publishable credential admits: an iOS bundle identifier, or an Android
/// package name with the SHA-256 fingerprint of its signing certificate.
public struct TileflowAppIdentity: Sendable, Hashable {
  public let id: String
  /// 64 lowercase hexadecimal digits, or nil for an iOS app.
  public let certificateSHA256: String?

  public init(id: String, certificateSHA256: String? = nil) throws {
    guard Self.isValidID(id) else { throw TileflowConfigurationError.invalidAppIdentity }
    var certificate: String?
    if let value = certificateSHA256 {
      let digits = value.replacingOccurrences(of: ":", with: "").lowercased()
      guard digits.utf8.count == 64,
        digits.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
      else { throw TileflowConfigurationError.invalidAppIdentity }
      certificate = digits
    }
    self.id = id
    self.certificateSHA256 = certificate
  }

  /// The main bundle's identifier, when it has a valid one.
  public static var current: TileflowAppIdentity? {
    Bundle.main.bundleIdentifier.flatMap { try? TileflowAppIdentity(id: $0) }
  }

  static func isValidID(_ id: String) -> Bool {
    guard (1...255).contains(id.utf8.count), let first = id.unicodeScalars.first,
      first.isASCII, CharacterSet.letters.contains(first)
    else { return false }
    let parts = id.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count >= 2 else { return false }
    return parts.allSatisfy { part in
      !part.isEmpty
        && part.unicodeScalars.allSatisfy {
          $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-")
        }
    }
  }
}

final class ConfigurationStore: @unchecked Sendable {
  static let shared = ConfigurationStore()
  private let lock = NSLock()
  private var explicit: TileflowConfiguration?
  private var native: Result<TileflowConfiguration, TileflowConfigurationError>?

  func set(_ configuration: TileflowConfiguration) {
    lock.withLock { explicit = configuration }
  }

  func reset() {
    lock.withLock {
      explicit = nil
      native = nil
    }
  }

  func current() throws -> TileflowConfiguration {
    try lock.withLock {
      if let explicit { return explicit }
      if native == nil {
        do {
          native = .success(try TileflowConfiguration.infoPlist())
        } catch let error as TileflowConfigurationError {
          native = .failure(error)
        } catch {
          native = .failure(.invalidAPIOrigin)
        }
      }
      return try native!.get()
    }
  }
}
