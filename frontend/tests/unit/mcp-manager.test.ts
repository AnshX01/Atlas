/**
 * @jest-environment node
 * 
 * Tests for mcp-manager.ts hardening:
 * - Process exit rejects pending requests
 * - Exponential backoff timing
 * - stderr handler wired
 * 
 * Strategy: We fire startServer (non-awaited) to trigger spawn and handler attachment,
 * then directly emit events on the mock process. We don't await startServer since
 * its initialize handshake will never complete with a mock process.
 */
import { EventEmitter } from 'events';

// Create mock process factory
function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: jest.fn((data: string, cb?: Function) => { if (cb) cb(); }),
    on: jest.fn(),
  };
  proc.pid = 12345;
  proc.kill = jest.fn();
  return proc;
}

// Capture spawned processes
let latestMockProcess: any = null;
const mockSpawn = jest.fn(() => {
  latestMockProcess = createMockProcess();
  return latestMockProcess;
});

jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  exec: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock('../../electron/services/token-store', () => ({
  getToken: jest.fn().mockReturnValue({ personal_access_token: 'test-token' }),
}));

jest.mock('../../electron/services/connectors/gmail', () => ({
  GmailConnector: jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(false),
  })),
}));
jest.mock('../../electron/services/connectors/notion', () => ({
  NotionConnector: jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(false),
  })),
}));

import { MCPServerManager } from '../../electron/services/mcp-manager';

describe('MCPServerManager hardening', () => {
  beforeEach(() => {
    latestMockProcess = null;
    mockSpawn.mockClear();
  });

  describe('test_process_exit_rejects_pending_requests', () => {
    test('pending requests are rejected when MCP server process exits', async () => {
      const manager = new MCPServerManager();

      // Fire-and-forget startServer — we only need it to spawn the process and attach handlers
      // DO NOT await — the initialization handshake will never complete with a mock
      manager.startServer('github').catch(() => {});

      // Wait for spawn to be called and handlers attached (synchronous after spawn)
      await new Promise(r => setTimeout(r, 50));
      expect(latestMockProcess).not.toBeNull();

      // Inject a pending request for 'github'
      const pendingRequests = (manager as any).pendingRequests as Map<number, any>;
      let rejectedError: Error | undefined;
      const timeoutHandle = setTimeout(() => {}, 30000);
      pendingRequests.set(999, {
        serverName: 'github',
        resolve: jest.fn(),
        reject: (err: Error) => { rejectedError = err; },
        timeout: timeoutHandle,
      });

      // Emit exit event
      latestMockProcess.emit('exit', 1);

      // Verify the pending request was rejected
      expect(rejectedError).toBeDefined();
      expect(rejectedError!.message).toContain("'github'");
      expect(rejectedError!.message).toContain('exited unexpectedly');
      expect(pendingRequests.has(999)).toBe(false);

      clearTimeout(timeoutHandle);
    });
  });

  describe('test_exponential_backoff_timing', () => {
    test('backoff formula produces correct delays', () => {
      const backoff = (restartCount: number) => Math.min(1000 * Math.pow(2, restartCount), 60000);

      expect(backoff(0)).toBe(1000);
      expect(backoff(1)).toBe(2000);
      expect(backoff(2)).toBe(4000);
      expect(backoff(3)).toBe(8000);
      expect(backoff(4)).toBe(16000);
      expect(backoff(5)).toBe(32000);
      expect(backoff(6)).toBe(60000);  // capped
      expect(backoff(10)).toBe(60000); // still capped
    });

    test('restart count increments and startServer is scheduled on exit', async () => {
      const manager = new MCPServerManager();

      // Fire-and-forget
      manager.startServer('github').catch(() => {});
      await new Promise(r => setTimeout(r, 50));
      expect(latestMockProcess).not.toBeNull();

      // Check server state before exit
      const servers = (manager as any).servers as Map<string, any>;
      const server = servers.get('github')!;
      expect(server.restartCount).toBe(0);

      // Spy on startServer for restart detection
      const startServerSpy = jest.spyOn(manager, 'startServer').mockResolvedValue(true);

      // Emit exit
      latestMockProcess.emit('exit', 1);

      // restartCount should have incremented
      expect(server.restartCount).toBe(1);

      // startServer should not have been called yet (it's scheduled with setTimeout)
      expect(startServerSpy).not.toHaveBeenCalled();

      // Wait for the backoff delay (1000ms for first restart)
      await new Promise(r => setTimeout(r, 1200));

      // Now startServer should have been called
      expect(startServerSpy).toHaveBeenCalledWith('github');

      startServerSpy.mockRestore();
    });
  });

  describe('test_stderr_handler_wired', () => {
    test('stderr data listener is registered on spawned process', async () => {
      const manager = new MCPServerManager();

      // Fire-and-forget
      manager.startServer('github').catch(() => {});
      await new Promise(r => setTimeout(r, 50));
      expect(latestMockProcess).not.toBeNull();

      // Check that stderr has a 'data' listener
      const stderrListeners = latestMockProcess.stderr.listenerCount('data');
      expect(stderrListeners).toBeGreaterThan(0);

      // Verify stderr logs with the correct format
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      latestMockProcess.stderr.emit('data', Buffer.from('some error output'));

      const stderrCalls = consoleSpy.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('[MCP:github:stderr]')
      );
      expect(stderrCalls.length).toBeGreaterThan(0);
      expect(stderrCalls[0][0]).toContain('some error output');

      consoleSpy.mockRestore();
    });
  });
});
