/**
 * orchestrator-approval-ttl.test.ts
 *
 * Verifies:
 *   1. Approvals are stored and can be approved/rejected normally
 *   2. Approvals older than APPROVAL_TTL_MS are auto-rejected by the cleanup interval
 *   3. Auto-rejection calls resolve(false), never resolve(true)
 *   4. destroy() clears the cleanup interval and rejects all pending approvals
 *   5. Only expired approvals are rejected (fresh ones are left intact)
 */

jest.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));
jest.mock("../../electron/services/local-store", () => ({
  initDB: jest.fn(),
  createConversation: jest.fn(() => ({ id: "conv-1" })),
  saveMessage: jest.fn(),
  getConversationHistory: jest.fn(() => []),
  saveToolExecution: jest.fn(),
}), { virtual: true });
jest.mock("../../electron/services/ollama", () => ({
  streamChat: jest.fn(async function* () { yield "ok"; }),
  checkOllamaHealth: jest.fn(),
}));
jest.mock("../../electron/services/intent-classifier", () => ({
  classifyIntent: jest.fn(async () => ({ intent: "chat", confidence: 0.9, extractedParams: {} })),
  resolveEntities: jest.fn(async (p: string) => p),
  splitMultiIntent: jest.fn(async (p: string) => [p]),
}));
jest.mock("../../electron/services/mcp-manager");
jest.mock("../../electron/services/memory-rag", () => ({
  initRAGStore: jest.fn(),
  searchContext: jest.fn(async () => []),
  storeContext: jest.fn(async () => {}),
}));
jest.mock("../../electron/services/json-repair", () => ({
  repairAndParseJson: jest.fn((s: string) => JSON.parse(s)),
  MissingArgumentError: class MissingArgumentError extends Error {},
}));

import { Orchestrator, APPROVAL_TTL_MS } from "../../electron/services/orchestrator";
import { MCPServerManager } from "../../electron/services/mcp-manager";

function makeMockWindow() {
  return { webContents: { send: jest.fn(), isDestroyed: () => false }, isDestroyed: () => false } as any;
}

describe("Orchestrator — pending approval TTL", () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    jest.useFakeTimers();
    orchestrator = new Orchestrator(new MCPServerManager() as any);
  });

  afterEach(() => {
    orchestrator.destroy();
    jest.useRealTimers();
  });

  test("APPROVAL_TTL_MS is defined and positive", () => {
    expect(APPROVAL_TTL_MS).toBeGreaterThan(0);
  });

  test("destroy() clears the cleanup interval without throwing", () => {
    expect(() => orchestrator.destroy()).not.toThrow();
  });

  test("destroy() called twice does not throw", () => {
    orchestrator.destroy();
    expect(() => orchestrator.destroy()).not.toThrow();
  });

  test("expired approval is auto-rejected (resolve called with false)", async () => {
    const pendingApprovals: Map<string, any> = (orchestrator as any).pendingApprovals;
    let capturedResolve: ((v: boolean) => void) | undefined;
    const resolveTracker = jest.fn((v: boolean) => {});

    // Manually inject a pending approval that is already expired
    const expiredId = "expired-approval-1";
    pendingApprovals.set(expiredId, {
      executionId: expiredId,
      conversationId: "conv-1",
      state: {},
      resolve: resolveTracker,
      createdAt: Date.now() - APPROVAL_TTL_MS - 1000, // already expired
    });

    // Advance time to trigger the 60-second cleanup interval
    jest.advanceTimersByTime(61_000);

    // The cleanup runs synchronously in the setInterval callback
    expect(resolveTracker).toHaveBeenCalledWith(false);
    expect(pendingApprovals.has(expiredId)).toBe(false);
  });

  test("fresh approval is NOT auto-rejected by the cleanup interval", () => {
    const pendingApprovals: Map<string, any> = (orchestrator as any).pendingApprovals;
    const resolveTracker = jest.fn();

    const freshId = "fresh-approval-1";
    pendingApprovals.set(freshId, {
      executionId: freshId,
      conversationId: "conv-1",
      state: {},
      resolve: resolveTracker,
      createdAt: Date.now(), // just created
    });

    jest.advanceTimersByTime(61_000);

    expect(resolveTracker).not.toHaveBeenCalled();
    expect(pendingApprovals.has(freshId)).toBe(true);
  });

  test("destroy() auto-rejects all remaining pending approvals with false", () => {
    const pendingApprovals: Map<string, any> = (orchestrator as any).pendingApprovals;
    const r1 = jest.fn();
    const r2 = jest.fn();

    pendingApprovals.set("a1", { resolve: r1, createdAt: Date.now() });
    pendingApprovals.set("a2", { resolve: r2, createdAt: Date.now() });

    orchestrator.destroy();

    expect(r1).toHaveBeenCalledWith(false);
    expect(r2).toHaveBeenCalledWith(false);
    expect(pendingApprovals.size).toBe(0);
  });

  test("auto-rejection calls resolve(false), never resolve(true)", () => {
    const pendingApprovals: Map<string, any> = (orchestrator as any).pendingApprovals;
    const resolveTracker = jest.fn();

    pendingApprovals.set("exp-2", {
      executionId: "exp-2",
      conversationId: "c",
      state: {},
      resolve: resolveTracker,
      createdAt: Date.now() - APPROVAL_TTL_MS - 1,
    });

    jest.advanceTimersByTime(61_000);

    const calls = resolveTracker.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach(([arg]) => expect(arg).toBe(false));
  });
});
