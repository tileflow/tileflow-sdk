import Tileflow
import UIKit

@main
@MainActor
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    configureExample()
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = MapViewController()
    window.makeKeyAndVisible()
    self.window = window
    return true
  }
}

/// A map under a bottom panel whose height is the map's bottom content inset, so the camera
/// centres on the visible map and its controls stay above the panel.
@MainActor
final class MapViewController: UIViewController {
  private static let start = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 13)
  private let map = TileflowMapView(
    source: exampleSource(), initialCamera: MapViewController.start,
    options: .init(controls: .init(scaleBar: true, recenterButton: true)))
  private let status = UILabel()
  private let panel = UIStackView()
  private var panelHeight: NSLayoutConstraint?
  private var dark = false
  private var expanded = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    map.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(map)
    status.text = "Loading Tileflow…"
    status.textColor = .label
    let theme = UIButton(type: .system)
    theme.setTitle("Change theme", for: .normal)
    theme.addTarget(self, action: #selector(changeTheme), for: .touchUpInside)
    let myLocation = UIButton(type: .system)
    myLocation.setTitle("My location", for: .normal)
    myLocation.addTarget(self, action: #selector(showMyLocation), for: .touchUpInside)
    let more = UIButton(type: .system)
    more.setTitle("Show more", for: .normal)
    more.addAction(
      UIAction { [weak self, weak more] _ in
        guard let self else { return }
        self.expanded.toggle()
        more?.setTitle(self.expanded ? "Show less" : "Show more", for: .normal)
        self.layoutPanel(animated: true)
      }, for: .touchUpInside)
    let places = UIButton(type: .system)
    places.setTitle("Show 100,000 places", for: .normal)
    places.addAction(
      UIAction { [weak self] _ in
        guard let self else { return }
        Task {
          do {
            try await ClusterExample.show(on: self.map, around: TileflowCoordinate(longitude: Self.start.longitude, latitude: Self.start.latitude))
            _ = try await self.map.ease(to: TileflowCameraUpdate(zoom: 10))
            self.status.text = "Tap a cluster to zoom in"
          } catch {
            self.status.text = "Places unavailable"
          }
        }
      }, for: .touchUpInside)
    [status, theme, myLocation, places, more].forEach(panel.addArrangedSubview)
    panel.axis = .vertical
    panel.alignment = .leading
    panel.spacing = 8
    panel.backgroundColor = .secondarySystemBackground
    panel.layer.cornerRadius = 16
    panel.isLayoutMarginsRelativeArrangement = true
    panel.directionalLayoutMargins = .init(top: 16, leading: 16, bottom: 16, trailing: 16)
    panel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(panel)
    let height = panel.heightAnchor.constraint(equalToConstant: 168)
    panelHeight = height
    NSLayoutConstraint.activate([
      // The map fills the screen; its automatic insets keep controls clear of the system bars.
      map.topAnchor.constraint(equalTo: view.topAnchor),
      map.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      map.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      map.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      panel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      panel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      height,
    ])
    layoutPanel(animated: false)
    map.locationProvider = exampleLocationProvider()
    map.onEvent = { [weak self] event in
      guard let self else { return }
      switch event {
      case .contentReady: self.status.text = "Tileflow · UIKit"
      case .failed(let error): self.status.text = "Map error: \(error)"
      case .tap(let touch):
        Task {
          let selected = try? await ClusterExample.tap(at: touch.point, on: self.map)
          self.status.text = selected ?? "Map selected"
        }
      case .recenterRequested:
        Task { try? await self.map.fly(to: Self.start) }
      case .followModeChanged(let change):
        self.status.text = change.mode == .none ? "Moved away from your location" : "Following you"
      default: break
      }
    }
  }

  private func layoutPanel(animated: Bool) {
    let height: CGFloat = expanded ? 336 : 168
    panelHeight?.constant = height
    // The panel covers the bottom of the map: the camera and controls keep clear of it.
    map.contentInsets.bottom = height
    if animated { UIView.animate(withDuration: 0.25) { self.view.layoutIfNeeded() } }
  }

  /// Asks for the location, shows it with the device's heading and follows it. The recenter button
  /// follows it again after the map is moved, and turns between following and following the
  /// heading.
  @objc private func showMyLocation() {
    Task {
      guard await requestLocationAccess() else {
        status.text = "Location access is off"
        return
      }
      var options = map.options
      options.location = TileflowLocationOptions(enabled: true, puckBearing: .heading)
      do {
        try await map.setOptions(options)
        map.followMode = .position
      } catch {
        status.text = "Location unavailable"
      }
    }
  }

  @objc private func changeTheme() {
    dark.toggle()
    Task {
      do { try await map.setTheme(dark ? "dark" : "light") } catch {
        status.text = "Theme unavailable"
      }
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isBeingDismissed || isMovingFromParent { map.destroy() }
  }
}
