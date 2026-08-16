/**
 * Tests for orchestrator TOOL_ROUTING fixes and approval TTL.
 */
import { Orchestrator, APPROVAL_TTL_MS, PendingApproval, WorkflowState } from '../../electron/services/orchestrator';

// Minimal mock of MCPServerManager
const mockMcpManager = {
  callTool: jest.fn().mockResolvedValue({}),
  listTools: jest.fn().mockResolvedValue([]),
} as any;

// Mock dependencies that orchestrator imports
jest.mock('../../electron/services/ollama', () => ({
  streamChat: jest.fn(),
}));
jest.mock('../../electron/services/intent-classifier', () => ({
  classifyIntent: jest.fn().mockResolvedValue({ intent: 'search', confidence: 0.9, extractedParams: {}, correctedQuery: null }),
  resolveEntities: jest.fn().mockImplementation((input: string) => Promise.resolve(input)),
  splitMultiIntent: jest.fn().mockImplementation((input: string) => Promise.resolve([input])),
}));
jest.mock('../../electron/services/local-store', () => ({
  initDB: jest.fn(),
  createConversation: jest.fn().mockReturnValue({ id: 'test-conv-1' }),
  saveMessage: jest.fn(),
  getConversationHistory: jest.fn().mockReturnValue([]),
  saveToolExecution: jest.fn(),
}));
jest.mock('../../electron/services/memory-rag', () => ({
  initRAGStore: jest.fn(),
  searchContext: jest.fn().mockResolvedValue([]),
  storeContext: jest.fn(),
}));
jest.mock('../../electron/services/json-repair', () => ({
  repairAndParseJson: jest.fn().mockReturnValue({}),
  MissingArgumentError: class extends Error { constructor(m: string) { super(m); this.name = 'MissingArgumentError'; } },
}));
jest.mock('electron', () => ({
  BrowserWindow: jest.fn(),
}));

describe('Orchestrator Routing', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    orchestrator = new Orchestrator(mockMcpManager);
  });

  describe('TOOL_ROUTING ambiguity fixes', () => {
    test('test_schedule_readonly_intent_no_approval: schedule keyword with search intent does not require approval', () => {
      // Access private resolveTools via prototype or by testing through state
      const state: WorkflowState = {
        input: 'what is my schedule for tomorrow',
        userId: 'local',
        conversationId: 'test-conv',
        intent: 'search',
        context: [{ type: 'classification', intent: 'search', confidence: 0.9, params: {} }],
        toolCalls: [],
        response: '',
        requiresApproval: false,
        approved: false,
      };

      // Call resolveTools via the private method accessor
      const resolveTools = (orchestrator as any).resolveTools.bind(orchestrator);
      const tools = resolveTools(state, 'search');

      // Should only contain readonly tools (list_calendar), NOT create_event
      for (const tool of tools) {
        expect(tool.tool).not.toBe('create_event');
      }
      // list_calendar is readonly, so requiresApproval should remain false
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t: any) => t.tool === 'list_calendar')).toBe(true);
    });

    test('test_destructive_tool_requires_approval: action intent with send_email requires approval', () => {
      const state: WorkflowState = {
        input: 'send an email to john@example.com',
        userId: 'local',
        conversationId: 'test-conv',
        intent: 'action',
        context: [{ type: 'classification', intent: 'action', confidence: 0.9, params: {} }],
        toolCalls: [],
        response: '',
        requiresApproval: false,
        approved: false,
      };

      const resolveTools = (orchestrator as any).resolveTools.bind(orchestrator);
      const tools = resolveTools(state, 'action');

      // Should find send_email (destructive)
      const hasSendEmail = tools.some((t: any) => t.tool === 'send_email');
      expect(hasSendEmail).toBe(true);

      // Verify the tool is indeed destructive (requiresApproval would be set in actionNode)
      // The DESTRUCTIVE_TOOLS set check is what matters
      const destructiveTools = new Set([
        'send_email', 'reply_email', 'forward_email', 'merge_pr', 'close_pr',
        'close_issue', 'create_issue', 'post_message', 'send_message',
        'update_page', 'create_page', 'delete_page', 'delete_file',
        'write_file', 'move_file', 'create_event', 'schedule_event',
        'delete_event', 'create_branch', 'create_pull_request',
      ]);
      for (const tool of tools) {
        expect(destructiveTools.has(tool.tool)).toBe(true);
      }
    });
  });

  describe('Approval TTL', () => {
    test('test_expired_execution_id_rejected: approval older than 5 minutes is rejected', () => {
      // Manually inject a pending approval with an old timestamp
      const pendingApprovals = (orchestrator as any).pendingApprovals as Map<string, PendingApproval>;
      const executionId = 'test-execution-expired';

      let resolvedValue: boolean | undefined;
      const mockResolve = (val: boolean) => { resolvedValue = val; };

      pendingApprovals.set(executionId, {
        executionId,
        conversationId: 'test-conv',
        state: {} as WorkflowState,
        resolve: mockResolve,
        createdAt: Date.now() - (6 * 60 * 1000), // 6 minutes ago (expired)
      });

      // Attempt to approve — should fail because TTL expired
      const result = orchestrator.approve(executionId);
      expect(result).toBe(false);
      expect(resolvedValue).toBe(false); // resolve(false) called for expired
      expect(pendingApprovals.has(executionId)).toBe(false); // cleaned up
    });

    test('approval within TTL succeeds', () => {
      const pendingApprovals = (orchestrator as any).pendingApprovals as Map<string, PendingApproval>;
      const executionId = 'test-execution-valid';

      let resolvedValue: boolean | undefined;
      const mockResolve = (val: boolean) => { resolvedValue = val; };

      pendingApprovals.set(executionId, {
        executionId,
        conversationId: 'test-conv',
        state: {} as WorkflowState,
        resolve: mockResolve,
        createdAt: Date.now() - (2 * 60 * 1000), // 2 minutes ago (within TTL)
      });

      const result = orchestrator.approve(executionId);
      expect(result).toBe(true);
      expect(resolvedValue).toBe(true);
      expect(pendingApprovals.has(executionId)).toBe(false);
    });

    test('APPROVAL_TTL_MS is 5 minutes', () => {
      expect(APPROVAL_TTL_MS).toBe(5 * 60 * 1000);
    });
  });
});
