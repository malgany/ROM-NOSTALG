const { test, expect } = require("@playwright/test");
const PS4 = { id: "DualShock 4 (Vendor: 054c Product: 09cc)", mapping: "standard", index: 0 };
const XBOX = { id: "Xbox Wireless Controller", mapping: "standard", index: 0 };

// Exercise the app's real game-start/save/load hooks without loading a ROM.
async function mountHost(page, name, pads, selection = [0], stale = false) {
  await page.evaluate(({ name, pads, selection, stale }) => {
    configureEmulator(new File([new Uint8Array([0])], `${name}.sfc`));
    window.__profilePads = pads.map((pad) => ({ ...pad, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) }));
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => window.__profilePads });
    const controls = structuredClone(window.EJS_defaultControls);
    if (stale) controls[0][8] = { value: 87, value2: "BUTTON_10" };
    window.EJS_emulator = {
      controls, defaultControllers: structuredClone(window.EJS_defaultControls),
      gamepadSelection: Array.from({ length: 4 }, (_, player) => {
        const pad = window.__profilePads.find((pad) => pad.index === selection[player]);
        return pad ? `${pad.id}_${pad.index}` : "";
      }),
      settings: { shader: "crt" }, cheats: ["synthetic-cheat"],
      gameManager: { simulateInput() {} },
      checkGamepadInputs() {}, updateGamepadLabels() {},
      getLocalStorageKey: () => `ejs-profile-${name}-settings`,
      saveSettings() {
        localStorage.setItem(this.getLocalStorageKey(), JSON.stringify({
          controlSettings: this.controls, settings: this.settings, cheats: this.cheats,
        }));
      },
      loadSettings() {
        const saved = JSON.parse(localStorage.getItem(this.getLocalStorageKey()));
        this.controls = saved.controlSettings;
        this.settings = saved.settings;
        this.cheats = saved.cheats;
      },
    };
    window.EJS_onGameStart();
  }, { name, pads, selection, stale });
}

test("host mantém teclado entre jogos e perfis separados por gamepad, sem alterar outras opções", async ({ page, baseURL }) => {
  await page.goto(baseURL);
  await mountHost(page, "first", [PS4]);
  await page.evaluate(() => {
    const emulator = window.EJS_emulator;
    emulator.saveSettings(); // Saving audio/options must not create a custom map.
    window.__beforeProfile = localStorage.getItem("rom-nostalg.control-profiles.v1");
    emulator.controls[0][8] = { value: 53, value2: "LEFT_BOTTOM_SHOULDER" };
    emulator.saveSettings();
  });
  expect(await page.evaluate(() => window.__beforeProfile)).toBeNull();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ejs-profile-first-settings")));
  expect(stored.settings).toEqual({ shader: "crt" });
  expect(stored.cheats).toEqual(["synthetic-cheat"]);

  await page.goto(`${baseURL}/?game=second`);
  await mountHost(page, "second", [XBOX], [0], true);
  expect(await page.evaluate(() => window.EJS_emulator.controls[0][8]))
    .toEqual({ value: 53, value2: "BUTTON_2" });
  await page.evaluate(() => {
    window.EJS_emulator.controls[0][8].value2 = "RIGHT_BOTTOM_SHOULDER";
    window.EJS_emulator.saveSettings();
  });

  await page.goto(`${baseURL}/?game=third`);
  await mountHost(page, "third", [{ ...PS4, index: 3 }, XBOX], [3, 0], true);
  expect(await page.evaluate(() => [window.EJS_emulator.controls[0][8], window.EJS_emulator.controls[1][8]]))
    .toEqual([{ value: 53, value2: "LEFT_BOTTOM_SHOULDER" }, { value: 0, value2: "RIGHT_BOTTOM_SHOULDER" }]);
  // Move both models between player slots; profiles follow hardware, keyboards stay with the player.
  await page.evaluate(() => {
    const emulator = window.EJS_emulator;
    [emulator.gamepadSelection[0], emulator.gamepadSelection[1]] = [emulator.gamepadSelection[1], emulator.gamepadSelection[0]];
    emulator.updateGamepadLabels();
  });
  expect(await page.evaluate(() => [window.EJS_emulator.controls[0][8], window.EJS_emulator.controls[1][8]]))
    .toEqual([{ value: 53, value2: "RIGHT_BOTTOM_SHOULDER" }, { value: 0, value2: "LEFT_BOTTOM_SHOULDER" }]);

  // Clear only the plugged PS4 in another game; the unplugged Xbox profile survives.
  await page.goto(`${baseURL}/?game=fourth`);
  await mountHost(page, "fourth", [PS4]);
  await page.evaluate(() => {
    window.EJS_emulator.controls = { 0: {}, 1: {}, 2: {}, 3: {} };
    window.EJS_emulator.saveSettings();
    window.EJS_emulator.loadSettings();
  });
  expect(await page.evaluate(() => window.EJS_emulator.controls[0][8])).toEqual({ value: 0, value2: "" });
  await page.goto(`${baseURL}/?game=fifth`);
  await mountHost(page, "fifth", [XBOX]);
  expect(await page.evaluate(() => window.EJS_emulator.controls[0][8])).toEqual({ value: 0, value2: "RIGHT_BOTTOM_SHOULDER" });

  // The original Reset operation must restore a usable default even in slot 2.
  await mountHost(page, "reset", [XBOX], [undefined, 0]);
  await page.evaluate(() => {
    window.EJS_emulator.controls = structuredClone(window.EJS_defaultControls);
    window.EJS_emulator.saveSettings();
  });
  expect(await page.evaluate(() => window.EJS_emulator.controls[1][8])).toEqual({ value: 0, value2: "BUTTON_2" });
});

