const { test, expect } = require("@playwright/test");

async function showGuestMenu(page) {
  await page.locator("#guest-stage").click({ position: { x: 20, y: 20 } });
  await expect(page.locator("#guest-player-toolbar")).not.toHaveClass(/is-hidden/);
}

async function waitForSimulatedInput(page, expected) {
  await expect.poll(() => page.evaluate((target) => (
    window.__e2eSimulatedInputs.some((input) => (
      input.player === target.player
      && input.code === target.code
      && input.value === target.value
    ))
  ), expected)).toBe(true);
}

async function installTurnstileMock(context) {
  await context.addInitScript(() => {
    window.turnstile = {
      render(_selector, options) {
        window.setTimeout(() => options.callback("e2e-turnstile-token"), 0);
        return "e2e-widget";
      },
      reset() {},
    };
  });
}

async function verifyFaceButtons(host, guest) {
  // W3C physical order: bottom, right, left, top -> SNES B, A, Y, X.
  for (const [button, code] of [[0, 0], [1, 8], [2, 1], [3, 9]]) {
    await host.evaluate(() => { window.__e2eSimulatedInputs = []; });
    await guest.evaluate((index) => {
      window.__e2eGamepad.buttons[index] = { pressed: true, value: 1 };
    }, button);
    await waitForSimulatedInput(host, { player: 1, code, value: 1 });
    expect(await host.evaluate(() => window.__e2eSimulatedInputs.filter((input) => input.value === 1)))
      .toEqual([expect.objectContaining({ player: 1, code, value: 1 })]);
    await guest.evaluate((index) => {
      window.__e2eGamepad.buttons[index] = { pressed: false, value: 0 };
    }, button);
    await waitForSimulatedInput(host, { player: 1, code, value: 0 });
  }
}

test("corrige o padrão local salvo uma vez e preserva controles personalizados", async ({ page, baseURL }) => {
  await page.goto(baseURL);
  const result = await page.evaluate(() => {
    configureEmulator(new File([new Uint8Array([0])], "controller-test.sfc"));
    const defaults = structuredClone(window.EJS_defaultControls);
    const legacy = { 0: "BUTTON_2", 1: "BUTTON_4", 8: "BUTTON_1", 9: "BUTTON_3" };
    const controls = structuredClone(defaults);
    for (const [input, value] of Object.entries(legacy)) controls[0][input].value2 = value;
    controls[0][0].value = 67; // Existing customized keyboard key.
    controls[0][10].value2 = "LEFT_BOTTOM_SHOULDER";
    controls[1] = structuredClone(controls[0]);
    controls[1][0].value2 = "BUTTON_4"; // Customized face quartet must survive.
    const before = structuredClone(controls);
    window.EJS_emulator = {
      controls,
      getLocalStorageKey: () => "ejs-controller-test-settings",
      checkGamepadInputs() {},
      saveSettings() { localStorage.setItem(this.getLocalStorageKey(), JSON.stringify(this.controls)); },
    };
    window.EJS_onGameStart();
    const after = structuredClone(controls);
    const persisted = JSON.parse(localStorage.getItem("ejs-controller-test-settings"));
    // A later deliberate choice of the old layout must not be migrated again.
    for (const [input, value] of Object.entries(legacy)) controls[0][input].value2 = value;
    window.EJS_onGameStart();
    return { defaults, before, after, persisted, second: structuredClone(controls) };
  });
  const face = (bindings) => [0, 8, 1, 9].map((input) => bindings[input].value2);
  expect(face(result.defaults[0])).toEqual(["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4"]);
  expect(face(result.after[0])).toEqual(face(result.defaults[0]));
  expect(result.persisted).toEqual(result.after);
  expect(result.after[1]).toEqual(result.before[1]);
  expect(result.second).toEqual(result.before);
  for (const input of Object.keys(result.before[0])) {
    expect(result.after[0][input].value).toBe(result.before[0][input].value);
    if (!["0", "1", "8", "9"].includes(input)) {
      expect(result.after[0][input]).toEqual(result.before[0][input]);
    }
  }
});

