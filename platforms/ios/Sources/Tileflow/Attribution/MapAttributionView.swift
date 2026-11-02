import UIKit

/// The map's attribution control, drawn by the SDK over MapLibre Native, whose own attribution
/// button and logo stay hidden.
///
/// It is always shown while the map has something to credit, in the corner the map's options
/// choose, inside the content insets. Compact, it is one line: a button and the credits that read
/// as a line (the sources' credits, the downloaded sources' pages, the style's notices and World's
/// fair-use notice), truncated in the middle so the first credit and the last notice stay legible.
/// The button opens every entry in full, in order, with its links. VoiceOver reads the full text
/// of every entry from the compact control, and offers each link as an action. Links never open by
/// themselves: they reach the map view, which reports `externalLinkRequested`.
///
/// The view covers the map and claims touches only on the control and its open list.
@MainActor
final class MapAttributionView: UIView, UITextViewDelegate {
  /// The compact control's height. It fits the space the map's other controls leave free for it
  /// in its corner (``MapControlsView/attributionSpace``).
  static let compactHeight: CGFloat = 24
  static let margin: CGFloat = 8
  /// Separates the items of the compact line.
  static let separator = " · "

  var onLink: ((URL) -> Void)?
  /// The corner, as the map's options name it once the layout direction is applied:
  /// `top-left`, `top-right`, `bottom-left` or `bottom-right`.
  var corner = "bottom-right" {
    didSet { if corner != oldValue { setNeedsLayout() } }
  }
  /// The map's content insets; the control stays inside them.
  var insets: UIEdgeInsets = .zero {
    didSet { if insets != oldValue { setNeedsLayout() } }
  }
  private(set) var entries: [MapAttributionEntry] = []
  private(set) var isExpanded = false

  let control = UIControl()
  private let icon = UIImageView()
  let label = UILabel()
  let list = UITextView()

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
    control.backgroundColor = .systemBackground.withAlphaComponent(0.82)
    control.layer.cornerRadius = 4
    control.isAccessibilityElement = true
    control.accessibilityTraits = .button
    control.accessibilityHint = "Shows or hides the map's credits and notices in full."
    control.addAction(
      UIAction { [weak self] _ in self?.setExpanded(!(self?.isExpanded ?? true)) },
      for: .primaryActionTriggered)
    icon.image = UIImage(
      systemName: "info.circle",
      withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .medium))
    icon.tintColor = .secondaryLabel
    icon.contentMode = .center
    label.font = .systemFont(ofSize: 11)
    label.textColor = .label.withAlphaComponent(0.78)
    label.numberOfLines = 1
    label.lineBreakMode = .byTruncatingMiddle
    for view in [icon, label] as [UIView] {
      view.isUserInteractionEnabled = false
      control.addSubview(view)
    }
    list.isEditable = false
    list.isSelectable = true
    list.isScrollEnabled = true
    list.backgroundColor = .systemBackground.withAlphaComponent(0.95)
    list.layer.cornerRadius = 6
    list.textContainerInset = UIEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
    list.adjustsFontForContentSizeCategory = true
    list.dataDetectorTypes = []
    list.delegate = self
    list.isHidden = true
    control.isHidden = true
    addSubview(list)
    addSubview(control)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Created by the map engine.") }

  /// Shows the entries, in order. With none, the control hides.
  func show(_ entries: [MapAttributionEntry]) {
    guard entries != self.entries else { return }
    self.entries = entries
    let compact = entries.filter { [.source, .page, .notice, .fairUse].contains($0.kind) }
    label.text = (compact.isEmpty ? entries : compact).map(\.text).joined(separator: Self.separator)
    control.isHidden = entries.isEmpty
    control.accessibilityLabel = entries.map(\.text).joined(separator: "\n")
    var seen: Set<String> = []
    control.accessibilityCustomActions = entries.flatMap { entry in
      entry.links.compactMap { link -> UIAccessibilityCustomAction? in
        let name = "Open \(entry.text(of: link))"
        guard seen.insert(name + link.url.absoluteString).inserted else { return nil }
        let url = link.url
        return UIAccessibilityCustomAction(name: name) { [weak self] _ in
          self?.onLink?(url)
          return true
        }
      }
    }
    list.attributedText = Self.listText(entries)
    if entries.isEmpty { setExpanded(false) }
    setNeedsLayout()
  }

  func setExpanded(_ expanded: Bool) {
    let expanded = expanded && !entries.isEmpty
    guard expanded != isExpanded else { return }
    isExpanded = expanded
    list.isHidden = !expanded
    control.accessibilityValue = expanded ? "Expanded" : "Collapsed"
    list.setContentOffset(.zero, animated: false)
    setNeedsLayout()
    if expanded { UIAccessibility.post(notification: .layoutChanged, argument: list) }
  }

  /// Every entry as a paragraph, with its links.
  static func listText(_ entries: [MapAttributionEntry]) -> NSAttributedString {
    let text = NSMutableAttributedString()
    let paragraph = NSMutableParagraphStyle()
    paragraph.paragraphSpacing = 6
    let font = UIFont.preferredFont(forTextStyle: .caption1)
    for (index, entry) in entries.enumerated() {
      let start = text.length
      text.append(
        NSAttributedString(
          string: entry.text + (index < entries.count - 1 ? "\n" : ""),
          attributes: [
            .font: font, .foregroundColor: UIColor.label, .paragraphStyle: paragraph,
          ]))
      for link in entry.links {
        text.addAttribute(
          .link, value: link.url,
          range: NSRange(location: start + link.range.lowerBound, length: link.range.count))
      }
    }
    return text
  }

  // MARK: Layout

  /// The rectangle the control may use: the view inside its insets and margins.
  static func area(in bounds: CGRect, insets: UIEdgeInsets) -> CGRect {
    let area = bounds.inset(by: insets).insetBy(dx: margin, dy: margin)
    return area.width > 0 && area.height > 0 ? area : CGRect(origin: area.origin, size: .zero)
  }

  /// The compact control's frame for a content width, in its corner of the area.
  static func compactFrame(width: CGFloat, corner: String, in area: CGRect) -> CGRect {
    let maximum = max(min(area.width * 0.62, 360), min(area.width, 120))
    let width = min(width, maximum)
    let left = corner.hasSuffix("left")
    let top = corner.hasPrefix("top")
    return CGRect(
      x: left ? area.minX : area.maxX - width,
      y: top ? area.minY : area.maxY - compactHeight, width: width, height: compactHeight)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let area = Self.area(in: bounds, insets: insets)
    let iconWidth: CGFloat = 20
    let text = label.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: 20))
    let frame = Self.compactFrame(
      width: ceil(text.width) + iconWidth + 6, corner: corner, in: area)
    control.frame = frame
    let rightToLeft = effectiveUserInterfaceLayoutDirection == .rightToLeft
    let labelWidth = max(0, frame.width - iconWidth - 6)
    icon.frame = CGRect(
      x: rightToLeft ? frame.width - iconWidth : 0, y: 0, width: iconWidth, height: frame.height)
    label.frame = CGRect(
      x: rightToLeft ? 2 : iconWidth, y: 0, width: labelWidth, height: frame.height)
    label.textAlignment = rightToLeft ? .right : .left
    guard isExpanded else { return }
    let width = min(area.width, 420)
    let fitting = list.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    let height = max(0, min(fitting.height, area.height - frame.height - 6, 320))
    list.frame = CGRect(
      x: corner.hasSuffix("left") ? area.minX : area.maxX - width,
      y: corner.hasPrefix("top") ? frame.maxY + 6 : frame.minY - 6 - height, width: width,
      height: height)
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    [control, list].contains { !$0.isHidden && $0.frame.contains(point) }
  }

  // MARK: UITextViewDelegate

  func textView(
    _ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange,
    interaction: UITextItemInteraction
  ) -> Bool {
    if interaction == .invokeDefaultAction { onLink?(URL) }
    return false
  }

  @available(iOS 17.0, *)
  func textView(
    _ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction
  ) -> UIAction? {
    guard case .link(let url) = textItem.content else { return nil }
    return UIAction { [weak self] _ in self?.onLink?(url) }
  }

  @available(iOS 17.0, *)
  func textView(
    _ textView: UITextView, menuConfigurationFor textItem: UITextItem, defaultMenu: UIMenu
  ) -> UITextItem.MenuConfiguration? { nil }
}

