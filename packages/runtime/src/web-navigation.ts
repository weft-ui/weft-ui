/** Adds the host back control and the default bar when the page has no NavBar. */
export function decorate(section: HTMLElement, canGoBack: boolean, onBack: () => void, isModal = false): void {
  let header = section.querySelector<HTMLElement>(":scope > .w-navbar:not(.w-navbar-default)");
  let fallback = section.querySelector<HTMLElement>(":scope > .w-navbar-default");
  if (header) {
    fallback?.remove();
  } else {
    if (!fallback) {
      fallback = section.ownerDocument.createElement("header");
      fallback.className = "w-navbar w-navbar-default";
      section.prepend(fallback);
    }
    header = fallback;
  }
  let button = header.querySelector<HTMLButtonElement>(":scope > .w-navbar-back");
  if (canGoBack && !button) {
    button = section.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "w-navbar-back";
    button.setAttribute("aria-label", isModal ? "Close" : "Back");
    button.textContent = isModal ? "×" : "‹";
    button.addEventListener("click", onBack);
    header.prepend(button);
  } else if (!canGoBack) button?.remove();
}

/** Browser container and history entries for an application page stack. */
export class WebNavigationHost {
  #root: HTMLElement;
  #window: Window;
  #sections = new Map<object, HTMLElement>();
  #onBack: (urls: readonly string[]) => void;
  #listener: (event: PopStateEvent) => void;
  #keyListener: (event: KeyboardEvent) => void;
  #mouseListener: (event: MouseEvent) => void;
  #initialized = false;
  #depth = 0;
  #pageCount = 0;
  #tabbar: HTMLElement | null = null;
  #tabButtons: HTMLButtonElement[] = [];
  #pending: { target: number } | null = null;
  #modal: HTMLElement | null = null;
  #modalKey: object | null = null;
  #previousFocus: HTMLElement | null = null;
  #urls: readonly string[] = [];