test("convidado reutiliza perfis do host, troca de controle e devolve suas edições ao próximo jogo", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors = [];
  guest.on("pageerror", (error) => errors.push(error.message));
  const mask = (expected) => expect.poll(() => host.evaluate(() => window.ROMNostalgNetplay.hostSession.remoteMask)).toBe(expected);
  try {
    await guest.goto(baseURL);
    await mountHost(guest, "before-invite", [PS4]);
    await guest.evaluate(() => {
      window.EJS_emulator.controls[0][8] = { value: 53, value2: "LEFT_BOTTOM_SHOULDER" };
      window.EJS_emulator.saveSettings();
    });
    await guest.addInitScript((pad) => {
      window.__profilePads = [{ ...pad, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) }];
      Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => window.__profilePads });
    }, PS4);
    await host.goto(`${baseURL}/__test-host`);
    await host.locator("#multiplayer-button").click();
    await expect(host.locator("#create-room-button")).toBeEnabled();
    await host.locator("#create-room-button").click();
    await expect(host.locator("#invite-link")).toHaveValue(/#room=testroom_1234/);
    await guest.goto(await host.locator("#invite-link").inputValue());
    await guest.locator("#guest-enter-button").click();
    await expect(guest.locator("#guest-status")).toHaveText("Conectado ao jogo");
    await guest.keyboard.down("5");
    await mask(1 << 8);
    await guest.keyboard.up("5");
    await mask(0);
    await guest.evaluate(() => { window.__profilePads[0].buttons[6] = { pressed: true, value: 1 }; });
    await mask(1 << 8);
    // Swap to a new model at the same index, with an old PS4-specific button held.
    await guest.evaluate((pad) => { Object.assign(window.__profilePads[0], pad); }, XBOX);
    await mask(0);
    await guest.evaluate(() => {
      window.__profilePads[0].buttons[6] = { pressed: false, value: 0 };
      window.__profilePads[0].buttons[1] = { pressed: true, value: 1 };
    });
    await mask(1 << 8); // Xbox has its default A until configured.
    await guest.evaluate(() => { window.__profilePads[0].buttons[1] = { pressed: false, value: 0 }; });
    await mask(0);

    await guest.locator("#guest-stage").click({ position: { x: 20, y: 20 } });
    await guest.locator("#guest-controls-button").click();
    await guest.getByRole("button", { name: "Definir A", exact: true }).click();
    await guest.keyboard.press("c");
    await guest.locator('input[data-binding-kind="gamepad"][data-input="8"]').click();
    await guest.evaluate(() => { window.__profilePads[0].buttons[7] = { pressed: true, value: 1 }; });
    await expect(guest.locator('input[data-binding-kind="gamepad"][data-input="8"]')).toHaveValue("RIGHT_BOTTOM_SHOULDER");
    await guest.evaluate(() => { window.__profilePads[0].buttons[7] = { pressed: false, value: 0 }; });
    await guest.locator("#guest-controls-close").click();
    await guest.keyboard.down("c");
    await mask(1 << 8);
    // Reconnect the PS4 at a different index while the shared keyboard is held.
    await guest.evaluate((pad) => { Object.assign(window.__profilePads[0], pad, { index: 3 }); }, PS4);
    await mask(1 << 8);
    await guest.keyboard.up("c");
    await mask(0);
    await guest.evaluate(() => { window.__profilePads[0].buttons[6] = { pressed: true, value: 1 }; });
    await mask(1 << 8);
    await guest.goto(`${baseURL}/?game=after-invite`);
    await mountHost(guest, "after-invite", [{ ...PS4, index: 2 }, XBOX], [2, 0], true);
    expect(await guest.evaluate(() => [window.EJS_emulator.controls[0][8], window.EJS_emulator.controls[1][8]]))
      .toEqual([{ value: 67, value2: "LEFT_BOTTOM_SHOULDER" }, { value: 0, value2: "RIGHT_BOTTOM_SHOULDER" }]);
    expect(errors).toEqual([]);
  } finally { await Promise.allSettled([hostContext.close(), guestContext.close()]); }
});
