import UIKit

/// The map's attribution control, drawn by the SDK over MapLibre Native, whose own attribution
/// button and logo stay hidden.
///
/// It is always shown while the map has something to credit, in the corner the map's options
/// choose, inside the content insets; insets that leave it no room are ignored, so no option hides
/// it. The compact control wraps source and regional credits, style notices and World's fair-use
/// notice (``MapAttributionStrip``), shortening only credits that are wider than one line.
/// The button opens every entry in full, in order, with its links. VoiceOver reads
/// the full text of every entry from the compact control, and offers each link as an action. Links
/// never open by themselves: they reach the map view, which reports `externalLinkRequested`.
///
/// The view covers the map and claims touches only on the control and its open list; the map view
/// leaves those touches to it whatever the application filters.
@MainActor
final class MapAttributionView: UIView, UITextViewDelegate {
  static let minimumHeight: CGFloat = 24
  static let margin: CGFloat = 8
  static let iconWidth: CGFloat = 20

  var onLink: ((URL) -> Void)?
  var onHeightChange: ((CGFloat) -> Void)?
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
  /// What the compact control shows: every source and regional credit, then the notices.
  private var stripItems: [MapAttributionStrip.Item] = []

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
    label.numberOfLines = 0
    label.lineBreakMode = .byWordWrapping
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
    stripItems = MapAttributionStrip.items(entries)
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

  /// The rectangle the control may use: the view inside its insets and margins. Insets that leave
  /// too little room for the control are ignored, so it stays on the map.
  static func area(in bounds: CGRect, insets: UIEdgeInsets) -> CGRect {
    let width = bounds.width - insets.left - insets.right - 2 * margin
    let height = bounds.height - insets.top - insets.bottom - 2 * margin
    if width >= 120, height >= minimumHeight {
      return CGRect(
        x: bounds.minX + insets.left + margin, y: bounds.minY + insets.top + margin, width: width,
        height: height)
    }
    guard bounds.width > 2 * margin, bounds.height > 2 * margin else {
      return CGRect(origin: bounds.origin, size: .zero)
    }
    return bounds.insetBy(dx: margin, dy: margin)
  }

  /// The widest the compact control may be in an area: it leaves room for a control in the other
  /// corner of the same edge, such as the scale bar.
  static func maximumWidth(in area: CGRect) -> CGFloat {
    max(min(area.width * 0.62, 360), min(area.width, 160))
  }

