
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../../electron/services/orchestrator';
import { MCPServerManager } from '../../electron/services/mcp-manager';
import * as localStore from '../../electron/services/local-store';

vi.mock('electron', () => ({ app: { getPath: vi.fn().mockReturnValue('') }, BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) } }));
vi.mock('../../electron/services/cloud-sync', () => ({ syncManager: { queueDelta: vi.fn() } }));
vi.mock('../../electron/services/mcp-manager', () => ({ MCPServerManager: class { constructor() {} } }));
vi.mock('../../electron/services/local-store', () => ({
  initDB: vi.fn(),
  createConversation: vi.fn(),
  saveMessage: vi.fn(),
  getConversationHistory: vi.fn().mockReturnValue([]),
  saveToolExecution: vi.fn(),
  saveWorkflowCheckpoint: vi.fn(),
  deleteWorkflowCheckpoint: vi.fn(),
  getAllWorkflowCheckpoints: vi.fn(),
}));

describe('Orchestrator State Recovery', () => {
  let mcpManager: MCPServerManager;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    mcpManager = new MCPServerManager();
    orchestrator = new Orchestrator(mcpManager);
  });

  it('should recover checkpoints and restore pending approvals', async () => {
    const mockState = {
      conversationId: '1234',
      input: 'delete file',
      intent: 'action',
      context: [],
      toolCalls: [],
      response: '',
      requiresApproval: true,
      approved: false,
      draft: { executionId: 'exe-1' }
    };

    (localStore.getAllWorkflowCheckpoints as any).mockReturnValue([
      { conversationId: '1234', state: mockState }
    ]);

    const mockMainWindow = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as any;

    // Trigger recovery
    // Promise won't resolve immediately because it waits for approval
    const recoverPromise = orchestrator.recoverCheckpoints(mockMainWindow);

    // Mock resolving the approval
    setTimeout(() => {
      // Find the pending approval
      const pending = (orchestrator as any).pendingApprovals.get('1234');
      if (pending) {
        pending.resolve(true); // Approve
      }
    }, 50);

    await recoverPromise;

    expect(localStore.getAllWorkflowCheckpoints).toHaveBeenCalled();
    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('workflow-draft-ready', expect.any(Object));
    expect(localStore.deleteWorkflowCheckpoint).toHaveBeenCalledWith('1234');
  });

  it('should clean up checkpoint if state does not require approval', async () => {
    const mockState = {
      conversationId: '5678',
      input: 'search file',
      intent: 'search',
      context: [],
      toolCalls: [],
      response: '',
      requiresApproval: false,
      approved: false
    };

    (localStore.getAllWorkflowCheckpoints as any).mockReturnValue([
      { conversationId: '5678', state: mockState }
    ]);

    const mockMainWindow = { webContents: { send: vi.fn() } } as any;
    await orchestrator.recoverCheckpoints(mockMainWindow);

    expect(localStore.deleteWorkflowCheckpoint).toHaveBeenCalledWith('5678');
  });
});
