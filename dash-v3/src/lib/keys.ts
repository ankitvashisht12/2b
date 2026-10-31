const closest = (target: EventTarget | null, selector: string) => target instanceof HTMLElement && Boolean(target.closest(selector))

/** Text fields: page shortcuts stay quiet while the user types. */
export const isTypingTarget = (target: EventTarget | null) => closest(target, 'input, textarea, select, [contenteditable="true"]')

/** Dialogs, menus, and list boxes handle their own keys. */
export const inOverlay = (target: EventTarget | null) => closest(target, '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')

/**
 * Arrow keys belong to the focused control when it moves focus with them: the scope switch (radios),
 * a calendar month (grid), tabs, sliders, and combo boxes. Radix also marks the keys it used as handled.
 */
export const ownsArrowKeys = (event: KeyboardEvent) =>
  event.defaultPrevented || closest(event.target, '[role="radio"], [role="radiogroup"], [role="grid"], [role="tablist"], [role="slider"], [role="combobox"], [role="toolbar"]')
