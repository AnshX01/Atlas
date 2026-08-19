# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: happy-path.spec.ts >> Real launch: app renders without crashing
- Location: tests\e2e\happy-path.spec.ts:18:5

# Error details

```
"beforeAll" hook timeout of 60000ms exceeded.
```

```
TypeError: Cannot read properties of undefined (reading 'close')
```

# Test source

```ts
  1  | import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test';
  2  | import * as path from 'path';
  3  | 
  4  | let electronApp: ElectronApplication;
  5  | let window: Page;
  6  | 
  7  | test.beforeAll(async () => {
  8  |   // Launch Electron app
  9  |   const mainPath = path.join(__dirname, '../../../'); 
  10 |   electronApp = await electron.launch({ args: ['.'], cwd: mainPath });
  11 |   window = await electronApp.firstWindow();
  12 | });
  13 | 
  14 | test.afterAll(async () => {
> 15 |   await electronApp.close();
     |                     ^ TypeError: Cannot read properties of undefined (reading 'close')
  16 | });
  17 | 
  18 | test('Real launch: app renders without crashing', async () => {
  19 |   // This test does NOT mock any APIs — verifies the real app boots cleanly
  20 |   await window.waitForLoadState('domcontentloaded');
  21 | 
  22 |   // The body should be visible and non-empty
  23 |   await expect(window.locator('body')).toBeVisible();
  24 |   
  25 |   // The page title should be set (Atlas or similar)
  26 |   const title = await window.title();
  27 |   expect(title.length).toBeGreaterThan(0);
  28 | 
  29 |   // No critical JS errors that would indicate a white-screen crash
  30 |   const errors: string[] = [];
  31 |   window.on('pageerror', err => errors.push(err.message));
  32 |   await window.waitForTimeout(2000);
  33 | 
  34 |   // Filter out network errors (expected if backend isn't running)
  35 |   const criticalErrors = errors.filter(
  36 |     e => !e.includes('fetch') && !e.includes('network') && !e.includes('ERR_CONNECTION')
  37 |   );
  38 |   expect(criticalErrors).toHaveLength(0);
  39 | 
  40 |   // Verify some DOM content exists (not a blank white page)
  41 |   const bodyText = await window.locator('body').innerText();
  42 |   expect(bodyText.length).toBeGreaterThan(0);
  43 | });
  44 | 
  45 | test('Happy path: boots, settings, chat', async () => {
  46 |   // Wait for the app to load
  47 |   await window.waitForLoadState('domcontentloaded');
  48 | 
  49 |   // Ensure app UI is basically loaded
  50 |   await expect(window.locator('body')).toBeVisible();
  51 | 
  52 |   // Click Settings button
  53 |   // Selector accounts for button text, aria-label, or generic settings class
  54 |   const settingsButton = window.locator('button:has-text("Settings"), button[aria-label="Settings"], .settings-button, [data-testid="settings-button"]').first();
  55 |   await expect(settingsButton).toBeVisible({ timeout: 15000 });
  56 |   await settingsButton.click();
  57 |   
  58 |   // Close settings if it's a modal, or click somewhere else.
  59 |   const closeSettings = window.locator('.close-settings, button:has-text("Close"), button[aria-label="Close"], [data-testid="close-settings"]').first();
  60 |   if (await closeSettings.isVisible()) {
  61 |       await closeSettings.click();
  62 |   }
  63 | 
  64 |   // Type a message in chat
  65 |   const chatInput = window.locator('input[type="text"], textarea, [contenteditable="true"]').first();
  66 |   await expect(chatInput).toBeVisible({ timeout: 10000 });
  67 |   await chatInput.fill('Hello, Atlas!');
  68 |   await chatInput.press('Enter');
  69 | 
  70 |   // Assert response stream
  71 |   // Responses usually appear in a message container. We wait for some text output
  72 |   const response = window.locator('.message-bubble, .chat-message, [data-testid="message"]').last();
  73 |   // Wait for some actual response text to appear
  74 |   await expect(response).toContainText(/[a-zA-Z]/, { timeout: 30000 }); 
  75 | });
  76 | 
```