for (const scenario of ["legacy", "custom", "current"]) {
  test(`migra teclado e preserva backup sem atribuir gamepad legado ${scenario}`, async ({ page, baseURL }) => {
    const stored = {
      keyboard: ["KeyC", "KeyS", "KeyV", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyZ", "KeyA", "KeyQ", "KeyE"],
      gamepad: [1, 3, 8, 9, 12, 13, 14, 15, 0, 2, 6, 5],
      ...(scenario === "current" ? { layoutVersion: 2 } : {}),
    };
    if (scenario === "custom") stored.gamepad[0] = 7;
    await page.addInitScript((bindings) => {
      localStorage.setItem("rom-nostalg-guest-bindings-v1", JSON.stringify(bindings));
    }, stored);
    await page.goto(`${baseURL}/#room=testroom_1234&token=guest-token-abcdefghijklmnopqrstuvwxyz`);
    await showGuestMenu(page);
    await page.locator("#guest-controls-button").click();
    const expected = [0, 2, 8, 9, 12, 13, 14, 15, 1, 3, 4, 5];
    for (const input of [0, 1, 8, 9, 10]) {
      await expect(page.locator(`input[data-binding-kind="gamepad"][data-input="${input}"]`))
        .toHaveValue(["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "LEFT_TOP_SHOULDER", "RIGHT_TOP_SHOULDER", "LEFT_BOTTOM_SHOULDER", "RIGHT_BOTTOM_SHOULDER"][expected[input]]);
    }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("rom-nostalg-guest-bindings-v1"))))
      .toEqual(stored);
    await expect(page.locator('input[data-binding-kind="keyboard"][data-input="0"]')).toHaveValue("c");
    const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem("rom-nostalg.control-profiles.v1")));
    expect(profiles.keyboards[0][0]).toBe("KeyC");
    expect(profiles.gamepads).toEqual({});
  });
}

test("exibe multiplayer somente para jogos do catálogo", async ({ page, baseURL }) => {
  await page.goto(baseURL);
  await page.evaluate(() => {
    document.querySelector("#picker-view").hidden = true;
    document.querySelector("#player-view").hidden = false;
    window.dispatchEvent(new CustomEvent("romnostalg:game-ready", {
      detail: { source: "local" },
    }));
  });

  await expect(page.locator("#multiplayer-button")).toBeHidden();
  await expect(page.locator("#multiplayer-button")).toBeDisabled();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("romnostalg:game-ready", {
      detail: { source: "catalog" },
    }));
  });

  await expect(page.locator("#multiplayer-button")).toBeVisible();
  await expect(page.locator("#multiplayer-button")).toBeEnabled();
});

