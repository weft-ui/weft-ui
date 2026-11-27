/** DOM positioning and measurement for a lazy list. */
export class Virtual {
  readonly spacer: HTMLDivElement;
  private readonly scroll: HTMLElement;
  private readonly columns: number;
  private readonly request: (start: number, end: number) => void;
  private readonly elements = new Map<number, HTMLElement>();
  private readonly heights = new Map<number, number>();
  private ids: number[] = [];
  private readonly indices = new Map<number, number>();
  private offsets: number[] = [0];
  private frame = 0;
  private observer: ResizeObserver | null = null;
  private readonly view: Window & typeof globalThis;

  constructor(anchor: Node, columns: number, request: (start: number, end: number) => void) {
    this.scroll = anchor.parentNode as HTMLElement;
    // Nodes cloned from an HTML template belong to an inert document until mounted.
    this.view = this.scroll.ownerDocument.defaultView ?? document.defaultView!;
    this.columns = Math.max(1, columns);
    this.request = request;
    this.spacer = this.scroll.ownerDocument.createElement("div");
    this.spacer.className = "w-virtual-spacer";
    this.spacer.style.cssText = "position:relative;flex:none;width:100%;min-width:0";
    this.scroll.insertBefore(this.spacer, anchor);
    const Observer = this.view.ResizeObserver;
    if (Observer) {
      this.observer = new Observer((entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = Number((entry.target as HTMLElement).dataset.weftItem);
          const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
          if (id && height > 0 && this.heights.get(id) !== height) {
            this.heights.set(id, height);
            changed = true;
          }
        }
        if (changed) this.layout(true);
        this.schedule();
      });
      this.observer.observe(this.scroll);
    }
    this.scroll.addEventListener("scroll", this.schedule, { passive: true });
  }

  splice(index: number, remove: number, items: readonly { id: number }[]): void {
    const removed = this.ids.splice(index, remove, ...items.map((item) => item.id));
    this.indices.clear();
    for (let i = 0; i < this.ids.length; i++) this.indices.set(this.ids[i], i);
    for (const id of removed) {
      if (!this.indices.has(id)) {
        this.heights.delete(id);
        this.bind(id, null);
      }
    }
    for (const id of this.ids) {
      const element = this.elements.get(id);
      if (element) this.spacer.appendChild(element);
    }
    this.layout(false);
    this.schedule();
  }

  bind(id: number, mount: ((element: HTMLElement) => void) | null): void {
    const old = this.elements.get(id);
    if (old) {
      this.observer?.unobserve(old);
      old.remove();
      this.elements.delete(id);
    }
    if (mount) {
      const element = this.scroll.ownerDocument.createElement("div");
      element.className = "w-virtual-item";
      element.dataset.weftItem = String(id);
      element.style.cssText = "position:absolute;top:0;left:0;box-sizing:border-box";
      let next: HTMLElement | null = null;
      const index = this.indices.get(id);
      if (index !== undefined) {
        for (let i = index + 1; i < this.ids.length; i++) {
          next = this.elements.get(this.ids[i]) ?? null;
          if (next) break;
        }
      }
      this.spacer.insertBefore(element, next);
      this.elements.set(id, element);
      mount(element);
      this.observer?.observe(element);
      this.position();
    }
  }

  private gap(): number {
    return Number.parseFloat(this.view.getComputedStyle(this.scroll).rowGap) || 0;
  }

  private layout(preserve: boolean): void {
    const oldTop = this.spacer.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top;
    const viewport = -oldTop;
    const oldRow = this.rowAt(viewport);
    const oldOffset = this.offsets[oldRow] ?? 0;
    let sum = 0;
    for (const height of this.heights.values()) sum += height;
    const estimate = this.heights.size ? sum / this.heights.size : 44;
    const gap = this.gap();
    const rows = Math.ceil(this.ids.length / this.columns);
    const offsets = new Array<number>(rows + 1);
    offsets[0] = 0;
    for (let row = 0; row < rows; row++) {
      let height = 0;
      for (let col = 0; col < this.columns; col++) {
        const id = this.ids[row * this.columns + col];
        if (id !== undefined) height = Math.max(height, this.heights.get(id) ?? estimate);
      }
      offsets[row + 1] = offsets[row] + height + (row + 1 < rows ? gap : 0);
    }
    this.offsets = offsets;
    this.spacer.style.height = `${offsets[rows]}px`;
    this.position();
    if (preserve && viewport > 0) this.scroll.scrollTop += (offsets[Math.min(oldRow, rows)] ?? 0) - oldOffset;
  }

  private position(): void {
    const gap = this.gap();
    const width = `calc(${100 / this.columns}% - ${gap * (this.columns - 1) / this.columns}px)`;
    for (const [id, element] of this.elements) {
      const i = this.indices.get(id);
      if (i === undefined) continue;
      const col = i % this.columns;
      element.style.width = width;
      element.style.left = `calc(${col * 100 / this.columns}% + ${col * gap / this.columns}px)`;
      element.style.transform = `translateY(${this.offsets[Math.floor(i / this.columns)] ?? 0}px)`;
    }
  }

  private rowAt(y: number): number {
    let lo = 0;
    let hi = this.offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private schedule = (): void => {
    if (this.frame) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = 0;
      const height = this.scroll.clientHeight;
      if (!height) return;
      const top = this.scroll.getBoundingClientRect().top - this.spacer.getBoundingClientRect().top;
      const start = Math.min(this.ids.length, this.rowAt(Math.max(0, top - height)) * this.columns);
      const end = Math.min(this.ids.length, (this.rowAt(top + height * 2) + 1) * this.columns);
      this.request(start, Math.max(start, end));
    });
  };

  destroy(): void {
    this.scroll.removeEventListener("scroll", this.schedule);
    if (this.frame) this.view.cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.spacer.remove();
    this.elements.clear();
  }
}
