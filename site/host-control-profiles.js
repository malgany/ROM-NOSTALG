"use strict";

// Keep EmulatorJS's original settings UI. Profiles override its per-game cache;
// saves, cheats, volume and every other per-game option remain untouched.
window.ROMNostalgHostControlProfiles = {
  attach(emulator) {
    if (this.current?.emulator === emulator) return;
    this.current?.dispose();
    if (!emulator?.controls || !Array.isArray(emulator.gamepadSelection)) return;
    this.current = new HostControlProfiles(emulator);
  },
};

class HostControlProfiles {
  constructor(emulator) {
    this.emulator = emulator;
    this.api = window.ROMNostalgControlProfiles;
    this.store = this.api.store;
    this.defaults = window.ROMNostalgNetplayCore.createEmulatorControls();
    this.last = [];
    this.signature = "";
    this.applying = false;
    this.originals = {};
    // Old keyboards are attributable; old gamepad maps had no device ID. Leave
    // those in the legacy cache instead of guessing which controller owns them.
    for (let player = 0; player < 4; player++) {
      const keyboard = this.keyboard(emulator.controls[player]);
      if (!this.store.keyboard(player) && JSON.stringify(keyboard) !== JSON.stringify(this.keyboard(this.defaults[player]))) {
        this.store.saveKeyboard(keyboard, player);
      }
    }
    this.wrap("saveSettings", (original, args) => {
      if (!this.applying) this.capture();
      return original(...args);
    });
    this.wrap("loadSettings", (original, args) => {
      this.applying = true;
      try { return original(...args); }
      finally { this.applying = false; this.sync(true); }
    });
    this.wrap("updateGamepadLabels", (original, args) => {
      const result = original(...args);
      this.sync();
      return result;
    });
    // EmulatorJS binds keyChange/gamepadEvent during initialization. Sync via
    // the original assignment hook and a capture listener, not by replacing
    // already-bound input callbacks.
    this.onKey = () => this.sync();
    this.onStorage = (event) => {
      if (event.key === this.api.STORAGE_KEY || event.key === null) this.sync();
    };
    this.parent = emulator.elements?.parent;
    this.parent?.addEventListener("keydown", this.onKey, true);
    window.addEventListener("storage", this.onStorage);
    this.sync(true);
    const poll = () => { this.sync(); this.frame = requestAnimationFrame(poll); };
    this.frame = requestAnimationFrame(poll);
  }

  wrap(name, callback) {
    if (typeof this.emulator[name] !== "function") return;
    const original = this.emulator[name];
    this.originals[name] = original;
    this.emulator[name] = (...args) => callback(original.bind(this.emulator), args);
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.parent?.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("storage", this.onStorage);
    for (const [name, original] of Object.entries(this.originals)) this.emulator[name] = original;
  }
  keyboard(controls) {
    return Object.fromEntries(Array.from({ length: 30 }, (_, input) => [input, this.api.fromHostKey(controls?.[input]?.value, this.emulator)]));
  }
  gamepad(controls) {
    return Object.fromEntries(Array.from({ length: 30 }, (_, input) => {
      const value = controls?.[input]?.value2;
      return [input, typeof value === "number" ? this.api.fromGuestPad(value) : String(value ?? "")];
    }));
  }
  connected() {
    return typeof navigator.getGamepads === "function" ? [...navigator.getGamepads()].filter(Boolean) : [];
  }
  selected(player, pads) {
    return pads.find((pad) => `${pad.id}_${pad.index}` === this.emulator.gamepadSelection[player]) || null;
  }

  capture() {
    // saveSettings also runs for audio/options: write only binding changes.
    const pads = this.connected();
    const resetting = Array.from({ length: 4 }, (_, player) => player).every((player) =>
      JSON.stringify(this.keyboard(this.emulator.controls[player])) === JSON.stringify(this.keyboard(this.defaults[player]))
      && JSON.stringify(this.gamepad(this.emulator.controls[player])) === JSON.stringify(this.gamepad(this.defaults[player])));
    for (let player = 0; player < 4; player++) {
      const before = this.last[player];
      if (!before) continue;
      const keyboard = this.keyboard(this.emulator.controls[player]);
      const gamepad = this.gamepad(resetting && before.pad ? this.defaults[0] : this.emulator.controls[player]);
      if (JSON.stringify(keyboard) !== JSON.stringify(before.keyboard)) this.store.saveKeyboard(keyboard, player);
      if (before.pad && this.api.identity(before.pad) === this.api.identity(this.selected(player, pads))
        && JSON.stringify(gamepad) !== JSON.stringify(before.gamepad)) this.store.saveGamepad(before.pad, gamepad);
    }
    this.sync(true);
  }

  sync(force = false) {
    if (this.applying) return;
    const pads = this.connected();
    const selected = Array.from({ length: 4 }, (_, player) => this.selected(player, pads));
    const signature = JSON.stringify([this.store.revision, selected.map((pad) => [this.api.identity(pad), pad?.index])]);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.applying = true;
    try {
      for (let player = 0; player < 4; player++) {
        const pad = selected[player];
        const keyboard = { ...this.keyboard(this.defaults[player]), ...this.store.keyboard(player) };
        const gamepad = { ...this.gamepad(this.defaults[pad ? 0 : player]), ...this.store.gamepad(pad) };
        const before = this.last[player];
        const changed = before && (this.api.identity(before.pad) !== this.api.identity(pad)
          || before.pad?.index !== pad?.index
          || JSON.stringify(before.keyboard) !== JSON.stringify(keyboard)
          || JSON.stringify(before.gamepad) !== JSON.stringify(gamepad));
        if (changed) for (let input = 0; input < 30; input++) this.emulator.gameManager?.simulateInput(player, input, 0);
        this.emulator.controls[player] = Object.fromEntries(Array.from({ length: 30 }, (_, input) => [input, {
          value: this.api.toHostKey(keyboard[input]), value2: gamepad[input],
        }]));
        this.last[player] = { pad: pad ? { id: pad.id, mapping: pad.mapping || "", index: pad.index } : null, keyboard, gamepad };
      }
      this.emulator.checkGamepadInputs?.();
    } finally { this.applying = false; }
  }
}
