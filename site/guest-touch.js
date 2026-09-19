"use strict";

// The renderer, geometry and D-pad handling come from the host's EmulatorJS.
// This adapter only routes its inputs to multiplayer and clears interrupted touches.
window.ROMNostalgGuestTouchControls = class GuestTouchControls {
  constructor(onMask) {
    this.element = document.querySelector("#guest-touch-controls");
    this.stage = document.querySelector("#guest-stage");
    this.onMask = onMask;
    this.enabled = false;
    this.mask = 0;
    this.touches = new Set();
    this.releaseTimers = new Set();
    this.elements = { parent: this.element };
    this.gameManager = { simulateInput: (_player, input, value) => this.setInput(input, value) };

    this.element.addEventListener("touchstart", (event) => {
      if (this.enabled) for (const touch of event.changedTouches) this.touches.add(touch.identifier);
    }, { capture: true, passive: true });
    for (const type of ["touchend", "touchcancel"]) {
      this.element.addEventListener(type, (event) => {
        for (const touch of event.changedTouches) this.touches.delete(touch.identifier);
      }, { passive: true });
    }
    window.ROMNostalgSnesTouch.call(this);
    const inputs = { b: 0, y: 1, select: 2, start: 3, a: 8, x: 9, l: 10, r: 11 };
    this.buttons = Object.entries(inputs).map(([name, input]) => {
      const button = this.element.querySelector(`.b_${name}`);
      button.dataset.touchInputs = String(input);
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", button.textContent);
      return button;
    });
    this.dpad = this.element.querySelector(".ejs_dpad_main");
    this.dpad.setAttribute("role", "group");
    this.dpad.setAttribute("aria-label", "Direcional");
    this.setEnabled(false);

    const coarsePointer = window.matchMedia("(any-pointer: coarse)");
    const detectTouch = () => {
      this.available = navigator.maxTouchPoints > 0 || coarsePointer.matches;
      this.element.hidden = !this.available;
      this.stage.classList.toggle("has-touch-controls", this.available);
      document.querySelector("#guest-touch-help").hidden = !this.available;
      if (!this.available) this.clear();
      this.stage.dispatchEvent(new Event("guesttouchchange"));
    };
    coarsePointer.addEventListener("change", detectTouch);
    detectTouch();
    this.element.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("blur", () => this.clear());
    window.addEventListener("resize", () => this.clear());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clear();
    });
  }

  createElement(type) { return document.createElement(type); }
  getControlScheme() { return "snes"; }
  localization(text) { return ({ L: "ESQ", R: "DIR" })[text] || text; }

  addEventListener(element, types, callback) {
    for (const type of types.split(" ")) {
      element.addEventListener(type, (event) => {
        event.preventDefault();
        if (!this.enabled || ![...event.changedTouches].some((touch) => this.touches.has(touch.identifier))) return;
        const targetTouches = [...event.targetTouches].filter((touch) => this.touches.has(touch.identifier));
        // A second finger on the same control must not release the first one.
        if ((type === "touchend" || type === "touchcancel") && targetTouches.length) return;
        callback({ type, target: event.target, targetTouches, preventDefault: () => event.preventDefault() });
      }, { passive: false });
    }
  }

  deferRelease(callback) {
    const timer = window.setTimeout(() => {
      this.releaseTimers.delete(timer);
      callback();
    });
    this.releaseTimers.add(timer);
  }

  setInput(input, value) {
    if (!this.enabled || input < 0 || input >= 12) return;
    this.mask = value ? this.mask | (1 << input) : this.mask & ~(1 << input);
    this.publish();
  }

  publish() {
    for (const button of this.buttons) {
      const active = Boolean(this.mask & (1 << Number(button.dataset.touchInputs)));
      button.classList.toggle("ejs_virtualGamepad_button_down", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.onMask(this.mask);
  }

  clear() {
    this.touches.clear();
    for (const timer of this.releaseTimers) window.clearTimeout(timer);
    this.releaseTimers.clear();
    this.mask = 0;
    this.dpad.classList.remove("ejs_dpad_up_pressed", "ejs_dpad_down_pressed", "ejs_dpad_left_pressed", "ejs_dpad_right_pressed");
    this.publish();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clear();
    for (const control of [...this.buttons, this.dpad]) control.setAttribute("aria-disabled", String(!enabled));
  }
};
