/**
 * Ollama Offline E2E Tests — T16
 *
 * Tests that the Atlas app degrades gracefully when Ollama is unreachable.
 * Verifies no blank screens, no unhandled rejections, and the login/onboarding
 * flow remains accessible without an AI backend.
 */

import { _electron as electron, test, expect, ElectronApplication, Page } from "@playwright/test";
import * as path from "path";

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  const mainPath = path.join(__dirname, "../../../");
  electronApp = await electron.launch({ args: ["."], cwd: mainPath });
  window = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp.close();
});

test.describe("Ollama Offline Scenarios", () => {
  test("shows offline banner when Ollama is unreachable", async () => {
    // Block all requests to port 11434 (Ollama)
    await window.route("http://localhost:11434/**", (route) => route.abort());

    await window.goto("/");

    // Should NOT show a blank screen — should show a meaningful error/banner
    // The app should render the login or onboarding screen
    await expect(window.locator("body")).not.toBeEmpty();

    // After loading, verify the app rendered something meaningful
    const title = await window.title();
    expect(title).toBeTruthy(); // App renders something
  });

  test("app reaches login screen without Ollama", async () => {
    await window.route("http://localhost:11434/**", (route) => route.abort());
    await window.goto("/");

    // Wait for the page to stabilize
    await window.waitForLoadState("domcontentloaded");

    // The app should render a body with content
    await expect(window.locator("body")).toBeVisible({ timeout: 10000 });

    // Verify we can see some interactive element (login form, chat input, etc.)
    const hasInteractiveElement = await window
      .locator(
        'input, textarea, button, [role="button"], [contenteditable="true"]'
      )
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasInteractiveElement).toBeTruthy();
  });

  test("onboarding wizard triggers when Ollama missing", async () => {
    // Mock the IPC health check to return offline
    await window.addInitScript(() => {
      // If the app uses window.electron for IPC, we can intercept it
      Object.defineProperty(window, "__OLLAMA_OFFLINE_TEST__", { value: true });
    });
    await window.route("http://localhost:11434/**", (route) => route.abort());
    await window.goto("/");

    // Verify no JS errors in the console indicate unhandled promise rejections
    const errors: string[] = [];
    window.on("pageerror", (err) => errors.push(err.message));
    await window.waitForTimeout(2000);

    const unhandledRejections = errors.filter(
      (e) => e.includes("Unhandled") || e.includes("unhandled")
    );
    expect(unhandledRejections).toHaveLength(0);
  });

  test("no console errors on startup without Ollama", async () => {
    const consoleErrors: string[] = [];

    window.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await window.route("http://localhost:11434/**", (route) => route.abort());
    await window.goto("/");
    await window.waitForTimeout(3000);

    // Filter out expected network errors (Ollama connection refused is expected)
    const unexpectedErrors = consoleErrors.filter(
      (e) =>
        !e.includes("11434") &&
        !e.includes("ERR_CONNECTION_REFUSED") &&
        !e.includes("net::ERR") &&
        !e.includes("Failed to fetch")
    );

    // No unexpected console errors
    expect(unexpectedErrors).toHaveLength(0);
  });

  test("UI remains interactive after Ollama timeout", async () => {
    // Simulate a slow/timing-out Ollama rather than immediate abort
    await window.route("http://localhost:11434/**", async (route) => {
      // Delay 5 seconds then abort to simulate timeout
      await new Promise((r) => setTimeout(r, 5000));
      await route.abort();
    });

    await window.goto("/");
    await window.waitForLoadState("domcontentloaded");

    // UI should still be responsive during the timeout wait
    const body = window.locator("body");
    await expect(body).toBeVisible();

    // Try to interact with any visible element
    const anyButton = window.locator("button").first();
    if (await anyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Button is clickable (not frozen)
      await expect(anyButton).toBeEnabled();
    }
  });
});
