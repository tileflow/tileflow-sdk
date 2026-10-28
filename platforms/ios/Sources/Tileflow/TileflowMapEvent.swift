import Foundation

public enum TileflowMapEvent: Sendable {
  /// A user activated an attribution link. The application decides how to present it.
  case externalLinkRequested(URL)
  case annotationActivated(id: String, coordinate: TileflowCoordinate)
  case poiActivated(TileflowPoiSelection)
  case loading
  /// The renderer emitted its initial load event; this is not a native compositor frame receipt.
  case contentReady
  /// The camera started to move, moved or settled. Which of these arrive depends on
  /// ``TileflowMapOptions/events``; the settled camera always does.
  case cameraChanged(TileflowCameraChange)
  case tap(longitude: Double, latitude: Double)
  case themeChanged(String)
  /// The map continues, but something it tried did not work, for example tiles that failed to
  /// load. Repeats of one warning within a second arrive together with their count.
  case warning(TileflowMapWarning)
  /// The map stopped loading or its renderer failed. ``TileflowMapError/isRecoverable`` tells
  /// whether ``TileflowMapView/reload()`` can succeed without other changes.
  case failed(TileflowMapError)
}

public enum TileflowCameraChangePhase: String, Sendable {
  case started, moving, ended
}

public struct TileflowCameraChange: Equatable, Sendable {
  public let camera: TileflowCamera
  public let reason: TileflowCameraChangeReason
  public let phase: TileflowCameraChangePhase

  public init(
    camera: TileflowCamera, reason: TileflowCameraChangeReason, phase: TileflowCameraChangePhase
  ) {
    self.camera = camera
    self.reason = reason
    self.phase = phase
  }

  /// Whether the camera has settled.
  public var isFinal: Bool { phase == .ended }
}

public struct TileflowMapWarning: Sendable, CustomStringConvertible {
  public let error: TileflowMapError
  /// How many times this warning occurred since it was last reported.
  public let occurrences: Int

  public init(error: TileflowMapError, occurrences: Int) {
    self.error = error
    self.occurrences = occurrences
  }

  public var description: String { "\(error) × \(occurrences)" }
}
