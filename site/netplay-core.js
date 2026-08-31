(function initNetplayCore(root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ROMNostalgNetplayCore = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  const INPUT_COUNT = 12;
  const ALL_INPUTS_MASK = (1 << INPUT_COUNT) - 1;
  const MAX_SEQUENCE = 0xffff_ffff;

  // These are EmulatorJS 4.2.3's default SNES keyboard bindings. The mask bit
  // intentionally matches the input code consumed by simulateInput().
  const KEYBOARD_CODE_TO_INPUT = Object.freeze({
    KeyX: 0, // B
    KeyS: 1, // Y
    KeyV: 2, // Select
    Enter: 3, // Start
    ArrowUp: 4,
    ArrowDown: 5,
    ArrowLeft: 6,
    ArrowRight: 7,
    KeyZ: 8, // A
    KeyA: 9, // X
    KeyQ: 10, // L
    KeyE: 11, // R
  });

  // Physical positions, not Xbox letters: bottom=B, right=A, left=Y, top=X.
  // These indices are positional when Gamepad.mapping === "standard".
  const GAMEPAD_BUTTON_TO_INPUT = Object.freeze({
    0: 0, // Bottom -> B
    1: 8, // Right -> A
    2: 1, // Left -> Y
    3: 9, // Top -> X
    4: 10, // L
    5: 11, // R
    8: 2, // Select
    9: 3, // Start
    12: 4, // Up
    13: 5, // Down
    14: 6, // Left
    15: 7, // Right
  });

  function createEmulatorControls() {
    // EmulatorJS 4.2.3 replaces the entire default map, so keep its keyboard,
    // shoulder, stick and shortcut bindings when overriding the face buttons.
    const keyboard = [
      "x", "s", "v", "enter", "up arrow", "down arrow", "left arrow", "right arrow",
      "z", "a", "q", "e", "tab", "r", "", "", "h", "f", "g", "t", "l", "j", "k", "i",
      "1", "2", "3",
    ];
    const gamepad = [
      "BUTTON_1", "BUTTON_3", "SELECT", "START", "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT",
      "BUTTON_2", "BUTTON_4", "LEFT_TOP_SHOULDER", "RIGHT_TOP_SHOULDER",
      "LEFT_BOTTOM_SHOULDER", "RIGHT_BOTTOM_SHOULDER", "LEFT_STICK", "RIGHT_STICK",
      "LEFT_STICK_X:+1", "LEFT_STICK_X:-1", "LEFT_STICK_Y:+1", "LEFT_STICK_Y:-1",
      "RIGHT_STICK_X:+1", "RIGHT_STICK_X:-1", "RIGHT_STICK_Y:+1", "RIGHT_STICK_Y:-1",
    ];
    const playerOne = Object.fromEntries(Array.from({ length: 30 }, (_, input) => [input, {
      ...(input < keyboard.length ? { value: keyboard[input] } : {}),
      ...(input < gamepad.length ? { value2: gamepad[input] } : {}),
    }]));
    return { 0: playerOne, 1: {}, 2: {}, 3: {} };
  }

  function parseInviteHash(hash) {
    if (typeof hash !== "string" || hash.length < 2) {
      return null;
    }

    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const roomId = params.get("room") || "";
    const token = params.get("token") || "";

    if (!/^[A-Za-z0-9_-]{8,128}$/.test(roomId)
      || !/^[A-Za-z0-9._~-]{20,256}$/.test(token)) {
      return null;
    }

    return Object.freeze({ roomId, token });
  }

  function buildInviteUrl(currentUrl, roomId, token) {
    const url = new URL(currentUrl);
    url.hash = new URLSearchParams({ room: roomId, token }).toString();
    return url.toString();
  }

  function apiErrorDetails(payload, status = 0) {
    const isObject = payload && typeof payload === "object" && !Array.isArray(payload);
    const nestedError = isObject
      && payload.error
      && typeof payload.error === "object"
      && !Array.isArray(payload.error)
      ? payload.error
      : null;
    const legacyErrorMessage = isObject && typeof payload.error === "string"
      ? payload.error
      : "";
    const code = typeof nestedError?.code === "string" && nestedError.code
      ? nestedError.code
      : typeof payload?.code === "string" && payload.code
        ? payload.code
        : status > 0
          ? `http_${status}`
          : "request_failed";
    const message = typeof nestedError?.message === "string" && nestedError.message
      ? nestedError.message
      : typeof payload?.message === "string" && payload.message
        ? payload.message
        : legacyErrorMessage || "O serviço multiplayer recusou a solicitação.";

    return { code, message };
  }

  function inputBit(inputCode) {
    return 1 << inputCode;
  }

  function maskFromKeyboardCodes(codes, keyboardCodeToInput = KEYBOARD_CODE_TO_INPUT) {
    let mask = 0;

    for (const code of codes || []) {
      const inputCode = keyboardCodeToInput?.[code];
      if (Number.isInteger(inputCode)) {
        mask |= inputBit(inputCode);
      }
    }

    return mask & ALL_INPUTS_MASK;
  }

  function gamepadButtonPressed(button) {
    return Boolean(button && (button.pressed || Number(button.value) > 0.5));
  }

  function maskFromGamepad(gamepad, gamepadButtonToInput = GAMEPAD_BUTTON_TO_INPUT, axisToInput) {
    if (!gamepad) {
      return 0;
    }

    let mask = 0;
    const buttons = gamepad.buttons || [];

    for (const [buttonIndex, inputCode] of Object.entries(gamepadButtonToInput || {})) {
      if (gamepadButtonPressed(buttons[Number(buttonIndex)])) {
        mask |= inputBit(inputCode);
      }
    }

    // Some otherwise-standard controllers expose only axes for the d-pad.
    const axes = axisToInput || { "axis:0:-1": 6, "axis:0:1": 7, "axis:1:-1": 4, "axis:1:1": 5 };
    for (const [binding, input] of Object.entries(axes)) {
      const [, axis, sign] = binding.split(":");
      if ((Number(gamepad.axes?.[Number(axis)]) || 0) * Number(sign) > 0.5) mask |= inputBit(input);
    }

    return mask & ALL_INPUTS_MASK;
  }

  function diffInputMasks(previousMask, nextMask) {
    const previous = previousMask & ALL_INPUTS_MASK;
    const next = nextMask & ALL_INPUTS_MASK;
    const changed = previous ^ next;
    const changes = [];

    for (let code = 0; code < INPUT_COUNT; code += 1) {
      const bit = inputBit(code);
      if (changed & bit) {
        changes.push({ code, value: next & bit ? 1 : 0 });
      }
    }

    return changes;
  }

  function releaseAllInputsSafely(simulateInput, playerIndex = 1) {
    if (typeof simulateInput !== "function") {
      return { ok: false, error: new TypeError("simulateInput is unavailable") };
    }

    let firstError = null;
    for (let code = 0; code < INPUT_COUNT; code += 1) {
      try {
        simulateInput(playerIndex, code, 0);
      } catch (error) {
        firstError ||= error;
      }
    }
    return { ok: firstError === null, error: firstError };
  }

  function applyInputMaskSafely(previousMask, nextMask, simulateInput, playerIndex = 1) {
    if (typeof simulateInput !== "function") {
      return { ok: false, mask: 0, error: new TypeError("simulateInput is unavailable") };
    }

    let appliedMask = previousMask & ALL_INPUTS_MASK;
    try {
      for (const change of diffInputMasks(appliedMask, nextMask)) {
        simulateInput(playerIndex, change.code, change.value);
        const bit = inputBit(change.code);
        appliedMask = change.value ? appliedMask | bit : appliedMask & ~bit;
      }
      return { ok: true, mask: nextMask & ALL_INPUTS_MASK, error: null };
    } catch (error) {
      releaseAllInputsSafely(simulateInput, playerIndex);
      return { ok: false, mask: 0, error };
    }
  }

  function createInputPacket(sequence, mask) {
    return {
      type: "input",
      seq: sequence >>> 0,
      mask: mask & ALL_INPUTS_MASK,
    };
  }

  function normalizeInputPacket(value) {
    if (!value || value.type !== "input"
      || !Number.isInteger(value.seq) || value.seq < 0 || value.seq > MAX_SEQUENCE
      || !Number.isInteger(value.mask) || value.mask < 0 || value.mask > ALL_INPUTS_MASK) {
      return null;
    }

    return createInputPacket(value.seq, value.mask);
  }

  function isNewerSequence(nextSequence, previousSequence) {
    if (!Number.isInteger(previousSequence)) {
      return true;
    }

    const distance = (nextSequence - previousSequence) >>> 0;
    return distance > 0 && distance < 0x8000_0000;
  }

  return Object.freeze({
    ALL_INPUTS_MASK,
    GAMEPAD_BUTTON_TO_INPUT,
    INPUT_COUNT,
    KEYBOARD_CODE_TO_INPUT,
    applyInputMaskSafely,
    apiErrorDetails,
    buildInviteUrl,
    createEmulatorControls,
    createInputPacket,
    diffInputMasks,
    isNewerSequence,
    maskFromGamepad,
    maskFromKeyboardCodes,
    normalizeInputPacket,
    parseInviteHash,
    releaseAllInputsSafely,
  });
}));
