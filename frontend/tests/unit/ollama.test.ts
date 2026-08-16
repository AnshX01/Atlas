/**
 * @jest-environment node
 * 
 * Tests for ollama.ts hardening:
 * - 404 user-friendly error messages
 * - generateEmbedding timeout
 * - streamChat abort handling
 * - checkHealth offline behavior
 * - verifyInference with no models
 */

// Polyfill AbortSignal.timeout if not available (older Node versions)
if (!AbortSignal.timeout) {
  (AbortSignal as any).timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

import { streamChat, generateEmbedding, checkHealth, verifyInference, chat } from '../../electron/services/ollama';

// Save original fetch
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('ollama.ts hardening', () => {
  describe('test_stream_chat_404_user_friendly_error', () => {
    test('streamChat throws user-friendly error when model is not found (404)', async () => {
      global.fetch = jest.fn(async (url: string | URL | Request, _options?: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'test-model' }] }), { status: 200 });
        }
        if (urlStr.includes('/api/chat')) {
          return new Response('model not found', { status: 404 });
        }
        return new Response('ok', { status: 200 });
      }) as any;

      const generator = streamChat(
        [{ role: 'user', content: 'hello' }],
        'nonexistent-model'
      );

      let thrownError: Error | undefined;
      try {
        for await (const _token of generator) {
          // Should throw before yielding any token
        }
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError!.message).toContain('not installed');
      expect(thrownError!.message).toContain('nonexistent-model');
      expect(thrownError!.message).toContain('ollama pull');
    });
  });

  describe('test_chat_404_user_friendly_error', () => {
    test('chat throws user-friendly error when model is not found (404)', async () => {
      global.fetch = jest.fn(async (_url: string | URL | Request, _options?: any) => {
        return new Response('model not found', { status: 404 });
      }) as any;

      let thrownError: Error | undefined;
      try {
        await chat([{ role: 'user', content: 'hello' }], 'my-missing-model');
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError!.message).toContain('my-missing-model');
      expect(thrownError!.message).toContain('not installed');
      expect(thrownError!.message).toContain('ollama pull');
    });
  });

  describe('test_generate_embedding_timeout', () => {
    test('generateEmbedding passes a signal to fetch (timeout mechanism wired)', async () => {
      let receivedSignal: AbortSignal | undefined;

      global.fetch = jest.fn(async (url: string | URL | Request, options?: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'nomic-embed-text' }] }), { status: 200 });
        }
        if (urlStr.includes('/api/embeddings')) {
          receivedSignal = options?.signal;
          // Simulate immediate abort for testing
          if (options?.signal) {
            return new Promise<Response>((_resolve, reject) => {
              const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
              if (options.signal.aborted) {
                onAbort();
              } else {
                options.signal.addEventListener('abort', onAbort);
              }
            });
          }
        }
        return new Response('ok', { status: 200 });
      }) as any;

      // Start the call — it will hang until we can check the signal
      const promise = generateEmbedding('test text');

      // Give it a tick to make the fetch call
      await new Promise(r => setTimeout(r, 50));

      // Verify the signal was passed
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal instanceof AbortSignal).toBe(true);

      // The promise will eventually reject due to timeout or we can just let it hang.
      // For test purposes, abort manually to clean up:
      // (The real AbortSignal.timeout(30000) will fire on its own — we verified it's wired)
      try {
        await Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('test-timeout')), 100))
        ]);
      } catch {
        // Expected — either AbortError or our test timeout
      }
    });
  });

  describe('test_stream_chat_aborts_on_signal', () => {
    test('streamChat throws abort error when external signal is aborted', async () => {
      const abortController = new AbortController();

      global.fetch = jest.fn(async (url: string | URL | Request, options?: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'llama3:8b' }] }), { status: 200 });
        }
        // For /api/chat, wait for abort
        return new Promise<Response>((_resolve, reject) => {
          if (options?.signal) {
            if (options.signal.aborted) {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
              return;
            }
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
        });
      }) as any;

      // Abort before data arrives
      setTimeout(() => abortController.abort(), 50);

      let thrownError: Error | undefined;
      try {
        const generator = streamChat(
          [{ role: 'user', content: 'hello' }],
          'llama3:8b',
          abortController.signal
        );
        for await (const _token of generator) {
          // Should not get here
        }
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError!.name === 'AbortError' || thrownError!.message.includes('abort')).toBe(true);
    }, 5000);
  });

  describe('test_check_health_offline', () => {
    test('checkHealth returns available:false without throwing when connection refused', async () => {
      global.fetch = jest.fn(async () => {
        const err = new Error('fetch failed');
        (err as any).cause = { code: 'ECONNREFUSED' };
        throw err;
      }) as any;

      const result = await checkHealth();
      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });
  });

  describe('test_verify_inference_returns_false_when_no_models', () => {
    test('verifyInference returns false when listModels returns empty array', async () => {
      global.fetch = jest.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [] }), { status: 200 });
        }
        return new Response('ok', { status: 200 });
      }) as any;

      const result = await verifyInference();
      expect(result).toBe(false);
    });
  });
});
