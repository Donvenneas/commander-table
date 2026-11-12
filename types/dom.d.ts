// Type-check help (item 175; read by tests/typecheck.mjs through jsconfig.json, never loaded by the game).
// The game's pages only hold HTML elements, and every event it handles comes from one, so lookups that the DOM types
// as a plain Element or EventTarget are treated as HTML elements here instead of being cast at every use.
export {};
declare global {
  interface EventTarget {
    closest(selectors: string): HTMLElement | null;
    matches(selectors: string): boolean;
    id: string;
  }
  interface Element {
    dataset: DOMStringMap;
    value: string;
    checked: boolean;
    disabled: boolean;
    href: string;
    src: string;
    hidden: boolean;
    offsetParent: Element | null;
    onclick: ((this: GlobalEventHandlers, ev: MouseEvent) => any) | null;
    click(): void;
    focus(options?: FocusOptions): void;
  }
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
