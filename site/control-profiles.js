(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ROMNostalgControlProfiles = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";
  const STORAGE_KEY = "rom-nostalg.control-profiles.v1";
  const PAD_BUTTONS = ["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "LEFT_TOP_SHOULDER", "RIGHT_TOP_SHOULDER", "LEFT_BOTTOM_SHOULDER", "RIGHT_BOTTOM_SHOULDER", "SELECT", "START", "LEFT_STICK", "RIGHT_STICK", "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT"];
  const PAD_AXES = ["LEFT_STICK_X", "LEFT_STICK_Y", "RIGHT_STICK_X", "RIGHT_STICK_Y"];
  const KEY_CODES = {
    Backspace: 8, Tab: 9, Enter: 13, ShiftLeft: 16, ShiftRight: 16,
    ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18,
    Pause: 19, CapsLock: 20, Escape: 27, Space: 32, PageUp: 33, PageDown: 34,
    End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Insert: 45, Delete: 46, MetaLeft: 91, MetaRight: 92, ContextMenu: 93,
    NumpadMultiply: 106, NumpadAdd: 107, NumpadSubtract: 109, NumpadDecimal: 110,
    NumpadDivide: 111, NumLock: 144, ScrollLock: 145, Semicolon: 186, Equal: 187,
    Comma: 188, Minus: 189, Period: 190, Slash: 191, Backquote: 192,
    BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222,
  };
  for (let i = 0; i < 26; i++) KEY_CODES[`Key${String.fromCharCode(65 + i)}`] = 65 + i;
  for (let i = 0; i < 10; i++) { KEY_CODES[`Digit${i}`] = 48 + i; KEY_CODES[`Numpad${i}`] = 96 + i; }
  for (let i = 1; i <= 24; i++) KEY_CODES[`F${i}`] = 111 + i;
  const KEY_LABELS = { enter: "Enter", tab: "Tab", space: "Space", "up arrow": "ArrowUp", "down arrow": "ArrowDown", "left arrow": "ArrowLeft", "right arrow": "ArrowRight" };

  function identity(pad) {
    // index is a temporary connection slot, not a device identity.
    return typeof pad?.id === "string" && pad.id.trim()
      ? JSON.stringify([pad.id.trim(), pad.mapping || ""]) : null;
  }
  function cleanBindings(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value).filter(([input, binding]) =>
      /^(\d|[12]\d)$/.test(input) && typeof binding === "string" && binding.length <= 64));
  }
  function fromHostKey(value, emulator) {
    if (typeof value === "string") {
      if (KEY_CODES[value]) return value;
      if (/^[a-z]$/i.test(value)) return `Key${value.toUpperCase()}`;
      if (/^\d$/.test(value)) return `Digit${value}`;
      if (KEY_LABELS[value]) return KEY_LABELS[value];
      value = emulator?.keyLookup?.(value) ?? 0;
    }
    const number = Number(value);
    return number > 0 ? Object.keys(KEY_CODES).find((code) => KEY_CODES[code] === number) || `keyCode:${number}` : "";
  }
  function toHostKey(code) {
    return KEY_CODES[code] || (/^keyCode:\d+$/.test(code) ? Number(code.slice(8)) : 0);
  }
  function fromGuestPad(value) {
    if (typeof value === "string") {
      const [, axis, sign] = value.split(":");
      return `${PAD_AXES[Number(axis)] || `EXTRA_STICK_${Number(axis)}`}:${Number(sign) > 0 ? "+1" : "-1"}`;
    }
    return value < 0 ? "" : PAD_BUTTONS[value] || `GAMEPAD_${value}`;
  }
  function toGuestPad(value) {
    if (!value) return -1;
    if (PAD_BUTTONS.includes(value)) return PAD_BUTTONS.indexOf(value);
    if (/^GAMEPAD_\d+$/.test(value)) return Number(value.slice(8)) < 64 ? Number(value.slice(8)) : -1;
    if (/^BUTTON_\d+$/.test(value)) return Number(value.slice(7)) - 1;
    const [axis, sign] = value.split(":");
    if (PAD_AXES.includes(axis) && ["+1", "1", "-1"].includes(sign)) return `axis:${PAD_AXES.indexOf(axis)}:${Number(sign)}`;
    if (/^EXTRA_STICK_\d{1,2}$/.test(axis) && ["+1", "1", "-1"].includes(sign)) return `axis:${Number(axis.slice(12))}:${Number(sign)}`;
    return /^axis:\d{1,2}:(-1|1)$/.test(value) ? value : -1;
  }

  class Store {
    constructor(storage) {
      this.storage = storage;
      this.data = { version: 1, keyboards: {}, gamepads: {} };
      this.pending = { keyboards: {}, gamepads: {} };
      this.revision = 0;
      this.reload();
    }
    reload() {
      try {
        const storage = this.storage();
        if (!storage) return;
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
        this.data = { version: 1, keyboards: {}, gamepads: {} };
        if (parsed?.version === 1) {
          for (const kind of ["keyboards", "gamepads"]) {
            for (const [id, map] of Object.entries(parsed[kind] || {})) {
              const bindings = cleanBindings(map);
              if (bindings && id !== "__proto__" && id !== "constructor") this.data[kind][id] = bindings;
            }
          }
        }
        for (const kind of ["keyboards", "gamepads"]) {
          for (const [id, bindings] of Object.entries(this.pending[kind])) {
            this.data[kind][id] = { ...this.data[kind][id], ...bindings };
          }
        }
      } catch { /* Keep session profiles when storage is blocked. */ }
      this.revision += 1;
    }
    keyboard(player = 0) { return this.data.keyboards[player] || null; }
    gamepad(pad) { const id = identity(pad); return id ? this.data.gamepads[id] || null : null; }
    save(kind, id, bindings) {
      if (id === null) return;
      const sanitized = cleanBindings(bindings);
      if (!sanitized) return;
      // Merge fresh data so separate tabs/device edits do not erase one another.
      this.reload();
      this.data[kind][id] = { ...this.data[kind][id], ...sanitized };
      try {
        this.storage()?.setItem(STORAGE_KEY, JSON.stringify(this.data));
        this.pending = { keyboards: {}, gamepads: {} };
      } catch {
        this.pending[kind][id] = { ...this.pending[kind][id], ...sanitized };
      }
      this.revision += 1;
    }
    saveKeyboard(bindings, player = 0) { this.save("keyboards", String(player), bindings); }
    saveGamepad(pad, bindings) { this.save("gamepads", identity(pad), bindings); }
  }
  const store = new Store(() => typeof window === "object" ? window.localStorage : null);
  if (typeof window === "object") window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) store.reload();
  });
  return { STORAGE_KEY, Store, store, identity, fromHostKey, toHostKey, fromGuestPad, toGuestPad };
}));
