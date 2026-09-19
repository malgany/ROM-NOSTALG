const { test, expect } = require('@playwright/test');
const { createCipheriv, createHash, pbkdf2Sync, randomBytes } = require('node:crypto');

const password = 'catalog-fixture-password-only';
function fixture() {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  function seal(bytes) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    return { iv, sealed: Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]) };
  }
  const assets = new Map();
  const games = [
    ['world', 'Super Mario World', 'original'],
    ['world', 'Super Mario World', 'pt-BR'],
    ['world-hack', 'Super Mario World Hack 2025', 'pt-BR'],
    ['kirby', 'Kirby Super Star', 'original', 'Example (Japan) [En by Example Team].zip'],
    ['chrono', 'Chrono Trigger', 'pt-BR'],
    ['japanese', 'Japanese Example', 'original', 'Example_(J).smc'],
  ].map(([groupId, displayTitle, variant, fileName], index) => {
    const id = (index + 1).toString(16).padStart(24, '0');
    const bytes = Buffer.from(`${groupId}:${variant}`);
    const { iv, sealed } = seal(bytes);
    const asset = `assets/${id}.bin`;
    assets.set(asset, Buffer.concat([iv, sealed]));
    return { id, title: `${displayTitle}${variant === 'pt-BR' ? ' (PT-BR)' : ''}`,
      fileName: fileName || `${id}.smc`, asset, size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), groupId, displayTitle, variant };
  });
  const { iv, sealed } = seal(Buffer.from(JSON.stringify({ version: 2, system: 'snes', games })));
  return { assets, envelope: { version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: salt.toString('base64') },
    cipher: { name: 'AES-GCM', iv: iv.toString('base64') }, payload: sealed.toString('base64') } };
}

for (const theme of ['light', 'dark']) {
for (const viewport of [{ width: 1100, height: 800 }, { width: 390, height: 844 }]) {
  test(`catálogo alterna versões reais e mantém hacks separados em ${viewport.width}px / ${theme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize(viewport);
    const { assets, envelope } = fixture();
    await page.route('**/vault/snes/catalog.json', (route) => route.fulfill({ json: envelope }));
    const downloads = [];
    await page.route('**/vault/snes/assets/*.bin', async (route) => {
      const asset = `assets/${route.request().url().split('/').pop()}`;
      downloads.push(asset);
      await route.fulfill({ body: assets.get(asset), contentType: 'application/octet-stream' });
    });
    await page.goto('/');
    await page.evaluate(() => {
      // Keep the real catalog decryption; replace only the emulator's boot boundary.
      window.loadRom = async (file, metadata) => {
        window.__catalogLaunch = { bytes: await file.text(), metadata };
      };
    });
    await page.locator('#unlock-catalog-button').click();
    await page.locator('#catalog-password').fill(password);
    await page.locator('#unlock-submit').click();
    await expect(page.locator('#catalog-dialog')).toBeVisible();
    await expect(page.locator('.catalog-game')).toHaveCount(5);
    const world = page.getByRole('radio', { name: 'Super Mario World, Original e Traduzido em português', exact: true });
    const original = page.locator('input[name="catalog-variant"][value="original"]');
    const translated = page.locator('input[name="catalog-variant"][value="pt-BR"]');
    const play = page.locator('#play-catalog-game');
    await world.click();
    await expect(world.locator('.version-original')).toHaveCount(1);
    await expect(world.locator('.version-original')).toHaveClass(/version-usa/);
    await expect(world.locator('.version-original')).toHaveText('');
    await expect(world.locator('.version-original')).toHaveAttribute('title', 'Original');
    await expect(world.locator('.version-brazil')).toHaveCount(1);
    await expect(page.getByRole('radio', { name: 'Japanese Example, Original', exact: true })
      .locator('.version-original')).toHaveClass(/version-japan/);
    await expect(page.getByRole('radio', { name: 'Kirby Super Star, Original', exact: true })
      .locator('.version-original')).toHaveClass(/version-usa/);
    await expect(translated).toBeChecked();
    await expect(play).toHaveClass(/is-translated/);
    const toggleBounds = await page.locator('.catalog-variant-toggle').boundingBox();
    const buttonBounds = await play.boundingBox();
    expect(toggleBounds.x + toggleBounds.width).toBeLessThanOrEqual(buttonBounds.x + 1);
    expect(Math.abs(toggleBounds.y - buttonBounds.y)).toBeLessThan(12);
    await page.screenshot({ path: testInfo.outputPath(`catalog-${viewport.width}.png`) });
    await original.focus();
    await page.keyboard.press('Space');
    await expect(original).toBeChecked();
    await expect(play).not.toHaveClass(/is-translated/);
    await play.click();
    await expect.poll(() => page.evaluate(() => window.__catalogLaunch?.bytes)).toBe('world:original');
    expect(downloads).toHaveLength(1);
    const originalId = await page.evaluate(() => window.__catalogLaunch.metadata.id);
    await page.locator('#unlock-catalog-button').click();
    await translated.focus();
    await page.keyboard.press('Space');
    await play.click();
    await expect.poll(() => page.evaluate(() => window.__catalogLaunch?.bytes)).toBe('world:pt-BR');
    expect(downloads).toHaveLength(2);
    expect(downloads[0]).not.toBe(downloads[1]);
    const metadata = await page.evaluate(() => window.__catalogLaunch.metadata);
    expect(metadata.id).not.toBe(originalId);
    expect(metadata.storageTitle).toBe('Super Mario World (PT-BR)');
    await page.locator('#unlock-catalog-button').click();
    await page.getByRole('radio', { name: 'Super Mario World Hack 2025, Traduzido em português', exact: true }).click();
    await expect(original).toBeDisabled();
    await expect(translated).toBeChecked();
    await page.getByRole('radio', { name: 'Kirby Super Star, Original', exact: true }).click();
    await expect(translated).toBeDisabled();
    await expect(original).toBeChecked();
    await expect(play).not.toHaveClass(/is-translated/);
    await page.locator('#catalog-search').fill('Super Mario World');
    await expect(page.locator('.catalog-game')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
}