test("host transmite mídia e recebe o teclado do Player 2", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await Promise.all([
    installTurnstileMock(hostContext),
    installTurnstileMock(guestContext),
  ]);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await host.goto(`${baseURL}/__test-host`);

    await expect(host.locator("#multiplayer-button")).toBeEnabled();
    await host.locator("#multiplayer-button").click();
    await expect(host.locator("#create-room-button")).toBeEnabled();
    await host.locator("#create-room-button").click();

    await expect(host.locator("#invite-link")).toHaveValue(/#room=testroom_1234&token=guest-token-/);
    const invite = await host.locator("#invite-link").inputValue();
    await expect(host.locator("#host-status")).toContainText("Aguardando o Player 2");

    await guest.goto(invite);
    await expect(guest.locator("#guest-view")).toBeVisible();
    await expect(guest.locator("#guest-touch-controls")).toBeHidden();
    await expect(guest.locator("#picker-view")).toBeHidden();
    await expect(guest.locator("#player-view")).toBeHidden();
    await expect(guest.locator("#guest-player-toolbar")).toHaveClass(/is-hidden/);
    await expect(guest.locator("#guest-audio-button")).toBeDisabled();
    await expect(guest.locator("#guest-volume")).toBeDisabled();
    await expect(guest.locator("#guest-fullscreen-button")).toBeDisabled();
    await guest.locator("#guest-enter-button").click();

    await expect(host.locator("#host-status")).toHaveText("Player 2 conectado", { timeout: 20_000 });
    await expect(guest.locator("#guest-status")).toHaveText("Conectado ao jogo", { timeout: 20_000 });
    await expect(guest.locator("#guest-resume-button")).toBeHidden();
    await expect.poll(() => guest.locator("#guest-video").evaluate((video) => ({
      videoTracks: video.srcObject?.getVideoTracks?.().length || 0,
      audioTracks: video.srcObject?.getAudioTracks?.().length || 0,
      readyState: video.readyState,
    }))).toMatchObject({ videoTracks: 1, audioTracks: 1 });
    await expect(guest.locator("#guest-audio-button")).toBeEnabled();
    await expect(guest.locator("#guest-volume")).toBeEnabled();
    await expect(guest.locator("#guest-fullscreen-button")).toBeEnabled();

    await guest.locator("#guest-volume").evaluate((input) => {
      input.value = "0.35";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(() => guest.locator("#guest-video").evaluate((video) => video.volume)).toBe(0.35);
    await showGuestMenu(guest);
    await guest.locator("#guest-audio-button").click();
    await expect(guest.locator("#guest-audio-button")).toHaveAttribute("aria-pressed", "true");
    await showGuestMenu(guest);
    await guest.locator("#guest-audio-button").click();
    await expect(guest.locator("#guest-audio-button")).toHaveAttribute("aria-pressed", "false");

    await guest.evaluate(() => {
      const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
      window.__e2eGamepad = { id: "Xbox Wireless Controller", mapping: "standard", buttons, axes: [0, 0] };
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => window.__e2eGamepad ? [window.__e2eGamepad] : [],
      });
    });
    await expect(guest.locator("#guest-control-state")).toContainText("Controle conectado");
    await expect(guest.locator("#guest-player-help")).toBeVisible();
    await expect(guest.locator("#guest-player-help")).toHaveText(await host.locator(".player-view .player-help").innerText());
    await verifyFaceButtons(host, guest);

    await guest.evaluate(() => {
      window.__e2eGamepad.id = "DualShock 4 Wireless Controller (Vendor: 054c Product: 09cc)";
    });
    await expect(guest.locator("#guest-control-state")).toContainText("DualShock 4");
    await expect(guest.locator("#guest-player-help")).toHaveText(await host.locator(".player-view .player-help").innerText());
    await verifyFaceButtons(host, guest);

    await guest.evaluate(() => {
      window.__e2eGamepad = null;
    });
    await expect(guest.locator("#guest-control-state")).toHaveText("Teclado pronto para o Player 2");
    await expect(guest.locator("#guest-player-help")).toBeVisible();
    await expect(guest.locator("#guest-player-help")).toHaveText(await host.locator(".player-view .player-help").innerText());

    // The default SNES map sends Z as EmulatorJS input 8 (A) for player index 1.
    await guest.keyboard.down("z");
    await waitForSimulatedInput(host, { player: 1, code: 8, value: 1 });
    await guest.keyboard.up("z");
    await waitForSimulatedInput(host, { player: 1, code: 8, value: 0 });

    // The guest toolbar remaps both keyboard keys and physical gamepad buttons.
    await showGuestMenu(guest);
    await guest.locator("#guest-controls-button").click();
    await expect(guest.locator("#guest-controls-dialog")).toBeVisible();
    await guest.getByRole("button", { name: "Definir A", exact: true }).click();
    await guest.keyboard.press("c");
    await expect(guest.locator('input[data-binding-kind="keyboard"][data-input="8"]')).toHaveValue("c");
    await guest.locator('input[data-binding-kind="gamepad"][data-input="8"]').click();
    await guest.evaluate(() => {
      const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
      buttons[2] = { pressed: true, value: 1 };
      window.__e2eGamepad = { id: "Xbox Wireless Controller", index: 0, buttons, axes: [0, 0] };
    });
    await expect(guest.locator("#guest-binding-capture")).toBeHidden();
    await guest.evaluate(() => { window.__e2eGamepad = null; });
    await guest.locator("#guest-controls-close").click();
    await guest.keyboard.down("c");
    await waitForSimulatedInput(host, { player: 1, code: 8, value: 1 });
    await guest.keyboard.up("c");
    await waitForSimulatedInput(host, { player: 1, code: 8, value: 0 });
    await expect.poll(() => guest.evaluate(() => (
      JSON.parse(localStorage.getItem("rom-nostalg.control-profiles.v1")).keyboards[0][8]
    ))).toBe("KeyC");

    await guest.evaluate(() => {
      const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
      buttons[2] = { pressed: true, value: 1 };
      window.__e2eGamepad = { id: "Xbox Wireless Controller", buttons, axes: [0, 0] };
    });
    await waitForSimulatedInput(host, { player: 1, code: 8, value: 1 });
    await guest.evaluate(() => { window.__e2eGamepad = null; });
    await waitForSimulatedInput(host, { player: 1, code: 8, value: 0 });

    // If valid snapshots stop, the host watchdog releases the held button in 500 ms.
    await guest.keyboard.down("x");
    await waitForSimulatedInput(host, { player: 1, code: 0, value: 1 });
    await guest.evaluate(() => {
      const transmitter = window.ROMNostalgNetplay.guestSession.transmitter;
      window.clearInterval(transmitter.snapshotTimer);
      window.cancelAnimationFrame(transmitter.animationFrame);
      transmitter.running = false;
    });
    await waitForSimulatedInput(host, { player: 1, code: 0, value: 0 });

    // The unordered channel may deliver an old packet after the watchdog.
    // It must not reactivate a button whose sequence was already superseded.
    const stalePressesBefore = await host.evaluate(() => (
      window.__e2eSimulatedInputs.filter((input) => input.code === 2 && input.value === 1).length
    ));
    await guest.evaluate(() => {
      window.ROMNostalgNetplay.guestSession.channel.send(JSON.stringify({
        type: "input",
        seq: 0,
        mask: 1 << 2,
      }));
    });
    await guest.waitForTimeout(650);
    await expect.poll(() => host.evaluate(() => (
      window.__e2eSimulatedInputs.filter((input) => input.code === 2 && input.value === 1).length
    ))).toBe(stalePressesBefore);

    // A missing EmulatorJS control API becomes an actionable host state and
    // does not take down signaling or the page.
    await host.evaluate(() => {
      window.__e2eWorkingSimulateInput = window.EJS_emulator.gameManager.simulateInput;
      window.EJS_emulator.gameManager.simulateInput = null;
    });
    await guest.evaluate(() => {
      window.ROMNostalgNetplay.guestSession.channel.send(JSON.stringify({
        type: "input",
        seq: 10_000,
        mask: 1 << 10,
      }));
    });
    await expect(host.locator("#host-status")).toHaveText("A sala precisa de atenção");
    await expect(host.locator("#host-session-error")).toContainText("controles do Player 2");
    await host.evaluate(() => {
      window.EJS_emulator.gameManager.simulateInput = window.__e2eWorkingSimulateInput;
    });

    // A different held button is also released when the guest/data channel disconnects.
    await guest.evaluate(() => {
      window.ROMNostalgNetplay.guestSession.channel.send(JSON.stringify({
        type: "input",
        seq: 10_001,
        mask: 1 << 1,
      }));
    });
    await waitForSimulatedInput(host, { player: 1, code: 1, value: 1 });
    await guest.close();
    await waitForSimulatedInput(host, { player: 1, code: 1, value: 0 });
    await expect(host.locator("#host-status")).toContainText(/saiu|reconectar/i);
  } finally {
    await Promise.allSettled([guestContext.close(), hostContext.close()]);
  }
});

