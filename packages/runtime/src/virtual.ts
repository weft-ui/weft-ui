import { flushSync } from "./core.ts";

/** DOM positioning and measurement for a lazy list. */
export class Virtual {
  readonly spacer: HTMLDivElement;
  private readonly scroll: HTMLElement;
  private readonly columns: number;
  private readonly request: (start: number, end: number, retained?: number) => void;
  private readonly elements = new Map<number, HTMLElement>();
  private readonly heights = new Map<number, number>();
  private ids: number[] = [];
  private templates = new Map<number, number>();
  private refreshing = false;
  private touchY: number | null = null;
  private indicator: HTMLElement | null = null;
  private readonly indices = new Map<number, number>();
  private offsets: number[] = [0];
  private frame = 0;
  private observer: ResizeObserver | null = null;
  private readonly view: Window & typeof globalThis;

  constructor(anchor: Node, columns: number, request: (start: number, end: number, retained?: number) => void, private readonly sticky = false, private readonly onRefresh?: () => void) {
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
    if (onRefresh) {
      this.scroll.addEventListener("weft-refresh", this.refresh);
      this.scroll.addEventListener("touchstart", this.touchStart, { passive: true });
      this.scroll.addEventListener("touchend", this.touchEnd, { passive: true });
      this.scroll.addEventListener("touchcancel", this.touchCancel, { passive: true });
    }
  }

  splice(index: number, remove: number, items: readonly { id: number; template: number }[]): void {
    const removed = this.ids.splice(index, remove, ...items.map((item) => item.id));
    for (const item of items) this.templates.set(item.id, item.template);
    this.indices.clear();
    for (let i = 0; i < this.ids.length; i++) this.indices.set(this.ids[i], i);
    for (const id of removed) {
      if (!this.indices.has(id)) {
        this.heights.delete(id);
        this.templates.delete(id);
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
    const measurements = new Map<number, { sum: number; count: number }>();
    for (const [id, height] of this.heights) {
      const template = this.templates.get(id) ?? 0;
      const measurement = measurements.get(template) ?? { sum: 0, count: 0 };
      measurement.sum += height;
      measurement.count++;
      measurements.set(template, measurement);
    }
    const gap = this.gap();
    const rows = Math.ceil(this.ids.length / this.columns);
    const offsets = new Array<number>(rows + 1);
    offsets[0] = 0;
    for (let row = 0; row < rows; row++) {
      let height = 0;
      for (let col = 0; col < this.columns; col++) {
        const id = this.ids[row * this.columns + col];
        if (id !== undefined) {
          const measurement = measurements.get(this.templates.get(id) ?? 0);
          height = Math.max(height, this.heights.get(id) ?? (measurement ? measurement.sum / measurement.count : 44));
        }
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
      let y = this.offsets[Math.floor(i / this.columns)] ?? 0;
      if (this.sticky && this.templates.get(id) === 0) {
        const top = this.scroll.getBoundingClientRect().top - this.spacer.getBoundingClientRect().top;
        let next = i + 1;
        while (next < this.ids.length && this.templates.get(this.ids[next]) !== 0) next++;
        const limit = next < this.ids.length ? this.offsets[next] - (this.heights.get(id) ?? element.offsetHeight) : Infinity;
        y = Math.max(y, Math.min(top, limit));
        element.style.zIndex = "1";
      }
      element.style.transform = `translateY(${y}px)`;
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
      let retained = -1;
      if (this.sticky) {
        retained = Math.min(this.ids.length - 1, this.rowAt(Math.max(0, top)));
        while (retained > 0 && this.templates.get(this.ids[retained]) !== 0) retained--;
        this.position();
      }
      this.request(start, Math.max(start, end), retained);
    });
  };

  setRefreshing(refreshing: boolean): void {
    this.refreshingFromModel = refreshing;
    this.showRefreshing(refreshing);
  }

  private showRefreshing(refreshing: boolean): void {
    this.refreshing = refreshing;
    if (refreshing && !this.indicator) {
      const indicator = this.scroll.ownerDocument.createElement("div");
      indicator.className = "w-refresh-indicator";
      indicator.setAttribute("role", "status");
      indicator.setAttribute("aria-label", "Refreshing");
      indicator.textContent = "↻";
      indicator.style.cssText = "position:sticky;top:0;height:0;text-align:center;z-index:2;pointer-events:none";
      this.scroll.insertBefore(indicator, this.scroll.firstChild);
      this.indicator = indicator;
    } else if (!refreshing && this.indicator) {
      this.indicator.remove();
      this.indicator = null;
    }
  }

  private refresh = (): void => {
    if (this.refreshing || !this.onRefresh) return;
    this.showRefreshing(true);
    try {
      this.onRefresh();
      flushSync();
    } finally {
      this.showRefreshing(this.refreshingFromModel);
    }
  };

  private refreshingFromModel = false;

  private touchStart = (event: TouchEvent): void => {
    if (this.view.matchMedia?.("(pointer: coarse)").matches && this.scroll.scrollTop <= 0 && event.touches.length === 1)
      this.touchY = event.touches[0].clientY;
  };

  private touchEnd = (event: TouchEvent): void => {
    const touch = event.changedTouches[0];
    if (this.touchY !== null && touch && this.scroll.scrollTop <= 0 && touch.clientY - this.touchY >= 60) this.refresh();
    this.touchY = null;
  };

  private touchCancel = (): void => { this.touchY = null; };

  destroy(): void {
    this.scroll.removeEventListener("scroll", this.schedule);
    this.scroll.removeEventListener("weft-refresh", this.refresh);
    this.scroll.removeEventListener("touchstart", this.touchStart);
    this.scroll.removeEventListener("touchend", this.touchEnd);
    this.scroll.removeEventListener("touchcancel", this.touchCancel);
    this.indicator?.remove();
    if (this.frame) this.view.cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.spacer.remove();
    this.elements.clear();
  }
}
