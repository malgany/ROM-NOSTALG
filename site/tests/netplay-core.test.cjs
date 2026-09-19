"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../netplay-core.js");

test("parses only complete, plausible invitation fragments", () => {
  assert.deepEqual(
    core.parseInviteHash("#room=abcdefgh_123&token=abcdefghijklmnopqrstuvwx-123"),
    { roomId: "abcdefgh_123", token: "abcdefghijklmnopqrstuvwx-123" },
  );
  assert.equal(core.parseInviteHash("#room=short&token=abcdefghijklmnopqrstuvwx"), null);
  assert.equal(core.parseInviteHash("#room=abcdefgh&token=tiny"), null);
  assert.equal(core.parseInviteHash("#room=abcdefgh"), null);
});

test("builds an invitation without putting the token in the request URL", () => {
  const invite = new URL(core.buildInviteUrl(
    "https://example.com/rom/?theme=dark#old",
    "room_12345678",
    "token_abcdefghijklmnopqrstuvwxyz",
  ));

  assert.equal(invite.origin + invite.pathname + invite.search, "https://example.com/rom/?theme=dark");
  assert.equal(invite.hash, "#room=room_12345678&token=token_abcdefghijklmnopqrstuvwxyz");
});

test("extracts the Worker's structured API error without stringifying the object", () => {
  assert.deepEqual(core.apiErrorDetails({
    error: { code: "turnstile_rejected", message: "Verificação Turnstile recusada." },
  }, 403), {
    code: "turnstile_rejected",
    message: "Verificação Turnstile recusada.",
  });
});

test("keeps compatibility with flat and legacy API errors", () => {
  assert.deepEqual(core.apiErrorDetails({ code: "room_full", message: "Sala cheia." }, 409), {
    code: "room_full",
    message: "Sala cheia.",
  });
  assert.deepEqual(core.apiErrorDetails({ error: "Falha antiga." }, 502), {
    code: "http_502",
    message: "Falha antiga.",
  });
});

test("matches EmulatorJS keyboard defaults and composes simultaneous inputs", () => {
  const mask = core.maskFromKeyboardCodes(new Set(["ArrowUp", "KeyX", "KeyQ"]));
  assert.equal(mask, (1 << 4) | (1 << 0) | (1 << 10));
});

test("maps standard gamepad face buttons, shoulders and d-pad", () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  buttons[0] = { pressed: true, value: 1 };
  buttons[5] = { pressed: true, value: 1 };
  buttons[14] = { pressed: true, value: 1 };

  assert.equal(
    core.maskFromGamepad({ buttons, axes: [0, 0] }),
    (1 << 0) | (1 << 11) | (1 << 6),
  );
});

test("respects guest stick remapping and clears analog input without changing host defaults", () => {
  const pad = { buttons: [], axes: [-0.8, 0.9] };
  assert.equal(core.maskFromGamepad(pad), (1 << 6) | (1 << 5));
  assert.equal(core.maskFromGamepad(pad, {}, {}), 0);
  assert.equal(core.maskFromGamepad(pad, {}, { "axis:0:-1": 8, "axis:1:1": 0 }), (1 << 8) | 1);
  assert.equal(core.maskFromGamepad({ buttons: [], axes: [0.1, 0.2] }, {}, { "axis:0:1": 8 }), 0);
});

test("reports every press and release between complete masks", () => {
  assert.deepEqual(core.diffInputMasks((1 << 0) | (1 << 4), (1 << 4) | (1 << 8)), [
    { code: 0, value: 0 },
    { code: 8, value: 1 },
  ]);
});

test("releases every Player 2 button when EmulatorJS input throws", () => {
  const calls = [];
  let failed = false;
  const simulateInput = (player, code, value) => {
    calls.push({ player, code, value });
    if (!failed && code === 1 && value === 1) {
      failed = true;
      throw new Error("internal API failure");
    }
  };

  const result = core.applyInputMaskSafely(0, (1 << 0) | (1 << 1), simulateInput);
  assert.equal(result.ok, false);
  assert.equal(result.mask, 0);
  assert.deepEqual(calls.slice(0, 2), [
    { player: 1, code: 0, value: 1 },
    { player: 1, code: 1, value: 1 },
  ]);
  assert.deepEqual(
    calls.slice(2).map(({ player, code, value }) => [player, code, value]),
    Array.from({ length: core.INPUT_COUNT }, (_, code) => [1, code, 0]),
  );
});

test("validates packets and handles uint32 sequence wraparound", () => {
  assert.deepEqual(core.normalizeInputPacket({ type: "input", seq: 7, mask: 4095 }), {
    type: "input",
    seq: 7,
    mask: 4095,
  });
  assert.equal(core.normalizeInputPacket({ type: "input", seq: -1, mask: 0 }), null);
  assert.equal(core.normalizeInputPacket({ type: "input", seq: 1, mask: 4096 }), null);
  assert.equal(core.isNewerSequence(0, 0xffff_ffff), true);
  assert.equal(core.isNewerSequence(9, 9), false);
  assert.equal(core.isNewerSequence(8, 9), false);
});
