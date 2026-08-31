const { test } = require("node:test");
const assert = require("node:assert/strict");
const profiles = require("../control-profiles.js");
const ps4 = { id: "DualShock 4 (Vendor: 054c Product: 09cc)", mapping: "standard", index: 0 };
const xbox = { id: "Xbox Wireless Controller", mapping: "standard", index: 0 };
function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("profiles follow the model across connection slots without mixing PS4 and Xbox", () => {
  const storage = memory();
  const store = new profiles.Store(() => storage);
  store.saveKeyboard({ 8: "KeyC" });
  store.saveGamepad(ps4, { 8: "BUTTON_4" });
  assert.equal(store.gamepad(xbox), null);
  store.saveGamepad(xbox, { 8: "LEFT_TOP_SHOULDER" });
  const nextGame = new profiles.Store(() => storage);
  assert.equal(nextGame.keyboard()[8], "KeyC");
  assert.equal(nextGame.gamepad({ ...ps4, index: 3 })[8], "BUTTON_4");
  assert.equal(nextGame.gamepad(xbox)[8], "LEFT_TOP_SHOULDER");
  assert.equal(nextGame.gamepad({ ...ps4, mapping: "" }), null);
  nextGame.saveGamepad(null, { 8: "BUTTON_1" });
  assert.equal(Object.keys(nextGame.data.gamepads).length, 2);
});

test("partial guest edits retain host shortcuts, explicit clears, other models and tab edits", () => {
  const storage = memory();
  const first = new profiles.Store(() => storage);
  const second = new profiles.Store(() => storage);
  first.saveKeyboard({ 8: "KeyC", 24: "F5" });
  second.saveGamepad(xbox, { 8: "BUTTON_4" });
  first.saveGamepad(ps4, { 8: "", 24: "BUTTON_12" });
  second.saveKeyboard({ 8: "" });
  first.reload();
  assert.deepEqual(first.keyboard(), { 8: "", 24: "F5" });
  assert.equal(first.gamepad(ps4)[8], "");
  assert.equal(first.gamepad(ps4)[24], "BUTTON_12");
  assert.equal(first.gamepad(xbox)[8], "BUTTON_4");
});

test("bad data and unavailable storage fall back safely without losing session changes", () => {
  const storage = memory();
  storage.setItem(profiles.STORAGE_KEY, "broken JSON");
  const store = new profiles.Store(() => storage);
  assert.equal(store.keyboard(), null);
  storage.setItem(profiles.STORAGE_KEY, "null");
  storage.setItem = () => { throw new Error("quota exceeded"); };
  store.saveKeyboard({ 8: "KeyC" });
  store.saveGamepad(ps4, { 8: "BUTTON_4" });
  store.saveGamepad(xbox, { 8: "BUTTON_1" });
  assert.equal(store.keyboard()[8], "KeyC");
  assert.equal(store.gamepad(ps4)[8], "BUTTON_4");
  const denied = new profiles.Store(() => { throw new Error("SecurityError"); });
  denied.saveKeyboard({ 8: "KeyZ" });
  denied.saveGamepad(ps4, { 8: "BUTTON_2" });
  assert.equal(denied.keyboard()[8], "KeyZ");
  assert.equal(denied.gamepad(ps4)[8], "BUTTON_2");
});

test("host and guest share keyboard, standard buttons, axes and empty bindings", () => {
  for (const code of ["KeyC", "Digit5", "F5", "ArrowLeft", "Numpad1", "Semicolon"]) {
    assert.equal(profiles.fromHostKey(profiles.toHostKey(code)), code);
  }
  assert.equal(profiles.fromHostKey(0), "");
  assert.equal(profiles.toHostKey(""), 0);
  assert.equal(profiles.fromGuestPad(18), "GAMEPAD_18");
  assert.equal(profiles.fromGuestPad("axis:5:1"), "EXTRA_STICK_5:+1");
  for (const button of [-1, 0, 1, 5, 8, 12, 15, 18, "axis:0:1", "axis:3:-1", "axis:5:1"]) {
    assert.equal(profiles.toGuestPad(profiles.fromGuestPad(button)), button);
  }
});
