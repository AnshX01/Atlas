# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chaos.spec.ts >> Chaos testing: UI survives stress
- Location: tests\e2e\chaos.spec.ts:17:5

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
  8  |   const mainPath = path.join(__dirname, '../../../'); 
  9  |   electronApp = await electron.launch({ args: ['.'], cwd: mainPath });
  10 |   window = await electronApp.firstWindow();
  11 | });
  12 | 
  13 | test.afterAll(async () => {
> 14 |   await electronApp.close();
     |                     ^ TypeError: Cannot read properties of undefined (reading 'close')
  15 | });
  16 | 
  17 | test('Chaos testing: UI survives stress', async () => {
  18 |   test.setTimeout(120000); // Give chaos test more time
  19 | 
  20 |   await window.waitForLoadState('domcontentloaded');
  21 |   await expect(window.locator('body')).toBeVisible();
  22 | 
  23 |   // 1. Spam Alt+Space shortcut 50 times
  24 |   for (let i = 0; i < 50; i++) {
  25 |     await window.keyboard.press('Alt+Space');
  26 |     // small delay to let event loop tick occasionally
  27 |     if (i % 10 === 0) await window.waitForTimeout(10);
  28 |   }
  29 | 
  30 |   // 2. Resize window rapidly
  31 |   for (let i = 0; i < 20; i++) {
  32 |     const width = 800 + Math.floor(Math.random() * 400);
  33 |     const height = 600 + Math.floor(Math.random() * 400);
  34 |     await window.setViewportSize({ width, height });
  35 |     await window.waitForTimeout(50);
  36 |   }
  37 | 
  38 |   // 3. Spam the Settings button
  39 |   const settingsButton = window.locator('button:has-text("Settings"), button[aria-label="Settings"], .settings-button, [data-testid="settings-button"]').first();
  40 |   // We only click if it's there
  41 |   if (await settingsButton.isVisible()) {
  42 |     for (let i = 0; i < 20; i++) {
  43 |         await settingsButton.click({ force: true });
  44 |         await window.waitForTimeout(20);
  45 |     }
  46 |   }
  47 | 
  48 |   // Close settings if it's open, to allow chatting
  49 |   const closeSettings = window.locator('.close-settings, button:has-text("Close"), button[aria-label="Close"], [data-testid="close-settings"]').first();
  50 |   if (await closeSettings.isVisible()) {
  51 |       await closeSettings.click({ force: true });
  52 |   }
  53 | 
  54 |   // Assert the app hasn't crashed by checking if a main element is still visible
  55 |   const mainContainer = window.locator('body');
  56 |   await expect(mainContainer).toBeVisible();
  57 |   
  58 |   // Make sure we can still interact
  59 |   const chatInput = window.locator('input[type="text"], textarea, [contenteditable="true"]').first();
  60 |   await expect(chatInput).toBeVisible({ timeout: 10000 });
  61 |   await chatInput.fill('Still alive?');
  62 |   const value = await chatInput.inputValue();
  63 |   // Ensure the input field took the value, proving the UI thread isn't frozen
  64 |   expect(value).toBe('Still alive?');
  65 | });
  66 | 
```