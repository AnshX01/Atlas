import { classifyIntent, resolveEntities, splitMultiIntent, resetClassifierCache } from '../../electron/services/intent-classifier';
import * as ollama from '../../electron/services/ollama';

jest.mock('../../electron/services/ollama', () => ({
  checkOllamaHealth: jest.fn(),
  streamChat: jest.fn(),
}));

describe('Intent Classifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetClassifierCache();
  });

  describe('classifyIntent', () => {
    it('handles network failure (Ollama offline) gracefully by using keyword fallback', async () => {
      (ollama.checkOllamaHealth as jest.Mock).mockRejectedValue(new Error('Network error'));
      const result = await classifyIntent('find emails from John');
      expect(result.intent).toBe('search');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('handles corrupted model JSON output gracefully (JSON parse failure)', async () => {
      (ollama.checkOllamaHealth as jest.Mock).mockResolvedValue({ available: true, models: ['llama3:8b'] });
      
      const mockGenerator = async function* () {
        yield 'invalid json output without brackets';
      };
      (ollama.streamChat as jest.Mock).mockReturnValue(mockGenerator());

      const result = await classifyIntent('send an email to Alice');
      // Should fallback to keywords
      expect(result.intent).toBe('action');
    });

    it('handles abort signals gracefully (simulated via timeout)', async () => {
      (ollama.checkOllamaHealth as jest.Mock).mockResolvedValue({ available: true, models: ['llama3:8b'] });
      
      const mockGenerator = async function* () {
        yield '{"intent": "chat", "confidence": 0.9}';
      };
      (ollama.streamChat as jest.Mock).mockImplementation((messages, model, signal) => {
        if (!signal) console.error("No signal passed!"); else console.log("Signal passed:", signal);
        return mockGenerator();
      });

      const result = await classifyIntent('hello there');
      expect(result.intent).toBe('chat');
    });
  });

  describe('resolveEntities', () => {
    it('handles stream failure gracefully (returns original input)', async () => {
      const mockGenerator = async function* () {
        throw new Error('Stream failed');
      };
      (ollama.streamChat as jest.Mock).mockReturnValue(mockGenerator());

      const history = [{ role: 'user', content: 'where is the report' }, { role: 'assistant', content: 'it is here' }];
      const controller = new AbortController(); const result = await resolveEntities('can you send it to me', history, controller.signal);
      expect(result).toBe('can you send it to me');
    });

    it('passes abort signal correctly', async () => {
      const mockGenerator = async function* () {
        yield 'can you send the report to me';
      };
      (ollama.streamChat as jest.Mock).mockImplementation((messages, model, signal) => {
        if (!signal) console.error("No signal passed!"); else console.log("Signal passed:", signal);
        return mockGenerator();
      });

      const history = [{ role: 'user', content: 'where is the report' }, { role: 'assistant', content: 'it is here' }];
      const controller = new AbortController(); const result = await resolveEntities('can you send it to me', history, controller.signal);
      expect(result).toBe('can you send the report to me');
    });
  });

  describe('splitMultiIntent', () => {
    it('handles stream failure gracefully (returns original input array)', async () => {
      const mockGenerator = async function* () {
        throw new Error('Stream failed');
      };
      (ollama.streamChat as jest.Mock).mockReturnValue(mockGenerator());

      const input = 'find emails and send reply';
      const controller = new AbortController(); const result = await splitMultiIntent(input, controller.signal);
      expect(result).toEqual([input]);
    });

    it('handles corrupted JSON output gracefully', async () => {
      const mockGenerator = async function* () {
        yield 'here is the list: [ "find emails" and "send reply"'; // corrupted
      };
      (ollama.streamChat as jest.Mock).mockReturnValue(mockGenerator());

      const input = 'find emails and send reply';
      const controller = new AbortController(); const result = await splitMultiIntent(input, controller.signal);
      expect(result).toEqual([input]);
    });
    
    it('passes abort signal correctly', async () => {
      const mockGenerator = async function* () {
        yield '["find emails", "send reply"]';
      };
      (ollama.streamChat as jest.Mock).mockImplementation((messages, model, signal) => {
        if (!signal) console.error("No signal passed!"); else console.log("Signal passed:", signal);
        return mockGenerator();
      });

      const input = 'find emails and send reply';
      const controller = new AbortController(); const result = await splitMultiIntent(input, controller.signal);
      expect(result).toEqual(["find emails", "send reply"]);
    });
  });
});
