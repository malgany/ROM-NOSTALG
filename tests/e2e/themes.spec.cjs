const { test, expect } = require('@playwright/test');

for (const theme of ['light', 'dark']) {
  for (const width of [1280, 390, 320]) {
    test(`tema ${theme}: início, senha e convite em ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', String(theme === 'dark'));
      const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      expect(await fits()).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
      await page.locator('#unlock-catalog-button').click();
      await page.locator('#remember-password').focus();
      await page.keyboard.press('Space');
      await expect(page.locator('#remember-password')).toBeChecked();
      await page.locator('#toggle-password').click();
      await expect(page.locator('#catalog-password')).toHaveAttribute('type', 'text');
      await page.locator('#unlock-submit').click();
      await expect(page.locator('#unlock-status')).not.toBeEmpty();
      await page.screenshot({ path: testInfo.outputPath('unlock.png') });
      expect(await fits()).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('#unlock-dialog')).not.toBeVisible();
      await page.goto('/?theme-review#room=testroom_1234&token=guest-token-abcdefghijklmnopqrstuvwxyz');
      await expect(page.locator('#guest-enter-button')).toBeVisible();
      await expect(page.locator('#guest-leave-button')).toBeVisible();
      expect(await fits()).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('guest.png'), fullPage: true });
      await page.locator('#guest-stage').click({ position: { x: 20, y: 20 } });
      await page.locator('#guest-controls-button').click();
      await expect(page.locator('#guest-controls-dialog')).toBeVisible();
      await expect(page.locator('#guest-connected-gamepad')).toHaveCSS('color-scheme', theme);
      await expect(page.getByRole('button', { name: 'Definir A', exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath('controls.png') });
      expect(errors).toEqual([]);
    });
  }
}

test('preferência acompanha sistema, persiste e sincroniza entre abas sem afetar perfis', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const peer = await context.newPage();
  await peer.goto('/');
  await page.evaluate(() => localStorage.setItem('rom-nostalg.control-profiles.v1', 'preserve-me'));
  await page.locator('#theme-toggle').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(peer.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('rom-nostalg.control-profiles.v1'))).toBe('preserve-me');
  await peer.close();
});

test('tema funciona quando armazenamento está bloqueado', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#unlock-catalog-button').click();
  await expect(page.locator('#unlock-dialog')).toBeVisible();
});

test('verificação multiplayer acompanha o tema ao reabrir o modal', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    window.__widgetThemes = [];
    window.__widgetRemovals = 0;
    window.turnstile = {
      render(_selector, options) {
        window.__widgetThemes.push(options.theme);
        setTimeout(() => options.callback('theme-fixture-token'), 0);
        return 'theme-fixture-widget';
      },
      reset() {},
      remove() { window.__widgetRemovals++; },
    };
  });
  await page.goto('/__test-host');
  await page.locator('#multiplayer-button').click();
  await expect(page.locator('#create-room-button')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('multiplayer-light.png') });
  await page.locator('[data-close-multiplayer]').click();
  await page.locator('#theme-toggle').click();
  await page.locator('#multiplayer-button').click();
  await expect(page.locator('#create-room-button')).toBeEnabled();
  expect(await page.evaluate(() => window.__widgetThemes)).toEqual(['light', 'dark']);
  expect(await page.evaluate(() => window.__widgetRemovals)).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('multiplayer-dark.png') });
});
