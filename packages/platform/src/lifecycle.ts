import { setAppForeground } from "@weft-ui/runtime/navigation";

export function createLifecycle(launchURL: () => string | null, observe: (change: (state: "foreground" | "background") => void, memory: () => void) => void) {
  let state: "foreground" | "background" = "foreground";
  let initialized = false;
  let url: string | null = null;
  const foreground = new Set<() => void>();
  const background = new Set<() => void>();
  const warnings = new Set<() => void>();
  function init() {
    if (initialized) return;
    initialized = true;
    url = launchURL();
    observe((next) => {
      if (state === next) return;
      state = next;
      setAppForeground(next === "foreground");
      for (const listener of next === "foreground" ? foreground : background) listener();
    }, () => { for (const listener of warnings) listener(); });
  }
  function subscribe(set: Set<() => void>, listener: () => void) {
    init(); set.add(listener); return () => { set.delete(listener); };
  }
  return {
    init,
    api: {
      get state() { init(); return state; },
      get launch() { init(); return { url }; },
      onForeground: (listener: () => void) => subscribe(foreground, listener),
      onBackground: (listener: () => void) => subscribe(background, listener),
      onMemoryWarning: (listener: () => void) => subscribe(warnings, listener),
    },
  };
}