test("convidado no celular controla o Player 2 por toque nas duas orientações", async ({ browser, baseURL }, testInfo) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const cdp = await guestContext.newCDPSession(guest);
  const dpad = guest.locator("#guest-touch-controls .ejs_dpad_main");
  const isDirection = (inputs) => inputs.split(",").every((input) => ["4", "5", "6", "7"].includes(input));
  const button = (inputs) => isDirection(inputs) ? dpad : guest.locator(`[data-touch-inputs="${inputs}"]`);
  const point = async (inputs, id) => {
    const box = await button(inputs).boundingBox();
    const xDirection = inputs.includes("7") ? 1 : inputs.includes("6") ? -1 : 0;
    const yDirection = inputs.includes("5") ? 1 : inputs.includes("4") ? -1 : 0;
    return {
      x: box.x + box.width / 2 + (isDirection(inputs) ? xDirection * box.width * .3 : 0),
      y: box.y + box.height / 2 + (isDirection(inputs) ? yDirection * box.height * .3 : 0), id,
    };
  };
  const touch = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  const resetInputs = () => host.evaluate(() => { window.__e2eSimulatedInputs = []; });
  const expectReleased = (code) => waitForSimulatedInput(host, { player: 1, code, value: 0 });
  const expectPressed = (code) => waitForSimulatedInput(host, { player: 1, code, value: 1 });

  try {
    await installTurnstileMock(hostContext);
    await host.goto(`${baseURL}/__test-host`);
    await host.locator("#multiplayer-button").click();
    await expect(host.locator("#create-room-button")).toBeEnabled();
    await host.locator("#create-room-button").click();
    await expect(host.locator("#invite-link")).toHaveValue(/#room=testroom_1234&token=guest-token-/);
    await guest.goto(await host.locator("#invite-link").inputValue());
    await expect(guest.locator("#guest-touch-controls")).toBeVisible();
    await expect(guest.locator("#guest-player-toolbar")).toBeHidden();
    // The entry button now overlays the center of the video. Tap an uncovered
    // corner so this toolbar check cannot accidentally enter the room first.
    await guest.locator("#guest-video").tap({ position: { x: 12, y: 12 } });
    await expect(guest.locator("#guest-player-toolbar")).toBeHidden();
    await expect(guest.locator("#guest-enter-button")).toBeEnabled();
    await expect(guest.locator("#guest-mobile-fullscreen-button")).toBeVisible();
    await expect(guest.locator("#guest-mobile-fullscreen-button .guest-enter-fullscreen")).toBeVisible();
    await expect(guest.locator("#guest-mobile-fullscreen-button .guest-exit-fullscreen")).toBeHidden();
    await expect(guest.locator("#guest-player-help")).toBeHidden();
    await expect(guest.locator("#guest-touch-help")).toBeVisible();
    expect(await guest.locator("#guest-stage #guest-mobile-fullscreen-button").count()).toBe(0);
    await expect(button("0")).toBeDisabled();
    await guest.locator("#guest-enter-button").tap();
    await expect(guest.locator("#guest-status")).toHaveText("Conectado ao jogo", { timeout: 20_000 });
    await expect(button("0")).toBeEnabled();
    await expect(guest.locator("#guest-control-state")).toContainText("toque");
    await guest.locator("#guest-stage").scrollIntoViewIfNeeded();

    // Portrait keeps every target below the video without horizontal overflow.
    const portrait = await guest.locator("#guest-video").boundingBox();
    expect((await button("10").boundingBox()).y).toBeGreaterThanOrEqual(portrait.y + portrait.height);
    expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    // Original EmulatorJS geometry, colours and Portuguese shoulder labels.
    await expect(dpad).toHaveCSS("width", "125px");
    await expect(dpad).toHaveCSS("height", "125px");
    await expect(button("0")).toHaveCSS("width", "50px");
    await expect(button("0")).toHaveCSS("height", "50px");
    await expect(button("0")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.15)");
    await expect(button("10")).toHaveText("ESQ");
    await expect(button("11")).toHaveText("DIR");
    await expect(button("10")).toHaveCSS("height", "31px");
    await expect(guest.locator("#guest-touch-controls .ejs_virtualGamepad_button")).toHaveCount(8);
    await guest.screenshot({ path: testInfo.outputPath("guest-touch-portrait.png") });

    // Real browser touch events: all SNES inputs reach only player index 1.
    for (const code of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      await resetInputs();
      await touch("touchStart", [await point(String(code), 1)]);
      await touch("touchEnd", []);
      await expectPressed(code);
      await expectReleased(code);
      expect(await host.evaluate(() => window.__e2eSimulatedInputs.filter((input) => input.value === 1)))
        .toEqual([expect.objectContaining({ player: 1, code, value: 1 })]);
    }

    // Two fingers: diagonal + B, slide the direction, then release separately.
    await resetInputs();
    const diagonal = await point("4,7", 1);
    const fire = await point("0", 2);
    await touch("touchStart", [diagonal, fire]);
    for (const code of [4, 7, 0]) await expectPressed(code);
    const left = await point("6", 1);
    await touch("touchMove", [left, fire]);
    await expectPressed(6);
    await expectReleased(4);
    await expectReleased(7);
    await touch("touchEnd", [fire]);
    await expectReleased(0);
    await expect(dpad).toHaveClass(/ejs_dpad_left_pressed/);
    await touch("touchCancel", []);
    await expectReleased(6);
    await expect(dpad).not.toHaveClass(/ejs_dpad_left_pressed/);

    // Two fingers on one original button keep it held until the last release.
    await resetInputs();
    const firstA = await point("8", 1);
    const secondA = { ...await point("8", 2), x: firstA.x + 4 };
    await touch("touchStart", [firstA, secondA]);
    await expectPressed(8);
    await touch("touchEnd", [secondA]);
    await expect(button("8")).toHaveAttribute("aria-pressed", "true");
    expect(await guest.evaluate(() => window.ROMNostalgNetplay.guestSession.transmitter.mask)).toBe(1 << 8);
    await touch("touchCancel", []);
    await expectReleased(8);

    // Touch and keyboard are independent, including release of the same input.
    await resetInputs();
    await guest.keyboard.down("x");
    await expectPressed(0);
    await touch("touchStart", [await point("0", 1)]);
    await guest.keyboard.up("x");
    expect(await guest.evaluate(() => window.ROMNostalgNetplay.guestSession.transmitter.mask)).toBe(1);
    await touch("touchEnd", []);
    await expectReleased(0);

    // Lost focus and orientation changes cannot leave a held button behind.
    await resetInputs();
    await touch("touchStart", [await point("8", 1)]);
    await expectPressed(8);
    await guest.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expectReleased(8);
    await touch("touchEnd", []);
    await resetInputs();
    await touch("touchStart", [await point("0", 1)]);
    await expectPressed(0);
    await guest.setViewportSize({ width: 844, height: 390 });
    await expectReleased(0);
    await touch("touchEnd", []);
    await guest.locator("#guest-stage").scrollIntoViewIfNeeded();
    await expect(guest.locator("#guest-touch-controls")).toBeVisible();
    const landscape = await guest.locator("#guest-video").boundingBox();
    const landscapeButton = await button("0").boundingBox();
    expect(landscapeButton.y + landscapeButton.height).toBeLessThan(landscape.y + landscape.height);
    await guest.screenshot({ path: testInfo.outputPath("guest-touch-landscape.png") });

    // The fullscreen element contains the controls in both orientations.
    await guest.locator("#guest-mobile-fullscreen-button").tap();
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement?.id)).toBe("guest-player-shell");
    await expect(guest.locator("#guest-mobile-fullscreen-button .guest-enter-fullscreen")).toBeHidden();
    await expect(guest.locator("#guest-mobile-fullscreen-button .guest-exit-fullscreen")).toBeVisible();
    await expect(button("0")).toBeInViewport();
    await resetInputs();
    await button("0").tap();
    await expectPressed(0);
    await expectReleased(0);
    await guest.screenshot({ path: testInfo.outputPath("guest-touch-fullscreen.png") });
    // Windows cannot resize the OS window while it is fullscreen.
    await guest.locator("#guest-mobile-fullscreen-button").tap();
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect(guest.locator("#guest-mobile-fullscreen-button .guest-enter-fullscreen")).toBeVisible();
    await expect(guest.locator("#guest-mobile-fullscreen-button .guest-exit-fullscreen")).toBeHidden();
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.locator("#guest-mobile-fullscreen-button").tap();
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement?.id)).toBe("guest-player-shell");
    expect(await guest.evaluate(() => window.matchMedia("(orientation: portrait)").matches)).toBe(true);
    for (const inputs of ["4", "5", "6", "7", "0", "8", "9", "1", "10", "11", "2", "3"]) {
      await expect(button(inputs)).toBeInViewport();
    }
    await guest.screenshot({ path: testInfo.outputPath("guest-touch-fullscreen-portrait.png") });

    // A disconnected controller releases touches and starts neutral on reconnect.
    await resetInputs();
    await touch("touchStart", [await point("8", 1)]);
    await expectPressed(8);
    await guest.evaluate(() => {
      const session = window.ROMNostalgNetplay.guestSession;
      window.__e2eTouchPeerState = "disconnected";
      Object.defineProperty(session.peer, "connectionState", {
        configurable: true, get: () => window.__e2eTouchPeerState,
      });
      session.peer.dispatchEvent(new Event("connectionstatechange"));
    });
    await expectReleased(8);
    await expect(button("8")).toBeDisabled();
    await guest.evaluate(() => {
      window.__e2eTouchPeerState = "connected";
      window.ROMNostalgNetplay.guestSession.peer.dispatchEvent(new Event("connectionstatechange"));
    });
    await expect(button("8")).toBeEnabled();
    await expect(button("8")).toHaveAttribute("aria-pressed", "false");
    await touch("touchMove", [await point("8", 1)]);
    expect(await guest.evaluate(() => window.ROMNostalgNetplay.guestSession.transmitter.mask)).toBe(0);
    await touch("touchEnd", []);
    await resetInputs();
    await button("9").tap();
    await expectPressed(9);
    await expectReleased(9);

    // Narrow phones keep the entire pad inside the screen too.
    await guest.locator("#guest-mobile-fullscreen-button").tap();
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement)).toBeNull();
    await guest.setViewportSize({ width: 320, height: 640 });
    await guest.locator("#guest-stage").scrollIntoViewIfNeeded();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    for (const inputs of ["6", "8", "10", "11"]) {
      const box = await button(inputs).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    await guest.screenshot({ path: testInfo.outputPath("guest-touch-narrow.png") });
  } finally {
    await Promise.allSettled([guestContext.close(), hostContext.close()]);
  }
});

