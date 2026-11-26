import type { ui } from "./index.d.ts";

type UI = typeof ui;
type AlertOptions = Parameters<UI["alert"]>[0];
type ConfirmOptions = Parameters<UI["confirm"]>[0];
type SheetOptions = Parameters<UI["actionSheet"]>[0];
type ToastOptions = NonNullable<Parameters<UI["toast"]>[1]>;

export interface UIHost {
  alert(options: AlertOptions): Promise<void>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  actionSheet(options: SheetOptions): Promise<number | null>;
  toast(message: string, options: ToastOptions): void;
}

/** Serializes modal presentations while allowing toast replacement independently. */
export function createUI(host: UIHost): UI {
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(show: () => Promise<T>): Promise<T> {
    const result = tail.then(show);
    tail = result.catch(() => {});
    return result;
  }
  return {
    alert: (options) => enqueue(() => host.alert(options)),
    confirm: (options) => enqueue(() => host.confirm(options)),
    actionSheet(options) {
      if (options.options.length < 1 || options.options.length > 6) {
        return Promise.reject(new RangeError("weft: action sheet requires 1 to 6 options"));
      }
      return enqueue(() => host.actionSheet(options));
    },
    toast: (message, options = {}) => host.toast(message, options),
  };
}
