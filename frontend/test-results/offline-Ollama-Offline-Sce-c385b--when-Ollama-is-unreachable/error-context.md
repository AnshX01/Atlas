# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: offline.spec.ts >> Ollama Offline Scenarios >> shows offline banner when Ollama is unreachable
- Location: tests\e2e\offline.spec.ts:26:7

# Error details

```
"beforeAll" hook timeout of 60000ms exceeded.
```

```
TypeError: Cannot read properties of undefined (reading 'close')
```

# Test source

```ts
  1   | /**
  2   |  * Ollama Offline E2E Tests — T16
  3   |  *
  4   |  * Tests that the Atlas app degrades gracefully when Ollama is unreachable.
  5   |  * Verifies no blank screens, no unhandled rejections, and the login/onboarding
  6   |  * flow remains accessible without an AI backend.
  7   |  */
  8   | 
  9   | import { _electron as electron, test, expect, ElectronApplication, Page } from "@playwright/test";
  10  | import * as path from "path";
  11  | 
  12  | let electronApp: ElectronApplication;
  13  | let window: Page;
  14  | 
  15  | test.beforeAll(async () => {
  16  |   const mainPath = path.join(__dirname, "../../../");
  17  |   electronApp = await electron.launch({ args: ["."], cwd: mainPath });
  18  |   window = await electronApp.firstWindow();
  19  | });
  20  | 
  21  | test.afterAll(async () => {
> 22  |   await electronApp.close();
      |                     ^ TypeError: Cannot read properties of undefined (reading 'close')
  23  | });
  24  | 
  25  | test.describe("Ollama Offline Scenarios", () => {
  26  |   test("shows offline banner when Ollama is unreachable", async () => {
  27  |     // Block all requests to port 11434 (Ollama)
  28  |     await window.route("http://localhost:11434/**", (route) => route.abort());
  29  | 
  30  |     await window.goto("/");
  31  | 
  32  |     // Should NOT show a blank screen — should show a meaningful error/banner
  33  |     // The app should render the login or onboarding screen
  34  |     await expect(window.locator("body")).not.toBeEmpty();
  35  | 
  36  |     // After loading, verify the app rendered something meaningful
  37  |     const title = await window.title();
  38  |     expect(title).toBeTruthy(); // App renders something
  39  |   });
  40  | 
  41  |   test("app reaches login screen without Ollama", async () => {
  42  |     await window.route("http://localhost:11434/**", (route) => route.abort());
  43  |     await window.goto("/");
  44  | 
  45  |     // Wait for the page to stabilize
  46  |     await window.waitForLoadState("domcontentloaded");
  47  | 
  48  |     // The app should render a body with content
  49  |     await expect(window.locator("body")).toBeVisible({ timeout: 10000 });
  50  | 
  51  |     // Verify we can see some interactive element (login form, chat input, etc.)
  52  |     const hasInteractiveElement = await window
  53  |       .locator(
  54  |         'input, textarea, button, [role="button"], [contenteditable="true"]'
  55  |       )
  56  |       .first()
  57  |       .isVisible({ timeout: 10000 })
  58  |       .catch(() => false);
  59  | 
  60  |     expect(hasInteractiveElement).toBeTruthy();
  61  |   });
  62  | 
  63  |   test("onboarding wizard triggers when Ollama missing", async () => {
  64  |     // Mock the IPC health check to return offline
  65  |     await window.addInitScript(() => {
  66  |       // If the app uses window.electron for IPC, we can intercept it
  67  |       Object.defineProperty(window, "__OLLAMA_OFFLINE_TEST__", { value: true });
  68  |     });
  69  |     await window.route("http://localhost:11434/**", (route) => route.abort());
  70  |     await window.goto("/");
  71  | 
  72  |     // Verify no JS errors in the console indicate unhandled promise rejections
  73  |     const errors: string[] = [];
  74  |     window.on("pageerror", (err) => errors.push(err.message));
  75  |     await window.waitForTimeout(2000);
  76  | 
  77  |     const unhandledRejections = errors.filter(
  78  |       (e) => e.includes("Unhandled") || e.includes("unhandled")
  79  |     );
  80  |     expect(unhandledRejections).toHaveLength(0);
  81  |   });
  82  | 
  83  |   test("no console errors on startup without Ollama", async () => {
  84  |     const consoleErrors: string[] = [];
  85  | 
  86  |     window.on("console", (msg) => {
  87  |       if (msg.type() === "error") {
  88  |         consoleErrors.push(msg.text());
  89  |       }
  90  |     });
  91  | 
  92  |     await window.route("http://localhost:11434/**", (route) => route.abort());
  93  |     await window.goto("/");
  94  |     await window.waitForTimeout(3000);
  95  | 
  96  |     // Filter out expected network errors (Ollama connection refused is expected)
  97  |     const unexpectedErrors = consoleErrors.filter(
  98  |       (e) =>
  99  |         !e.includes("11434") &&
  100 |         !e.includes("ERR_CONNECTION_REFUSED") &&
  101 |         !e.includes("net::ERR") &&
  102 |         !e.includes("Failed to fetch")
  103 |     );
  104 | 
  105 |     // No unexpected console errors
  106 |     expect(unexpectedErrors).toHaveLength(0);
  107 |   });
  108 | 
  109 |   test("UI remains interactive after Ollama timeout", async () => {
  110 |     // Simulate a slow/timing-out Ollama rather than immediate abort
  111 |     await window.route("http://localhost:11434/**", async (route) => {
  112 |       // Delay 5 seconds then abort to simulate timeout
  113 |       await new Promise((r) => setTimeout(r, 5000));
  114 |       await route.abort();
  115 |     });
  116 | 
  117 |     await window.goto("/");
  118 |     await window.waitForLoadState("domcontentloaded");
  119 | 
  120 |     // UI should still be responsive during the timeout wait
  121 |     const body = window.locator("body");
  122 |     await expect(body).toBeVisible();
```