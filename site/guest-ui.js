"use strict";

// Guest-only UI. Timings and visual states follow the host's pinned EmulatorJS 4.2.3.
window.ROMNostalgGuestUi = class GuestUi {
  constructor(owner) {
    this.owner = owner;
    this.stage = document.querySelector("#guest-stage");
    this.toolbar = document.querySelector("#guest-player-toolbar");
    this.dialog = owner.guestControlsDialog;
    this.gamepadSelect = document.querySelector("#guest-connected-gamepad");
    this.capture = document.querySelector("#guest-binding-capture");
    this.selection = "auto";
    this.capturing = null;
    this.timer = 0;
    this.frame = 0;
    this.hoveringMenu = false;
    this.draggingVolume = false;
    this.order = [8, 0, 9, 1, 2, 3, 4, 5, 6, 7, 10, 11];
    this.labels = ["B", "Y", "SELECT", "START", "CIMA", "BAIXO", "ESQUERDA", "DIREITA", "A", "X", "ESQ", "DIR"];
    this.padLabels = ["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "LEFT_TOP_SHOULDER", "RIGHT_TOP_SHOULDER", "LEFT_BOTTOM_SHOULDER", "RIGHT_BOTTOM_SHOULDER", "SELECT", "START", "LEFT_STICK", "RIGHT_STICK", "DIRECIONAL - CIMA", "DIRECIONAL - BAIXO", "DIRECIONAL - ESQUERDA", "DIRECIONAL - DIREITA"];

    this.stage.addEventListener("click", (event) => {
      if (event.target.closest(".guest-actions, #guest-resume-button")) return;
      if (event.pointerType !== "touch") this.showMenu();
    });
    this.stage.addEventListener("mousemove", (event) => {
      const bottom = this.stage.getBoundingClientRect().bottom;
      const angle = Math.atan2(event.movementY, event.movementX) * 180 / Math.PI;
      if (event.clientY >= bottom - this.toolbar.offsetHeight - 30 || (angle >= 85 && angle <= 95)) this.showMenu();
    });
    this.stage.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && !this.dialog.open) this.showMenu();
    });
    this.toolbar.addEventListener("pointerenter", () => { this.hoveringMenu = true; });
    this.toolbar.addEventListener("pointerleave", () => { this.hoveringMenu = false; this.showMenu(); });
    this.toolbar.addEventListener("focusin", () => this.showMenu());
    owner.guestVolumeInput.addEventListener("pointerdown", () => { this.draggingVolume = true; });
    window.addEventListener("pointerup", () => { this.draggingVolume = false; });
    window.addEventListener("pointercancel", () => { this.draggingVolume = false; });
    window.addEventListener("blur", () => { this.draggingVolume = false; this.hideMenu(); this.cancelCapture(); });
    this.stage.addEventListener("guesttouchchange", () => this.syncDevice());
    this.gamepadSelect.addEventListener("change", () => {
      this.selection = this.gamepadSelect.value;
      this.cancelCapture();
      this.selectedGamepad();
      this.owner.guestSession?.transmitter?.refreshMask();
    });
    owner.guestBindingsBody.addEventListener("click", (event) => {
      const target = event.target.closest("[data-input]");
      if (target) this.beginCapture(Number(target.dataset.input), target.dataset.bindingKind);
    });
    document.querySelector("#guest-binding-clear").addEventListener("click", () => this.clearBinding());
    document.querySelector("#guest-binding-cancel").addEventListener("click", () => this.cancelCapture());
    this.capture.addEventListener("click", (event) => { if (event.target === this.capture) this.cancelCapture(); });
    window.addEventListener("keydown", (event) => this.onKey(event), true);
    this.syncDevice();
  }

  gamepads() {
    return typeof navigator.getGamepads === "function" ? [...navigator.getGamepads()].filter(Boolean) : [];
  }

  selectedGamepad() {
    const pads = this.gamepads();
    const pad = this.selection === "auto" ? pads[0] || null
      : pads.find((pad) => String(pad.index ?? 0) === this.selection) || null;
    this.owner.syncGuestProfile(pad);
    return pad;
  }

  syncDevice() {
    const mobile = this.owner.guestTouchControls.available;
    document.querySelector("#guest-mobile-actions").hidden = !mobile;
    document.querySelector("#guest-player-help").hidden = mobile;
    this.toolbar.hidden = mobile;
    if (mobile) { this.closeControls(false); this.hideMenu(); }
  }

  showMenu() {
    if (this.owner.guestTouchControls.available || this.dialog.open) return;
    clearTimeout(this.timer);
    this.toolbar.classList.remove("is-hidden");
    this.toolbar.inert = false;
    this.timer = window.setTimeout(() => {
      if (this.hoveringMenu || this.draggingVolume) this.showMenu();
      else this.hideMenu();
    }, 3000);
  }

  hideMenu() {
    clearTimeout(this.timer);
    this.toolbar.classList.add("is-hidden");
    this.toolbar.inert = true;
  }

  openControls() {
    if (this.owner.guestTouchControls.available || this.dialog.open) return;
    this.owner.guestSession?.transmitter?.setSuspended(true);
    this.owner.guestTouchControls.clear();
    this.hideMenu();
    this.renderBindings();
    this.dialog.show();
    this.pollControllers();
    document.querySelector("#guest-controls-close").focus({ preventScroll: true });
  }

  closeControls(restoreFocus = true) {
    if (!this.dialog.open) return;
    this.cancelCapture(false);
    cancelAnimationFrame(this.frame);
    this.dialog.close();
    this.owner.guestSession?.transmitter?.setSuspended(false);
    if (restoreFocus) this.stage.focus({ preventScroll: true });
  }

  keyLabel(code) {
    const labels = { ArrowUp: "up arrow", ArrowDown: "down arrow", ArrowLeft: "left arrow", ArrowRight: "right arrow", Space: "space", ShiftLeft: "left shift", ShiftRight: "right shift" };
    return labels[code] ?? code.replace(/^(Key|Digit)/, "").toLowerCase();
  }

  padLabel(binding) {
    if (typeof binding === "string") {
      const [, axis, sign] = binding.split(":");
      return `EIXO ${Number(axis) + 1} ${sign === "-1" ? "−" : "+"}`;
    }
    return binding < 0 ? "" : (this.padLabels[binding] || `BUTTON_${binding + 1}`);
  }

  renderBindings() {
    const rows = this.order.map((input) => {
      const row = document.createElement("tr");
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = `${this.labels[input]}:`;
      row.append(label);
      for (const kind of ["gamepad", "keyboard"]) {
        const cell = document.createElement("td");
        const field = document.createElement("input");
        field.type = "text";
        field.readOnly = true;
        field.dataset.bindingKind = kind;
        field.dataset.input = String(input);
        field.setAttribute("aria-label", `${kind === "keyboard" ? "Tecla" : "Botão"} para ${this.labels[input]}`);
        const value = this.owner.guestBindings[kind][input];
        field.value = kind === "keyboard" ? this.keyLabel(value) : this.padLabel(value);
        cell.append(field);
        row.append(cell);
      }
      const action = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.input = String(input);
      button.textContent = "Definir";
      button.setAttribute("aria-label", `Definir ${this.labels[input]}`);
      action.append(button);
      row.append(action);
      return row;
    });
    this.owner.guestBindingsBody.replaceChildren(...rows);
  }

  pressedBindings() {
    const pad = this.selectedGamepad();
    const pressed = new Set();
    pad?.buttons?.forEach((button, index) => {
      if (button.pressed || button.value > 0.5) pressed.add(index);
    });
    pad?.axes?.forEach((value, axis) => {
      if (Math.abs(value) > 0.5) pressed.add(`axis:${axis}:${value < 0 ? -1 : 1}`);
    });
    return pressed;
  }

  pollControllers() {
    if (!this.dialog.open) return;
    const pads = this.gamepads();
    const signature = JSON.stringify(pads.map((pad) => [pad.index ?? 0, pad.id]));
    if (signature !== this.padSignature) {
      this.padSignature = signature;
      const none = new Option("Not Connected", "none");
      this.gamepadSelect.replaceChildren(none, ...pads.map((pad) => new Option(pad.id, String(pad.index ?? 0))));
      this.gamepadSelect.value = this.selection === "auto" ? (pads.length ? String(pads[0].index ?? 0) : "none") : this.selection;
      if (!this.gamepadSelect.value) this.gamepadSelect.value = "none";
    }
    const pressed = this.pressedBindings();
    if (this.capturing && this.capturing.kind !== "keyboard") {
      const next = [...pressed].find((binding) => !this.previousPressed.has(binding));
      if (next !== undefined) this.assign("gamepad", next);
    }
    this.previousPressed = pressed;
    this.frame = requestAnimationFrame(() => this.pollControllers());
  }

  beginCapture(input, kind) {
    this.capturing = { input, kind };
    this.previousPressed = this.pressedBindings();
    this.capture.hidden = false;
    document.querySelector("#guest-binding-prompt").textContent = `[ ${this.labels[input]} ]\nPressione ${kind === "keyboard" ? "uma tecla" : kind === "gamepad" ? "um botão do controle" : "uma tecla ou um botão do controle"}.`;
    document.querySelector("#guest-binding-cancel").focus({ preventScroll: true });
  }

  cancelCapture(restoreFocus = true) {
    if (!this.capturing) return;
    const input = this.capturing.input;
    this.capturing = null;
    this.capture.hidden = true;
    if (restoreFocus) this.owner.guestBindingsBody.querySelector(`button[data-input="${input}"]`)?.focus({ preventScroll: true });
  }

  assign(kind, value) {
    this.selectedGamepad();
    if (!this.capturing) return;
    const input = this.capturing.input;
    const empty = kind === "keyboard" ? "" : -1;
    this.owner.guestBindings[kind] = this.owner.guestBindings[kind].map((current, index) => index !== input && current === value ? empty : current);
    this.owner.guestBindings[kind][input] = value;
    this.saveBindings();
    this.cancelCapture();
  }

  saveBindings() {
    this.owner.applyGuestBindings();
  }

  clearBinding() {
    const { input } = this.capturing;
    this.owner.guestBindings.keyboard[input] = "";
    this.owner.guestBindings.gamepad[input] = -1;
    this.saveBindings();
    this.cancelCapture();
  }

  clearBindings() {
    this.owner.guestBindings.keyboard.fill("");
    this.owner.guestBindings.gamepad.fill(-1);
    this.saveBindings();
  }

  onKey(event) {
    if (!this.dialog.open) {
      if (event.key === "F11" && !this.owner.guestFullscreenButton.disabled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) void this.owner.toggleGuestFullscreen();
      }
      return;
    }
    // Configuration keystrokes must never reach the remote game.
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.capturing) this.cancelCapture();
      else this.closeControls();
    } else if (this.capturing && this.capturing.kind !== "gamepad") {
      event.preventDefault();
      if (!event.repeat && event.code) this.assign("keyboard", event.code);
    } else if (event.key === "Tab") {
      const scope = this.capture.hidden ? this.dialog : this.capture;
      const focusable = [...scope.querySelectorAll("button, select, input")].filter((el) => !el.disabled && el.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
};