  constructor(root: HTMLElement, onBack: (urls: readonly string[]) => void, private readonly onTab?: (index: number) => void, private readonly onDismiss?: (host: boolean) => void) {
    this.#root = root;
    const view = root.ownerDocument.defaultView;
    if (!view) throw new Error("weft: navigation requires a document with a window");
    this.#window = view;
    this.#onBack = onBack;
    this.#listener = (event) => {
      if (this.#pending) {
        const target = this.#pending.target;
        this.#pending = null;
        this.#depth = event.state?.weft?.depth ?? target;
        this.#apply(this.#urls, !!this.#modalKey);
        return;
      }
      const entry = event.state?.weft;
      if (entry && Array.isArray(entry.urls) && entry.urls.every((url: unknown) => typeof url === "string")) {
        this.#depth = entry.depth;
        if (this.#modalKey && !entry.modal) {
          const same = entry.urls.length === this.#urls.length && entry.urls.every((url: string, index: number) => url === this.#urls[index]);
          this.onDismiss?.(true);
          if (same) return;
        }
        this.#onBack(entry.urls);
      }
    };
    this.#keyListener = (event) => {
      if (this.#modal) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.onDismiss?.(false);
          return;
        }
        if (event.key === "Tab") {
          const dialog = this.#modal.querySelector<HTMLElement>('[role="dialog"]')!;
          const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(element => !element.hidden && element.getClientRects().length > 0);
          const index = focusable.indexOf(this.#root.ownerDocument.activeElement as HTMLElement);
          if (!focusable.length) { event.preventDefault(); dialog.focus(); }
          else if (index < 0 || (event.shiftKey ? index === 0 : index === focusable.length - 1)) {
            event.preventDefault();
            focusable[event.shiftKey ? focusable.length - 1 : 0]!.focus();
          }
          return;
        }
      }
      if ((this.#pageCount > 1 || this.#modal) && event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        this.#window.history.back();
      }
    };
    this.#mouseListener = (event) => {
      if ((this.#pageCount > 1 || this.#modal) && event.button === 3) {
        event.preventDefault();
        this.#window.history.back();
      }
    };
    this.#window.addEventListener("popstate", this.#listener);
    this.#window.addEventListener("keydown", this.#keyListener);
    this.#window.addEventListener("mouseup", this.#mouseListener);
  }

  #apply(urls: readonly string[], modal: boolean): void {
    const lastDepth = urls.length - 1 + Number(modal);
    if (this.#depth > lastDepth) {
      this.#pending = { target: lastDepth };
      this.#window.history.go(lastDepth - this.#depth);
      return;
    }
    const history = this.#window.history;
    const entry = history.state?.weft;
    if (this.#depth === lastDepth && !!entry?.modal === modal && Array.isArray(entry?.urls) && entry.urls.length === urls.length && entry.urls.every((url: string, index: number) => url === urls[index])) return;
    const prefix = urls.slice(0, this.#depth + 1);
    history.replaceState({ ...history.state, weft: { depth: this.#depth, urls: prefix, ...(modal && this.#depth === lastDepth ? { modal: true } : {}) } }, "", prefix.at(-1));
    while (this.#depth < lastDepth) {
      this.#depth++;
      const next = urls.slice(0, this.#depth + 1);
      history.pushState({ ...history.state, weft: { depth: this.#depth, urls: next, ...(modal && this.#depth === lastDepth ? { modal: true } : {}) } }, "", next.at(-1));
    }
  }

  sync(
    pages: readonly { key: object; url: string }[],
    operation: "push" | "replace" | "pop" | "root" | "host" | "tab" | "present" | "dismiss",
    tabs?: readonly { key: object | null; url: string; title: string; icon: string; activeIcon: string }[],
    selected = 0,
    badges: readonly (string | null)[] = [],
    modal?: { key: object; style: "sheet" | "fullScreen" } | null,
  ): HTMLElement[] {
    const previousCount = this.#pageCount;
    const hadModal = this.#modalKey !== null;
    this.#pageCount = pages.length;
    const live = new Set(pages.map((page) => page.key));
    for (const tab of tabs ?? []) if (tab.key) live.add(tab.key);
    if (modal) live.add(modal.key);
    for (const [key, section] of this.#sections) {
      if (!live.has(key)) {
        section.remove();
        this.#sections.delete(key);
      } else {
        section.hidden = true;
        section.inert = true;
      }
    }
    if (tabs?.length) {
      if (!this.#tabbar) {
        this.#tabbar = this.#root.ownerDocument.createElement("nav");
        this.#tabbar.className = "w-tabbar";
        this.#tabbar.setAttribute("role", "tablist");
        this.#root.classList.add("w-tab-host");
        const style = this.#root.ownerDocument.createElement("style");
        style.textContent = `
.w-tab-host>.w-page{min-height:0}
.w-tabbar{display:flex;flex:none;align-self:stretch;justify-content:space-around;border-top:1px solid #78788066}
.w-tabbar[hidden]{display:none}
.w-tabbar button{position:relative;display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:49px;border:0;background:none;color:inherit;font:inherit;cursor:pointer}
.w-tabbar button[aria-selected=true]{color:#007aff}
.w-tabbar-icon{width:24px;height:24px;object-fit:contain}
.w-tabbar-badge{position:absolute;top:2px;left:calc(50% + 8px);min-width:16px;padding:0 3px;border-radius:999px;background:#ff3b30;color:white;font-size:11px;line-height:16px;text-align:center}
.w-tabbar-badge:empty{min-width:8px;width:8px;height:8px;padding:0}`;
        this.#tabbar.append(style);
        this.#root.append(this.#tabbar);
        this.#tabButtons = tabs.map((tab, index) => {
          const button = this.#root.ownerDocument.createElement("button");
          button.type = "button";
          button.setAttribute("role", "tab");
          const icon = this.#root.ownerDocument.createElement("img");
          icon.className = "w-tabbar-icon";
          icon.alt = "";
          const title = this.#root.ownerDocument.createElement("span");
          title.textContent = tab.title;
          button.append(icon, title);
          button.addEventListener("click", () => this.onTab?.(index));
          button.addEventListener("keydown", event => {
            let next: number;
            if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = tabs.length - 1;
            else return;
            event.preventDefault();
            this.onTab?.(next);
            this.#tabButtons[next]?.focus();
          });
          this.#tabbar!.append(button);
          return button;
        });
      }
      this.#tabbar.hidden = pages.length > 1;
      tabs.forEach((tab, index) => {
        const button = this.#tabButtons[index]!;
        button.setAttribute("aria-selected", String(index === selected));
        button.tabIndex = index === selected ? 0 : -1;
        button.querySelector("img")!.src = index === selected ? tab.activeIcon : tab.icon;
        let badge = button.querySelector<HTMLElement>(".w-tabbar-badge");
        const text = badges[index];
        if (text == null) badge?.remove();
        else {
          if (!badge) {
            badge = this.#root.ownerDocument.createElement("span");
            badge.className = "w-tabbar-badge";
            button.append(badge);
          }
          badge.textContent = text;
        }
      });
    }
    const sections = pages.map((page, index) => {
      let section = this.#sections.get(page.key);
      if (!section) {
        section = this.#root.ownerDocument.createElement("section");
        section.className = "w-page";
        this.#sections.set(page.key, section);
        this.#root.insertBefore(section, this.#tabbar);
      }
      const hidden = index !== pages.length - 1;
      section.hidden = hidden;
      section.inert = hidden || !!modal;
      return section;
    });
    if (modal) {
      if (!this.#modal) {
        this.#previousFocus = this.#root.ownerDocument.activeElement as HTMLElement | null;
        this.#modal = this.#root.ownerDocument.createElement("div");
        this.#modal.className = "w-modal";
        this.#modal.addEventListener("click", event => { if (event.target === this.#modal) this.onDismiss?.(false); });
        const style = this.#root.ownerDocument.createElement("style");
        style.textContent = `.w-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:center;background:#0008}.w-modal>.w-page{width:100%;max-height:90%;overflow:auto;background:Canvas;border-radius:16px 16px 0 0}.w-modal.w-modal-full>.w-page{height:100%;max-height:100%;border-radius:0}@media(prefers-reduced-motion:no-preference){.w-modal>.w-page{animation:w-modal-enter .2s ease-out}@keyframes w-modal-enter{from{transform:translateY(100%)}to{transform:translateY(0)}}}`;
        this.#modal.append(style);
        this.#root.append(this.#modal);
      }
      this.#modal.classList.toggle("w-modal-full", modal.style === "fullScreen");
      let section = this.#sections.get(modal.key);
      if (!section) {
        section = this.#root.ownerDocument.createElement("section");
        section.className = "w-page";
        section.setAttribute("role", "dialog");
        section.setAttribute("aria-modal", "true");
        section.tabIndex = -1;
        this.#sections.set(modal.key, section);
        this.#modal.append(section);
      }
      section.hidden = false;
      section.inert = false;
      sections.push(section);
      if (!hadModal) {
        const dialog = section;
        queueMicrotask(() => { if (this.#modalKey === modal.key) (dialog.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])') ?? dialog).focus(); });
      }
      if (this.#tabbar) this.#tabbar.inert = true;
      this.#modalKey = modal.key;
    } else if (this.#modal) {
      this.#modal.remove();
      this.#modal = null;
      this.#modalKey = null;
      if (this.#tabbar) this.#tabbar.inert = false;
      this.#previousFocus?.focus();
      this.#previousFocus = null;
    }
    const current = sections.at(-1);
    if (current && (operation === "push" || operation === "pop")) {
      const animation = operation === "push" ? "w-page-push" : "w-page-pop";
      current.classList.add(animation);
      current.addEventListener("animationend", () => current.classList.remove(animation), { once: true });
    }
    const urls = pages.map((page) => page.url);
    this.#urls = urls;
    const url = urls.at(-1);
    if (!url) return sections;
    if (!this.#initialized) {
      this.#initialized = true;
      const saved = this.#window.history.state?.weft;
      this.#depth = typeof saved?.depth === "number" ? saved.depth : 0;
      if (urls.length > 1 && !saved) {
        const root = [urls[0]!];
        this.#window.history.replaceState({ ...this.#window.history.state, weft: { depth: 0, urls: root } }, "", root[0]);
        this.#depth = 1;
        this.#window.history.pushState({ ...this.#window.history.state, weft: { depth: 1, urls } }, "", url);
      } else {
        this.#window.history.replaceState({ ...this.#window.history.state, weft: { depth: this.#depth, urls } }, "", url);
      }
    } else if (this.#pending) {
      // The pending traversal will apply the latest desired state when it lands.
    } else if (operation === "tab") {
      if (this.#depth > 0) {
        this.#pending = { target: 0 };
        this.#window.history.go(-this.#depth);
      } else {
        this.#window.history.replaceState({ ...this.#window.history.state, weft: { depth: 0, urls } }, "", url);
      }
    } else if (operation === "push" || operation === "present") {
      this.#depth++;
      this.#window.history.pushState({ ...this.#window.history.state, weft: { depth: this.#depth, urls, modal: !!modal } }, "", url);
    } else if (operation === "replace") {
      this.#window.history.replaceState({ ...this.#window.history.state, weft: { depth: this.#depth, urls } }, "", url);
    } else if (operation === "pop" || operation === "root" || operation === "dismiss") {
      const delta = Math.min(this.#depth, operation === "root" ? this.#depth : Math.max(1, previousCount - pages.length + (hadModal && !modal ? 1 : 0)));
      if (delta) {
        this.#pending = { target: this.#depth - delta };
        this.#window.history.go(-delta);
      } else this.#window.history.replaceState({ ...this.#window.history.state, weft: { depth: 0, urls } }, "", url);
    }
    return sections;
  }

  dispose(): void {
    this.#window.removeEventListener("popstate", this.#listener);
    this.#window.removeEventListener("keydown", this.#keyListener);
    this.#window.removeEventListener("mouseup", this.#mouseListener);
    for (const section of this.#sections.values()) section.remove();
    this.#sections.clear();
    this.#tabbar?.remove();
    this.#modal?.remove();
    this.#modal = null;
    this.#modalKey = null;
    this.#previousFocus = null;
    this.#root.classList.remove("w-tab-host");
    this.#tabbar = null;
    this.#tabButtons = [];
  }
}
