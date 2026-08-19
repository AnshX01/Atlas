import { Orchestrator } from './orchestrator';

describe('Orchestrator flaws', () => {
  it('generateDraft does not swallow AbortError', async () => {
    const orchestrator = new Orchestrator({} as any);
    const abortController = new AbortController();
    abortController.abort(); // already aborted

    // Test that generateDraft throws if aborted
    await expect((orchestrator as any).generateDraft(
      'send_email', 'hello', [], '', '', abortController.signal
    )).rejects.toThrow();
  });

  it('evaluateDraft does not swallow AbortError', async () => {
    const orchestrator = new Orchestrator({} as any);
    const abortController = new AbortController();
    abortController.abort(); // already aborted

    // Test that evaluateDraft throws if aborted
    await expect((orchestrator as any).evaluateDraft(
      'send_email', {}, 'hello', '{}', abortController.signal
    )).rejects.toThrow();
  });

  it('truncates large context in responseNode for actions', async () => {
    const orchestrator = new Orchestrator({} as any);
    const state: any = {
      intent: 'action',
      input: 'do it',
      context: [
        {
          type: 'tool_result',
          result: { big: 'x'.repeat(2000) } // Very large context
        }
      ]
    };
    
    // Check buildResponseMessages output size
    const messages = await (orchestrator as any).buildResponseMessages(state, []);
    const systemMsg = messages.find((m: any) => m.role === 'system' && m.content.includes('Tool results'));
    expect(systemMsg.content.length).toBeLessThan(1000); // Should be truncated
  });
});
