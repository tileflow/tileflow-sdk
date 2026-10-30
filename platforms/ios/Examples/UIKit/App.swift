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
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = MapViewController()
    window.makeKeyAndVisible()
    self.window = window
    return true
  }
}

@MainActor
final class MapViewController: UIViewController {
  private let map = TileflowMapView(source: exampleSource())
  private let status = UILabel()
  private var dark = false

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
    let controls = UIStackView(arrangedSubviews: [status, theme])
    controls.axis = .horizontal
    controls.distribution = .equalSpacing
    controls.backgroundColor = .systemBackground
    controls.isLayoutMarginsRelativeArrangement = true
    controls.directionalLayoutMargins = .init(top: 12, leading: 16, bottom: 12, trailing: 16)
    controls.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(controls)
    NSLayoutConstraint.activate([
      controls.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      controls.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      controls.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      map.topAnchor.constraint(equalTo: controls.bottomAnchor),
      map.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      map.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      map.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
    map.onEvent = { [weak self] event in
      switch event {
      case .contentReady: self?.status.text = "Tileflow · UIKit"
      case .failed(let error): self?.status.text = "Map error: \(error)"
      case .tap: self?.status.text = "Map selected"
      default: break
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
