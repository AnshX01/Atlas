import { streamChat } from './ollama';

const { TextDecoder, TextEncoder } = require('util');
global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;
global.AbortSignal.timeout = jest.fn().mockReturnValue(new AbortController().signal);

jest.mock('os');
jest.mock('fs');
jest.mock('child_process');
jest.mock('https');

const originalFetch = global.fetch;

describe('Ollama service flaws', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('streamChat handles invalid JSON without silent failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let called = false;
          return {
            read: async () => {
              if (!called) {
                called = true;
                return { done: false, value: new TextEncoder().encode('invalid_json{') };
              }
              return { done: true };
            },
            releaseLock: jest.fn(),
          };
        }
      }
    });

    const messages = [{ role: 'user', content: 'test' }] as any;
    
    // The current code ignores invalid JSON and yields nothing. We want it to throw an error
    // instead of silently skipping it.
    await expect(async () => {
      for await (const chunk of streamChat(messages, 'llama3:8b')) {
        // do nothing
      }
    }).rejects.toThrow(SyntaxError);
  });

  it('streamChat cleans up abort listener', async () => {
    const abortSignal = new AbortController().signal;
    const addSpy = jest.spyOn(abortSignal, 'addEventListener');
    const removeSpy = jest.spyOn(abortSignal, 'removeEventListener');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({ done: true }),
          releaseLock: jest.fn(),
        })
      }
    });

    for await (const chunk of streamChat([], 'test', abortSignal)) {}

    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

});