/// The attribution a map shows and the control that shows it: the model's entries for the current
/// view, recomputed when the style, the downloaded credits, the view or the fair-use notice change.
@MainActor
final class MapAttributionControl {
  let view = MapAttributionView()
  private(set) var model = MapAttribution()
  private(set) var entries: [MapAttributionEntry] = []
  private var fairUse = MapFairUseState()
  /// The view the regional credits were last checked against.
  private var bounds: TileflowBounds?

  var onLink: ((URL) -> Void)? {
    get { view.onLink }
    set { view.onLink = newValue }
  }

  /// The style the map shows: its sources' attribution and its notices.
  func setStyle(_ style: [String: Any], attributions: [String]) {
    model.sources = attributions
    model.notices = MapAttribution.notices(style)
    refresh()
  }

  /// The credits of the sources the map's downloaded regions hold.
  func setDownloaded(obligations: [OfflineObligation], credits: [OfflineCredit]) {
    model.obligations = obligations.map(MapAttributionObligation.init)
    model.credits = credits.map(MapAttributionCredit.init)
    refresh()
  }

  /// The view the map shows, at the end of a camera movement or when its content loads.
  func update(in bounds: TileflowBounds?) {
    if let bounds { self.bounds = bounds }
    refresh()
  }

  /// A response the map received: a World tile's may change the fair-use notice.
  func received(_ signal: MapFairUseSignal?) {
    guard let signal, fairUse.receive(signal) else { return }
    model.fairUse = fairUse.notice
    refresh()
  }

  /// The corner the options name and the content insets, as the view sends them.
  func place(corner: String?, insets: JSONValue?) {
    if let corner, ["top-left", "top-right", "bottom-left", "bottom-right"].contains(corner) {
      view.corner = corner
    }
    if let insets {
      let value = { (key: String) in CGFloat(insets[key]?.number ?? 0) }
      view.insets = UIEdgeInsets(
        top: value("top"), left: value("left"), bottom: value("bottom"), right: value("right"))
    }
  }

  private func refresh() {
    let next = model.entries(in: bounds)
    guard next != entries else { return }
    entries = next
    view.show(next)
  }
}
