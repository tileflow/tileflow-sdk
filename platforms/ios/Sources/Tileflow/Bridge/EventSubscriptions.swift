import Foundation

/// The events the renderer sends: the union of what each owner asks for. An event shared by several
/// owners takes the shortest interval any of them asks for. Events nobody asks for never leave the
/// renderer.
struct EventSubscriptions: Equatable {
  /// Parts of the SDK that ask for events. The application's choice is one owner among them.
  enum Owner: Hashable {
    case application
    /// The camera state follows every movement, so `isMoving` is current at any level.
    case camera
    /// The compass and scale bar follow the camera while it moves.
    case controls
    /// Annotation layers and the points that native views and accessibility elements follow.
    case annotations
  }

  private var demands: [Owner: [ProtocolContract.Event: Int]] = [:]

  init(application options: TileflowEventOptions = .init(), followCamera: Bool = false) {
    set(.application, Self.demand(for: options))
    // The follow mode ends when a person moves the map, whatever the application's level.
    set(.camera, [.cameraMoveStarted: 0, .cameraMoveEnded: 0, .followModeChanged: 0])
    set(.controls, followCamera ? [.cameraMoved: 0] : [:])
  }

  mutating func set(_ owner: Owner, _ demand: [ProtocolContract.Event: Int]) {
    demands[owner] = demand.filter { $0.key.level != nil }
  }

  /// Every event up to the chosen level; camera updates take the chosen interval.
  static func demand(for options: TileflowEventOptions) -> [ProtocolContract.Event: Int] {
    var demand: [ProtocolContract.Event: Int] = [:]
    for event in ProtocolContract.Event.allCases {
      guard let level = event.level, options.level.includes(level) else { continue }
      demand[event] =
        event == .cameraMoved ? Int((options.cameraUpdateInterval * 1000).rounded()) : 0
    }
    return demand
  }

  var events: [ProtocolContract.Event: Int] {
    demands.values.reduce(into: [:]) { union, demand in
      union.merge(demand) { min($0, $1) }
    }
  }

  var wireValue: JSONValue {
    .object(
      Dictionary(
        uniqueKeysWithValues: events.map { event, throttle in
          (event.rawValue, JSONValue.object(["throttleMs": .number(Double(throttle))]))
        }))
  }
}
