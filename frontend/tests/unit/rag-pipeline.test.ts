

import * as memoryRag from '../../electron/services/memory-rag';
import * as ollama from '../../electron/services/ollama';

jest.mock('electron', () => ({ app: { getPath: jest.fn().mockReturnValue('') } }));
jest.mock('../../electron/services/ollama', () => ({
  generateEmbedding: jest.fn(),
  chat: jest.fn(),
}));

describe('RAG Pipeline (Phase 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should store and check semantic cache', async () => {
    (ollama.generateEmbedding as any).mockResolvedValue([0.1, 0.2, 0.3]);
    await memoryRag.storeInSemanticCache('test query', 'cached response');
    
    // Exact match
    (ollama.generateEmbedding as any).mockResolvedValue([0.1, 0.2, 0.3]);
    let result = await memoryRag.checkSemanticCache('test query', 0.95);
    expect(result).toBe('cached response');

    // Mismatch
    (ollama.generateEmbedding as any).mockResolvedValue([0.9, 0.8, 0.7]);
    result = await memoryRag.checkSemanticCache('different query', 0.95);
    expect(result).toBeNull();
  });

  it('should rerank documents using cross-encoder', async () => {
    const docs = ['Doc A', 'Doc B', 'Doc C'];
    (ollama.chat as any).mockResolvedValue('[2, 9, 5]'); // B > C > A

    const reranked = await memoryRag.crossEncoderRerank('test query', docs, 3);
    
    expect(reranked.length).toBe(3);
    expect(reranked[0]).toBe('Doc B');
    expect(reranked[1]).toBe('Doc C');
    expect(reranked[2]).toBe('Doc A');
  });

  it('should handle cross-encoder fallback on invalid JSON', async () => {
    const docs = ['Doc A', 'Doc B', 'Doc C'];
    (ollama.chat as any).mockResolvedValue('invalid output'); 

    const reranked = await memoryRag.crossEncoderRerank('test query', docs, 3);
    
    expect(reranked.length).toBe(3);
    expect(reranked[0]).toBe('Doc A'); // original order
  });

  it('should handle network failures gracefully in searchContext', async () => {
    (ollama.generateEmbedding as any).mockRejectedValue(new Error('Network error'));
    
    // Attempting to search with network failure should return empty array safely
    const result = await memoryRag.searchContext('test query', 3);
    expect(result).toEqual([]);
  });

  it('should pass abort signal (timeout) to crossEncoderRerank chat', async () => {
    const docs = ['Doc A', 'Doc B', 'Doc C'];
    (ollama.chat as any).mockImplementation((messages, model, timeout) => {
      expect(timeout).toBe(30000); // Verify timeout is passed to prevent hanging
      return Promise.resolve('[2, 9, 5]');
    });

    const reranked = await memoryRag.crossEncoderRerank('test query', docs, 3);
    expect(reranked[0]).toBe('Doc B');
  });

  it('should handle network failures gracefully in crossEncoderRerank', async () => {
    const docs = ['Doc A', 'Doc B', 'Doc C'];
    (ollama.chat as any).mockRejectedValue(new Error('Network failure'));

    const reranked = await memoryRag.crossEncoderRerank('test query', docs, 3);
    
    expect(reranked.length).toBe(3);
    expect(reranked[0]).toBe('Doc A'); // original order
  });
});
