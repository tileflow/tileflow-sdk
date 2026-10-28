import Foundation
import Metal

/// A coarse class of the device's graphics hardware.
public enum TileflowGPUClass: String, Codable, Sendable {
  /// Apple GPU family 5 or older (A12 and earlier).
  case low
  /// Apple GPU families 6 and 7 (A13, A14 and M1).
  case standard
  /// Apple GPU family 8 or newer (A15, M2 and later).
  case high
}

/// What the SDK assumes about the device when an application does not say otherwise: the
/// rendering quality new maps use, which caps their pixel ratio, and the size of the shared
/// resource cache.
///
/// ``current`` starts as ``detected()``. Assign it before creating maps to override any value;
/// maps created afterwards and the cache budget follow it. An explicit
/// ``TileflowMapOptions/quality`` still wins for its map.
public struct TileflowDeviceProfile: Equatable, Sendable {
  public var physicalMemory: UInt64
  /// Whether the device has less memory than the SDK's comfortable minimum, 3 GB.
  public var isLowMemoryDevice: Bool
  public var gpuClass: TileflowGPUClass
  /// The default rendering quality of new maps.
  public var quality: TileflowQuality
  /// The bytes the shared resource cache may keep on disk.
  public var cacheBytes: Int64

  public init(
    physicalMemory: UInt64, isLowMemoryDevice: Bool, gpuClass: TileflowGPUClass,
    quality: TileflowQuality, cacheBytes: Int64
  ) {
    self.physicalMemory = physicalMemory
    self.isLowMemoryDevice = isLowMemoryDevice
    self.gpuClass = gpuClass
    self.quality = quality
    self.cacheBytes = cacheBytes
  }

  /// The profile the SDK recommends for this device's memory and graphics hardware.
  public static func detected() -> TileflowDeviceProfile {
    recommended(
      physicalMemory: ProcessInfo.processInfo.physicalMemory, gpuClass: detectedGPUClass())
  }

  /// The profile new maps and the resource cache use. Starts as ``detected()``.
  public static var current: TileflowDeviceProfile {
    get { storage.withLock { $0 } }
    set {
      storage.withLock { $0 = newValue }
      ResourceCacheStore.shared.maximumBytes = newValue.cacheBytes
    }
  }

  private static let storage = LockedValue(detected())

  static func recommended(physicalMemory: UInt64, gpuClass: TileflowGPUClass)
    -> TileflowDeviceProfile
  {
    let gigabyte: UInt64 = 1 << 30
    let lowMemory = physicalMemory < 3 * gigabyte
    let quality: TileflowQuality =
      lowMemory || gpuClass == .low
      ? .low : physicalMemory >= 8 * gigabyte && gpuClass == .high ? .high : .balanced
    let cacheBytes: Int64 =
      lowMemory ? 64 << 20 : physicalMemory >= 6 * gigabyte ? 512 << 20 : 256 << 20
    return TileflowDeviceProfile(
      physicalMemory: physicalMemory, isLowMemoryDevice: lowMemory, gpuClass: gpuClass,
      quality: quality, cacheBytes: cacheBytes)
  }

  private static func detectedGPUClass() -> TileflowGPUClass {
    guard let device = MTLCreateSystemDefaultDevice() else { return .low }
    if device.supportsFamily(.apple8) { return .high }
    if device.supportsFamily(.apple6) { return .standard }
    return .low
  }
}

/// A value shared across threads behind a lock.
final class LockedValue<Value: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Value

  init(_ value: Value) { self.value = value }

  func withLock<Result>(_ body: (inout Value) throws -> Result) rethrows -> Result {
    lock.lock()
    defer { lock.unlock() }
    return try body(&value)
  }
}