test("retoma áudio e controles depois de uma interrupção WebRTC transitória", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await Promise.all([
    installTurnstileMock(hostContext),
    installTurnstileMock(guestContext),
  ]);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await host.goto(`${baseURL}/__test-host`);
    await host.locator("#multiplayer-button").click();
    await expect(host.locator("#create-room-button")).toBeEnabled();
    await host.locator("#create-room-button").click();

    await expect(host.locator("#invite-link")).toHaveValue(/#room=testroom_1234&token=guest-token-/);
    const invite = await host.locator("#invite-link").inputValue();
    await guest.goto(invite);
    await guest.locator("#guest-enter-button").click();
    await expect(guest.locator("#guest-status")).toHaveText("Conectado ao jogo", { timeout: 20_000 });

    await guest.keyboard.down("z");
    await waitForSimulatedInput(host, { player: 1, code: 8, value: 1 });
    await guest.keyboard.up("z");
    await waitForSimulatedInput(host, { player: 1, code: 8, value: 0 });

    const before = await guest.evaluate(() => {
      const session = window.ROMNostalgNetplay.guestSession;
      const video = document.querySelector("#guest-video");
      const originalPlay = video.play.bind(video);
      window.__e2eGuestPlayCalls = 0;
      video.play = () => {
        window.__e2eGuestPlayCalls += 1;
        return originalPlay();
      };
      window.__e2ePeerConnectionState = "disconnected";
      Object.defineProperty(session.peer, "connectionState", {
        configurable: true,
        get: () => window.__e2ePeerConnectionState,
      });
      session.peer.dispatchEvent(new Event("connectionstatechange"));
      return {
        transmitterStopped: session.transmitter === null,
        audioTracks: video.srcObject?.getAudioTracks?.().length || 0,
        videoTracks: video.srcObject?.getVideoTracks?.().length || 0,
      };
    });

    expect(before).toEqual({ transmitterStopped: true, audioTracks: 1, videoTracks: 1 });
    await expect(guest.locator("#guest-status")).toContainText("Tentando recuperar");

    await guest.evaluate(() => {
      const session = window.ROMNostalgNetplay.guestSession;
      window.__e2ePeerConnectionState = "connected";
      session.peer.dispatchEvent(new Event("connectionstatechange"));
    });

    await expect(guest.locator("#guest-status")).toHaveText("Conectado ao jogo");
    await expect(guest.locator("#guest-resume-button")).toBeHidden();
    await expect.poll(() => guest.evaluate(() => ({
      transmitterRestored: Boolean(window.ROMNostalgNetplay.guestSession.transmitter),
      playbackRefreshed: window.__e2eGuestPlayCalls > 0,
      audioTrackLive: document.querySelector("#guest-video")
        .srcObject?.getAudioTracks?.().some((track) => track.readyState === "live" && track.enabled) || false,
    }))).toEqual({ transmitterRestored: true, playbackRefreshed: true, audioTrackLive: true });

    await guest.keyboard.down("a");
    await waitForSimulatedInput(host, { player: 1, code: 9, value: 1 });
    await guest.keyboard.up("a");
    await waitForSimulatedInput(host, { player: 1, code: 9, value: 0 });
  } finally {
    await Promise.allSettled([guestContext.close(), hostContext.close()]);
  }
});