  /// The compact control's frame for a content size, in its corner of the area.
  static func compactFrame(width: CGFloat, height: CGFloat, corner: String, in area: CGRect)
    -> CGRect
  {
    let width = min(width, maximumWidth(in: area))
    let left = corner.hasSuffix("left")
    let top = corner.hasPrefix("top")
    return CGRect(
      x: left ? area.minX : area.maxX - width, y: top ? area.minY : area.maxY - height,
      width: width, height: height)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard !control.isHidden else {
      onHeightChange?(0)
      return
    }

    let font = label.font ?? .systemFont(ofSize: 11)
    let measure = { (text: String) in
      ceil((text as NSString).size(withAttributes: [.font: font]).width)
    }
    func fit(in area: CGRect) -> CGRect {
      let padding = Self.iconWidth + 6
      let width = Self.maximumWidth(in: area) - padding
      let lines = MapAttributionStrip.lines(stripItems, width: width, measure: measure)
      label.text = lines.joined(separator: "\n")
      let textWidth = min(width, lines.map(measure).max() ?? 0)
      let fitting = label.sizeThatFits(
        CGSize(width: max(0, textWidth + 4), height: .greatestFiniteMagnitude))
      return Self.compactFrame(
        width: max(0, textWidth + padding), height: max(Self.minimumHeight, ceil(fitting.height)),
        corner: corner, in: area)
    }

    var area = Self.area(in: bounds, insets: insets)
    var frame = fit(in: area)
    if frame.height > area.height, insets != .zero {
      area = Self.area(in: bounds, insets: .zero)
      frame = fit(in: area)
    }
    control.frame = frame
    onHeightChange?(frame.height)
    let rightToLeft = effectiveUserInterfaceLayoutDirection == .rightToLeft
    let iconWidth = Self.iconWidth
    let labelWidth = max(0, frame.width - iconWidth - 6)
    icon.frame = CGRect(
      x: rightToLeft ? frame.width - iconWidth : 0, y: 0, width: iconWidth, height: frame.height)
    label.frame = CGRect(
      x: rightToLeft ? 2 : iconWidth, y: 0, width: labelWidth + 4, height: frame.height)
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

/// Compact source and regional credits, style notices and World's fair-use notice.
/// Credits that exceed the available width shorten individually. Notices keep their full text.
enum MapAttributionStrip {
  struct Item: Equatable, Sendable {
    let text: String
    /// Notices keep their full text and can wrap within the label.
    let keepsText: Bool
  }

  static let separator = " · "
  static let ellipsis = "…"

  static func items(_ entries: [MapAttributionEntry]) -> [Item] {
    entries.compactMap { entry in
      switch entry.kind {
      case .source, .regional: Item(text: entry.text, keepsText: false)
      case .notice, .fairUse: Item(text: entry.text, keepsText: true)
      case .obligation, .page: nil
      }
    }
  }

  /// Packs credits into as many lines as needed, keeping each credit together.
  static func lines(_ items: [Item], width: CGFloat, measure: (String) -> CGFloat) -> [String] {
    guard width > 0 else { return [] }
    var lines: [String] = []
    for item in items {
      let text = item.keepsText ? item.text : shorten(item.text, to: width, measure: measure)
      if let last = lines.last, measure(last + separator + text) <= width {
        lines[lines.count - 1] = last + separator + text
      } else {
        lines.append(text)
      }
    }
    return lines
  }

  /// `text`, or its longest start with an ellipsis that is at most `cap` wide; at least its first
  /// character. A credit that qualifies what it names after a dash, such as
  /// "NOAA ENC 2026-10-20 — not official, not for navigation", keeps the qualification's first
  /// clause with the name, or shows only its first word ("NOAA…"): a shortened credit never names
  /// a product without what qualifies it.
  static func shorten(_ text: String, to cap: CGFloat, measure: (String) -> CGFloat) -> String {
    if measure(text) <= cap { return text }
    let characters = Array(text)
    func candidate(_ length: Int) -> String {
      String(characters[..<length]).trimmingCharacters(in: .whitespaces) + ellipsis
    }
    for lengths in allowedLengths(characters).reversed() where !lengths.isEmpty {
      guard measure(candidate(lengths.lowerBound)) <= cap else { continue }
      var low = lengths.lowerBound
      var high = lengths.upperBound
      while low < high {
        let middle = (low + high + 1) / 2
        if measure(candidate(middle)) <= cap { low = middle } else { high = middle - 1 }
      }
      return candidate(low)
    }
    return candidate(1)
  }

  /// The lengths a shortened credit may keep: within its first word, and, when a dash qualifies
  /// what it names, from the end of the qualification's first clause.
  private static func allowedLengths(_ characters: [Character]) -> [ClosedRange<Int>] {
    let count = characters.count
    guard count > 1 else { return [1...1] }
    let firstWord = characters.firstIndex(where: \.isWhitespace) ?? count
    let brand = 1...max(1, min(firstWord, count - 1))

    // Downloaded chart credits put their qualification later in a colon-led paragraph.
    if let colon = characters.firstIndex(of: ":") {
      let name = String(characters[..<colon])
      if name.contains(" ENC") || name.contains(" IENC") { return [brand] }
    }
    let dash = characters.indices.first { index in
      index > 0 && index + 1 < count && ["—", "–"].contains(characters[index])
        && characters[index - 1] == " " && characters[index + 1] == " "
    }
    guard let dash else { return [1...(count - 1)] }
    var ranges = [brand]
    if let clause = characters[(dash + 2)...].firstIndex(of: ","), clause < count {
      ranges.append(clause...(count - 1))
    }
    return ranges
  }
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
