/**
 * cloud-sync-deadlock.test.ts
 *
 * Tests the try/finally guarantee in flushSyncQueue:
 *   - isFlushing ALWAYS resets to false, even on errors
 *   - Second concurrent flush call is a no-op
 */

// Must mock before imports
const mockGetSyncQueue = jest.fn(() => [] as any[]);
const mockRemoveSyncItem = jest.fn();
const mockEnqueueSync = jest.fn();

jest.mock("../../electron/services/local-store", () => ({
  getSyncQueue: (...args: any[]) => mockGetSyncQueue(...args),
  removeSyncItem: (...args: any[]) => mockRemoveSyncItem(...args),
  enqueueSync: (...args: any[]) => mockEnqueueSync(...args),
  updateLocalRecord: jest.fn(),
}));

jest.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  BrowserWindow: { getAllWindows: () => [] },
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => null),
}));

import { SyncManager } from "../../electron/services/cloud-sync";

const ITEM = {
  id: "1",
  table_name: "conversations",
  operation: "INSERT" as const,
  data: { id: "1" },
  timestamp: new Date().toISOString(),
};

class TestableSyncManager extends SyncManager {
  get flushing() { return (this as any).isFlushing as boolean; }
  async triggerFlush() { return (this as any).flushSyncQueue(); }
  setOnline(v: boolean) { (this as any).isOnline = v; }
  injectSupabase(client: any) { (this as any).supabase = client; }
}

describe("SyncManager - isFlushing deadlock prevention", () => {
  let manager: TestableSyncManager;

  beforeEach(() => {
    manager = new TestableSyncManager();
    manager.setOnline(true);
    mockGetSyncQueue.mockReturnValue([]);
    mockRemoveSyncItem.mockClear();
  });

  test("isFlushing is false initially", () => {
    expect(manager.flushing).toBe(false);
  });

  test("isFlushing is false after flush of empty queue (no supabase)", async () => {
    mockGetSyncQueue.mockReturnValue([]);
    await manager.triggerFlush();
    expect(manager.flushing).toBe(false);
  });

  test("isFlushing resets to false even when supabase throws on upsert", async () => {
    const throwingClient = {
      from: () => ({ upsert: jest.fn().mockRejectedValue(new Error("net fail")) }),
    };
    manager.injectSupabase(throwingClient);
    // First call returns 1 item, after that empty (so recursion stops)
    mockGetSyncQueue
      .mockReturnValueOnce([ITEM])
      .mockReturnValue([]);

    await manager.triggerFlush();

    expect(manager.flushing).toBe(false);
  });

  test("second concurrent flush is no-op while first is running", async () => {
    let resolveUpsert!: () => void;
    const barrier = new Promise<void>(r => { resolveUpsert = r; });

    const upsertMock = jest.fn().mockImplementation(() => barrier.then(() => ({ error: null })));
    const slowClient = {
      from: () => ({ upsert: upsertMock }),
    };
    manager.injectSupabase(slowClient);

    mockGetSyncQueue.mockReturnValue([ITEM]);

    // Start first flush; do not await
    const p1 = manager.triggerFlush();
    // Second should bail immediately on isFlushing === true
    const p2 = manager.triggerFlush();

    resolveUpsert();
    mockGetSyncQueue.mockReturnValue([]);
    await Promise.all([p1, p2]);

    // upsert was only called once — second flush was a no-op
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(manager.flushing).toBe(false);
  });
});
