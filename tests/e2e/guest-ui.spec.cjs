const { test, expect } = require("@playwright/test");

test("menu desktop segue o host e configura apenas o controle do convidado", async ({ browser, baseURL }, testInfo) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors = [];
  guest.on("pageerror", (error) => errors.push(error.message));
  const toolbar = guest.locator("#guest-player-toolbar");
  const dialog = guest.locator("#guest-controls-dialog");
  const field = (kind, input) => guest.locator(`input[data-binding-kind="${kind}"][data-input="${input}"]`);
  const showMenu = async () => {
    await guest.locator("#guest-stage").click({ position: { x: 20, y: 20 } });
    await expect(toolbar).not.toHaveClass(/is-hidden/);
  };
  const openControls = async () => {
    await showMenu();
    await guest.locator("#guest-controls-button").click();
    await expect(dialog).toBeVisible();
  };
  const remoteMask = async (mask) => {
    await expect.poll(() => host.evaluate(() => window.ROMNostalgNetplay.hostSession.remoteMask)).toBe(mask);
  };

  try {
    await host.goto(`${baseURL}/__test-host`);
    await host.locator("#multiplayer-button").click();
    await expect(host.locator("#create-room-button")).toBeEnabled();
    await host.locator("#create-room-button").click();
    await expect(host.locator("#invite-link")).toHaveValue(/#room=testroom_1234/);
    await guest.goto(await host.locator("#invite-link").inputValue());
    await guest.locator("#guest-enter-button").click();
    await expect(guest.locator("#guest-status")).toHaveText("Conectado ao jogo");
    await expect(toolbar).toHaveClass(/is-hidden/);
    await expect(toolbar).toHaveAttribute("inert", "");
    await expect(guest.locator("#guest-mobile-actions")).toBeHidden();
    await expect(guest.locator("#guest-player-help")).toHaveText(await host.locator(".player-view .player-help").innerText());
    await expect(guest.locator("#guest-player-help kbd")).toHaveCount(2);
    await expect(guest.locator("#guest-leave-button")).toBeVisible();

    await showMenu();
    await expect(guest.locator("#guest-fullscreen-button .guest-enter-fullscreen")).toBeVisible();
    await expect(guest.locator("#guest-fullscreen-button .guest-exit-fullscreen")).toBeHidden();
    await guest.locator("#guest-fullscreen-button").hover();
    await guest.screenshot({ path: testInfo.outputPath("desktop-footer.png") });
    await guest.locator("#guest-controls-button").hover();
    await expect(guest.locator("#guest-controls-button .guest-tool-tip")).toHaveCSS("opacity", "1");
    const accent = await guest.locator('.modal-eyebrow').first().evaluate((label) => getComputedStyle(label).color);
    await expect(guest.locator("#guest-controls-button")).toHaveCSS("background-color", accent);
    const stage = await guest.locator("#guest-stage").boundingBox();
    await guest.mouse.move(stage.x + 20, stage.y + 20);
    await guest.waitForTimeout(2100);
    await expect(toolbar).not.toHaveClass(/is-hidden/);
    await expect(toolbar).toHaveClass(/is-hidden/, { timeout: 2000 });

    await showMenu();
    await guest.locator("#guest-volume").evaluate((slider) => {
      slider.value = "0.42";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(guest.locator("#guest-volume")).toHaveCSS("--value", "42%");
    await guest.locator("#guest-audio-button").click();
    await expect(guest.locator("#guest-audio-button")).toHaveAttribute("aria-label", "Desmutar");
    await expect(guest.locator(".guest-audio-muted")).toBeVisible();
    await expect(guest.locator(".guest-audio-waves")).toBeHidden();
    await expect(guest.locator("#guest-volume")).toHaveValue("0");
    await guest.locator("#guest-audio-button").click();
    await expect(guest.locator("#guest-volume")).toHaveValue("0.42");
    await guest.locator("#guest-fullscreen-button").click();
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement?.id)).toBe("guest-stage");
    await showMenu();
    await expect(guest.locator("#guest-fullscreen-button .guest-exit-fullscreen")).toBeVisible();
    await expect(guest.locator("#guest-fullscreen-button .guest-enter-fullscreen")).toBeHidden();
    await guest.screenshot({ path: testInfo.outputPath("desktop-toolbar.png") });

    await guest.evaluate(() => {
      window.__uiPads = [0, 1].map((index) => ({
        index, id: `Controle USB ${index + 1}`, axes: [0, 0],
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
      }));
      window.__uiPads[0].buttons[0] = { pressed: true, value: 1 };
      Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => window.__uiPads });
    });
    await remoteMask(1);
    await openControls();
    await remoteMask(0);
    expect(await guest.locator("#guest-stage").evaluate((el) => el.scrollTop)).toBe(0);
    const overlayBox = await dialog.boundingBox();
    const fullscreenBox = await guest.locator("#guest-stage").boundingBox();
    expect(overlayBox).toEqual(fullscreenBox);
    await expect(guest.locator(".guest-controller-slot")).toHaveText("Player 2");
    await expect(guest.locator("#guest-connected-gamepad option")).toHaveCount(3);
    await expect(field("gamepad", 8)).toHaveValue("BUTTON_2");
    await guest.screenshot({ path: testInfo.outputPath("desktop-control-settings.png") });

    // Reconnection must stay neutral even with a held gamepad button and an open panel.
    await host.evaluate(() => { window.__e2eSimulatedInputs = []; });
    await guest.evaluate(() => {
      const session = window.ROMNostalgNetplay.guestSession;
      session.stopTransmitter();
      session.startTransmitter();
    });
    await guest.waitForTimeout(300);
    expect(await host.evaluate(() => window.__e2eSimulatedInputs.filter((input) => input.value === 1))).toEqual([]);

    // A key outside the old limited dropdown is captured, persisted, and not sent.
    await guest.getByRole("button", { name: "Definir A", exact: true }).click();
    await guest.keyboard.press("5");
    await expect(field("keyboard", 8)).toHaveValue("5");
    await guest.keyboard.press("x");
    await remoteMask(0);
    await expect.poll(() => guest.evaluate(() => JSON.parse(localStorage.getItem("rom-nostalg.control-profiles.v1")).keyboards[0][8])).toBe("Digit5");
    await guest.locator("#guest-controls-close").click();
    await remoteMask(1); // The physical controller still holds B.
    await guest.keyboard.down("5");
    await remoteMask(1 | (1 << 8));
    await guest.keyboard.up("5");
    await remoteMask(1);
    await openControls();
    await remoteMask(0);

    // Each command can be cleared independently, then all defaults restored.
    await guest.getByRole("button", { name: "Definir B", exact: true }).click();
    await guest.locator("#guest-binding-clear").click();
    await expect(field("keyboard", 0)).toHaveValue("");
    await expect(field("gamepad", 0)).toHaveValue("");
    await guest.locator("#guest-controls-reset").click();
    await expect(field("keyboard", 8)).toHaveValue("z");
    await expect(field("gamepad", 0)).toHaveValue("BUTTON_1");

    // Only the selected physical controller is captured and transmitted.
    await guest.locator("#guest-connected-gamepad").selectOption("1");
    await guest.getByRole("button", { name: "Definir A", exact: true }).click();
    await guest.evaluate(() => { window.__uiPads[1].axes[0] = 0.9; });
    await expect(field("gamepad", 8)).toHaveValue("EIXO 1 +");
    await remoteMask(0);
    await guest.locator("#guest-controls-close").click();
    // The explicitly captured axis overrides the ordinary directional fallback.
    await remoteMask(1 << 8);
    await guest.evaluate(() => { window.__uiPads[1].axes[0] = 0; });
    await remoteMask(0);
    await guest.keyboard.down("z");
    await remoteMask(1 << 8);
    await guest.keyboard.up("z");
    await remoteMask(0);

    await openControls();
    await guest.locator("#guest-controls-clear").click();
    expect(await guest.locator("#guest-bindings-body input").evaluateAll((inputs) => inputs.every((input) => input.value === ""))).toBe(true);
    await guest.locator("#guest-controls-close").click();
    await guest.evaluate(() => { window.__uiPads[1].axes[0] = 0.9; });
    await guest.keyboard.press("z");
    await remoteMask(0);
    await showMenu();
    await guest.locator("#guest-fullscreen-button").click();
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement)).toBeNull();
    await showMenu();
    await expect(guest.locator("#guest-fullscreen-button .guest-enter-fullscreen")).toBeVisible();
    await expect(guest.locator("#guest-fullscreen-button .guest-exit-fullscreen")).toBeHidden();
    await guest.keyboard.press("F11");
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement?.id)).toBe("guest-stage");
    await showMenu();
    await expect(guest.locator("#guest-fullscreen-button .guest-exit-fullscreen")).toBeVisible();
    await expect(guest.locator("#guest-fullscreen-button .guest-enter-fullscreen")).toBeHidden();
    await guest.keyboard.press("Escape");
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement)).toBeNull();
    await showMenu();
    await expect(guest.locator("#guest-fullscreen-button .guest-enter-fullscreen")).toBeVisible();
    await expect(guest.locator("#guest-fullscreen-button .guest-exit-fullscreen")).toBeHidden();
    await guest.addInitScript(() => {
      Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [{
        index: 3, id: "Controle USB 2", axes: [0, 0],
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
      }] });
    });
    await guest.reload();
    await openControls();
    expect(await guest.locator("#guest-bindings-body input").evaluateAll((inputs) => inputs.every((input) => input.value === ""))).toBe(true);
    await guest.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([guestContext.close(), hostContext.close()]);
  }
});

test("recarrega teclas e eixos personalizados sem perder o mapeamento", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rom-nostalg.control-profiles.v1", JSON.stringify({
      version: 1, keyboards: { 0: { 8: "Digit5" } },
      gamepads: { '["Controle personalizado","standard"]': { 8: "RIGHT_STICK_Y:-1" } },
    }));
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [{
      id: "Controle personalizado", mapping: "standard", index: 2, axes: [0, 0, 0, 0], buttons: [],
    }] });
  });
  await page.goto(`${baseURL}/#room=testroom_1234&token=guest-token-abcdefghijklmnopqrstuvwxyz`);
  await page.locator("#guest-stage").click({ position: { x: 20, y: 20 } });
  await page.locator("#guest-controls-button").click();
  await expect(page.locator('input[data-binding-kind="keyboard"][data-input="8"]')).toHaveValue("5");
  await expect(page.locator('input[data-binding-kind="gamepad"][data-input="8"]')).toHaveValue("EIXO 4 −");
  expect(await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    return ids.length === new Set(ids).size;
  })).toBe(true);
});
