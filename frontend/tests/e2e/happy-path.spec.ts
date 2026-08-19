import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  // Launch Electron app
  const mainPath = path.join(__dirname, '../../'); 
  electronApp = await electron.launch({ args: ['.'], cwd: mainPath });
  window = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp.close();
});

test('Real launch: app renders without crashing', async () => {
  // This test does NOT mock any APIs — verifies the real app boots cleanly
  await window.waitForLoadState('domcontentloaded');

  // The body should be visible and non-empty
  await expect(window.locator('body')).toBeVisible();
  
  // The page title should be set (Atlas or similar)
  const title = await window.title();
  expect(title.length).toBeGreaterThan(0);

  // No critical JS errors that would indicate a white-screen crash
  const errors: string[] = [];
  window.on('pageerror', err => errors.push(err.message));
  await window.waitForTimeout(2000);

  // Filter out network errors (expected if backend isn't running)
  const criticalErrors = errors.filter(
    e => !e.includes('fetch') && !e.includes('network') && !e.includes('ERR_CONNECTION')
  );
  expect(criticalErrors).toHaveLength(0);

  // Verify some DOM content exists (not a blank white page)
  const bodyText = await window.locator('body').innerText();
  expect(bodyText.length).toBeGreaterThan(0);
});

test('Happy path: boots, settings, chat', async () => {
  // Wait for the app to load
  await window.waitForLoadState('domcontentloaded');

  // Ensure app UI is basically loaded
  await expect(window.locator('body')).toBeVisible();

  // Click Settings button
  // Selector accounts for button text, aria-label, or generic settings class
  const settingsButton = window.locator('button:has-text("Settings"), button[aria-label="Settings"], .settings-button, [data-testid="settings-button"]').first();
  await expect(settingsButton).toBeVisible({ timeout: 15000 });
  await settingsButton.click();
  
  // Close settings if it's a modal, or click somewhere else.
  const closeSettings = window.locator('.close-settings, button:has-text("Close"), button[aria-label="Close"], [data-testid="close-settings"]').first();
  if (await closeSettings.isVisible()) {
      await closeSettings.click();
  }

  // Type a message in chat
  const chatInput = window.locator('input[type="text"], textarea, [contenteditable="true"]').first();
  await expect(chatInput).toBeVisible({ timeout: 10000 });
  await chatInput.fill('Hello, Atlas!');
  await chatInput.press('Enter');

  // Assert response stream
  // Responses usually appear in a message container. We wait for some text output
  const response = window.locator('.message-bubble, .chat-message, [data-testid="message"]').last();
  // Wait for some actual response text to appear
  await expect(response).toContainText(/[a-zA-Z]/, { timeout: 30000 }); 
});
