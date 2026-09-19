const { test, expect } = require("@playwright/test");

// Do not bypass the real browser's autoplay policy for audio regressions.
test.use({ launchOptions: { args: ["--autoplay-policy=document-user-activation-required"] } });

async function receivedAudioEnergy(guest) {
  return guest.evaluate(async () => {
    const stats = await window.ROMNostalgNetplay.guestSession.peer.getStats();
    const audio = [...stats.values()].find((report) => report.type === "inbound-rtp" && report.kind === "audio");
    return audio?.totalAudioEnergy || 0;
  });
}

for (const mobile of [false, true]) {
  test(`convidado recebe som após reconectar as fontes do emulador (${mobile ? "mobile" : "desktop"})`, async ({ browser, baseURL }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext(mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : {});
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    try {
      await host.goto(`${baseURL}/__test-host`);
      await host.locator("#multiplayer-button").click();
      await expect(host.locator("#create-room-button")).toBeEnabled();
      await host.locator("#create-room-button").click();
      await expect(host.locator("#host-status")).toContainText("Aguardando o Player 2");
      await guest.goto(await host.locator("#invite-link").inputValue());
      await guest.locator("#guest-enter-button").click();
      await expect(guest.locator("#guest-status")).toHaveText("Conectado ao jogo");
      await expect.poll(() => receivedAudioEnergy(guest)).toBeGreaterThan(0.000001);

      await host.evaluate(() => window.__e2eReconnectAudioSource());
      // Let audio already buffered by WebRTC drain before measuring again.
      await guest.waitForTimeout(700);
      const before = await receivedAudioEnergy(guest);
      await expect.poll(() => receivedAudioEnergy(guest)).toBeGreaterThan(before + 0.00001);
      await expect.poll(() => guest.locator("#guest-video").evaluate((video) => ({
        paused: video.paused, muted: video.muted, volume: video.volume,
      }))).toEqual({ paused: false, muted: false, volume: 0.7 });
      await expect(guest.locator("#guest-resume-button")).toBeHidden();

      // A browser can still reject play(). Recovery must stay visible on touch
      // devices, where the desktop audio toolbar is intentionally hidden.
      await guest.evaluate(async () => {
        const video = document.querySelector("#guest-video");
        video.pause();
        window.__e2eOriginalGuestPlay = video.play;
        video.play = () => Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
        await window.ROMNostalgNetplay.setGuestStream(video.srcObject);
      });
      await expect(guest.locator("#guest-resume-button")).toBeVisible();
      await expect(guest.locator("#guest-status")).toContainText("Ativar áudio");
      await guest.evaluate(() => { document.querySelector("#guest-video").play = window.__e2eOriginalGuestPlay; });
      if (mobile) {
        await guest.locator("#guest-mobile-fullscreen-button").tap();
        await expect.poll(() => guest.evaluate(() => document.fullscreenElement?.id)).toBe("guest-player-shell");
        await guest.locator("#guest-resume-button").tap();
      } else {
        await guest.locator("#guest-resume-button").click();
      }
      await expect(guest.locator("#guest-resume-button")).toBeHidden();
      await expect(guest.locator("#guest-status")).toHaveText("Conectado ao jogo");
      await expect.poll(() => guest.locator("#guest-video").evaluate((video) => video.paused)).toBe(false);

      await host.evaluate(() => { window.__e2eCapturedTracks = window.ROMNostalgNetplay.hostSession.stream.getTracks(); });
      await host.locator("#end-room-button").click();
      await expect.poll(() => host.evaluate(() => window.__e2eCapturedTracks.every((track) => track.readyState === "ended"))).toBe(true);
      // Closing the room must leave the original speaker connection intact.
      await host.evaluate(() => {
        const { gain, audioCtx } = window.EJS_emulator.Module.AL.currentCtx;
        gain.disconnect(audioCtx.destination); // Throws if cleanup disconnected it.
        gain.connect(audioCtx.destination);
        if (audioCtx.state !== "running") throw new Error("Host audio stopped");
      });
    } finally {
      await Promise.allSettled([guestContext.close(), hostContext.close()]);
    }
  });
}
