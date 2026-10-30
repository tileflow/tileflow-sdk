/** Layer-list previews have their own lifetime, independent of the map's element-picker mode. */
export class LayerPreview {
  private selected?: string;
  private hoveredId?: string;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private show: (id: string) => void,
    private hide: () => void,
  ) {}

  get hovered() {
    return this.hoveredId;
  }
  get target() {
    return this.hoveredId ?? this.selected;
  }
  select(id?: string) {
    this.selected = id;
    this.hoveredId = undefined;
    this.pause();
    this.refresh();
  }
  hover(id?: string) {
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.pause();
    if (id) this.timer = setTimeout(() => this.refresh(), 80);
    else this.refresh();
  }
  refresh() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const id = this.target;
    if (id) this.show(id);
    else this.hide();
  }
  /** Camera movement hides old geometry, retaining the target for the settled viewport. */
  pause() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.hide();
  }
  clear() {
    this.selected = undefined;
    this.hoveredId = undefined;
    this.pause();
  }
}
