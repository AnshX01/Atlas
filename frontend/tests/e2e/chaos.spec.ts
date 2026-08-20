import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  const mainPath = path.join(__dirname, '../../'); 
  electronApp = await electron.launch({ args: ['.'], cwd: mainPath, env: { ...process.env, NEXT_URL: 'http://localhost:3001' } });
  window = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp.close();
});

test('Chaos testing: UI survives stress', async () => {
  test.setTimeout(120000); // Give chaos test more time

  await window.waitForLoadState('domcontentloaded');
  await expect(window.locator('body')).toBeVisible();

  // 1. Spam Alt+Space shortcut 50 times
  for (let i = 0; i < 50; i++) {
    await window.keyboard.press('Alt+Space');
    // small delay to let event loop tick occasionally
    if (i % 10 === 0) await window.waitForTimeout(10);
  }

  // 2. Resize window rapidly
  for (let i = 0; i < 20; i++) {
    const width = 800 + Math.floor(Math.random() * 400);
    const height = 600 + Math.floor(Math.random() * 400);
    await window.setViewportSize({ width, height });
    await window.waitForTimeout(50);
  }

  // 3. Spam the Settings button
  const settingsButton = window.locator('button:has-text("Settings"), button[aria-label="Settings"], .settings-button, [data-testid="settings-button"]').first();
  // We only click if it's there
  if (await settingsButton.isVisible()) {
    for (let i = 0; i < 20; i++) {
        await settingsButton.click({ force: true });
        await window.waitForTimeout(20);
    }
  }

  // Close settings if it's open, to allow chatting
  const closeSettings = window.locator('.close-settings, button:has-text("Close"), button[aria-label="Close"], [data-testid="close-settings"]').first();
  if (await closeSettings.isVisible()) {
      await closeSettings.click({ force: true });
  }

  // Assert the app hasn't crashed by checking if a main element is still visible
  const mainContainer = window.locator('body');
  await expect(mainContainer).toBeVisible();
  
  // Make sure we can still interact
  const chatInput = window.locator('input[type="text"], textarea, [contenteditable="true"]').first();
  await expect(chatInput).toBeVisible({ timeout: 10000 });
  await chatInput.fill('Still alive?');
  const value = await chatInput.inputValue();
  // Ensure the input field took the value, proving the UI thread isn't frozen
  expect(value).toBe('Still alive?');
});
