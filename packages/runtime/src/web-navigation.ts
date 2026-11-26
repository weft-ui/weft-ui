/** Adds the host back control and the default bar when the page has no NavBar. */
export function decorate(section: HTMLElement, canGoBack: boolean, onBack: () => void): void {
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
    button.setAttribute("aria-label", "Back");
    button.textContent = "‹";
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

  constructor(root: HTMLElement, onBack: (urls: readonly string[]) => void) {
    this.#root = root;
    const view = root.ownerDocument.defaultView;
    if (!view) throw new Error("weft: navigation requires a document with a window");
    this.#window = view;
    this.#onBack = onBack;
    this.#listener = (event) => {
      const entry = event.state?.weft;
      if (entry && Array.isArray(entry.urls) && entry.urls.every((url: unknown) => typeof url === "string")) {
        this.#depth = entry.depth;
        this.#onBack(entry.urls);
      }
    };
    this.#keyListener = (event) => {
      if (this.#sections.size > 1 && event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        this.#window.history.back();
      }
    };
    this.#mouseListener = (event) => {
      if (this.#sections.size > 1 && event.button === 3) {
        event.preventDefault();
        this.#window.history.back();
      }
    };
    this.#window.addEventListener("popstate", this.#listener);
    this.#window.addEventListener("keydown", this.#keyListener);
    this.#window.addEventListener("mouseup", this.#mouseListener);
  }

  sync(pages: readonly { key: object; url: string }[], operation: "push" | "replace" | "pop" | "root" | "host"): HTMLElement[] {
    const previousCount = this.#sections.size;
    const live = new Set(pages.map((page) => page.key));
    for (const [key, section] of this.#sections) {
      if (!live.has(key)) {
        section.remove();
        this.#sections.delete(key);
      }
    }
    const sections = pages.map((page, index) => {
      let section = this.#sections.get(page.key);
      if (!section) {
        section = this.#root.ownerDocument.createElement("section");
        section.className = "w-page";
        this.#sections.set(page.key, section);
        this.#root.append(section);
      }
      const hidden = index !== pages.length - 1;
      section.hidden = hidden;
      section.inert = hidden;
      return section;
    });
    const current = sections.at(-1);
    if (current && (operation === "push" || operation === "pop")) {
      const animation = operation === "push" ? "w-page-push" : "w-page-pop";
      current.classList.add(animation);
      current.addEventListener("animationend", () => current.classList.remove(animation), { once: true });
    }
    const urls = pages.map((page) => page.url);
    const url = urls.at(-1);
    if (!url) return sections;
    if (!this.#initialized) {
      this.#initialized = true;
      const saved = this.#window.history.state?.weft;
      this.#depth = typeof saved?.depth === "number" ? saved.depth : 0;
      this.#window.history.replaceState({ ...this.#window.history.state, weft: { depth: this.#depth, urls } }, "", url);
    } else if (operation === "push") {
      this.#depth++;
      this.#window.history.pushState({ ...this.#window.history.state, weft: { depth: this.#depth, urls } }, "", url);
    } else if (operation === "replace") {
      this.#window.history.replaceState({ ...this.#window.history.state, weft: { depth: this.#depth, urls } }, "", url);
    } else if (operation === "pop" || operation === "root") {
      const delta = Math.min(this.#depth, operation === "root" ? this.#depth : Math.max(1, previousCount - pages.length));
      if (delta) this.#window.history.go(-delta);
      else this.#window.history.replaceState({ ...this.#window.history.state, weft: { depth: 0, urls } }, "", url);
    }
    return sections;
  }

  dispose(): void {
    this.#window.removeEventListener("popstate", this.#listener);
    this.#window.removeEventListener("keydown", this.#keyListener);
    this.#window.removeEventListener("mouseup", this.#mouseListener);
    for (const section of this.#sections.values()) section.remove();
    this.#sections.clear();
  }
}
