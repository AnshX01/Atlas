/**
 * Atlas — Local Ollama LLM Integration
 * Manages connection to local Ollama daemon for:
 * - Chat completion with streaming
 * - Text embeddings
 * - Health checks
 */

const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3:8b';
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaHealthStatus {
  available: boolean;
  models: string[];
  error?: string;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    modified_at: string;
    size: number;
    digest: string;
  }>;
}

interface OllamaChatStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * Check if Ollama is running and return available models.
 */
export async function checkHealth(): Promise<OllamaHealthStatus> {
  try {
    const response = await fetch(OLLAMA_BASE_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        available: false,
        models: [],
        error: `Ollama returned status ${response.status}`,
      };
    }

    const text = await response.text();
    if (!text.includes('Ollama is running')) {
      return {
        available: false,
        models: [],
        error: `Unexpected response from Ollama: ${text.slice(0, 100)}`,
      };
    }

    // Ollama is running, fetch available models
    const models = await listModels();

    return {
      available: true,
      models,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Unknown error connecting to Ollama';
    return {
      available: false,
      models: [],
      error: `Cannot reach Ollama at ${OLLAMA_BASE_URL}: ${message}`,
    };
  }
}

/**
 * List available models from the local Ollama instance.
 */
export async function listModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: HTTP ${response.status}`);
    }

    const data = (await response.json()) as OllamaTagsResponse;
    return data.models.map((m) => m.name);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('Failed to list models')) {
      throw err;
    }
    throw new Error(
      `Cannot retrieve models from Ollama: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

/**
 * Stream chat completion from Ollama. Yields individual token strings as they arrive.
 *
 * @param messages - Array of chat messages
 * @param model - Model to use (defaults to llama3:8b)
 */
export async function* streamChat(
  messages: OllamaMessage[],
  model: string = DEFAULT_MODEL,
  abortSignal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const controller = new AbortController();
  // Inactivity timeout — aborts if no data received for 120s (accounts for model cold start)
  let inactivityTimer = setTimeout(() => controller.abort(), 120000);

  const resetInactivityTimer = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), 120000);
  };

  if (abortSignal) {
    abortSignal.addEventListener('abort', () => controller.abort());
    if (abortSignal.aborted) controller.abort();
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Ollama chat stream failed (HTTP ${response.status}): ${errorText}`
    );
  }

  if (!response.body) {
    throw new Error('Ollama returned no response body for streaming chat');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      resetInactivityTimer();

      if (done) {
        // Process any remaining buffer content
        if (buffer.trim()) {
          try {
            const chunk = JSON.parse(buffer.trim()) as OllamaChatStreamChunk;
            if (chunk.message?.content) {
              yield chunk.message.content;
            }
          } catch {
            // Ignore incomplete trailing data
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // NDJSON: each line is a separate JSON object
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const chunk = JSON.parse(trimmed) as OllamaChatStreamChunk;
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } finally {
    clearTimeout(inactivityTimer);
    reader.releaseLock();
  }
}

/**
 * Generate an embedding vector for the given text.
 *
 * @param text - Text to embed
 * @param model - Embedding model (defaults to nomic-embed-text)
 * @returns Array of floating-point numbers representing the embedding
 */
export async function generateEmbedding(
  text: string,
  model: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[]> {
  if (!text.trim()) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Ollama embedding generation failed (HTTP ${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as OllamaEmbeddingResponse;

  if (!Array.isArray(data.embedding)) {
    throw new Error('Ollama returned invalid embedding response (missing embedding array)');
  }

  return data.embedding;
}

/**
 * Non-streaming chat completion for quick classification or short responses.
 *
 * @param messages - Array of chat messages
 * @param model - Model to use (defaults to llama3:8b)
 * @returns The assistant's response content
 */
export async function chat(
  messages: OllamaMessage[],
  model: string = DEFAULT_MODEL
): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Ollama chat failed (HTTP ${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as OllamaChatResponse;

  if (!data.message?.content) {
    throw new Error('Ollama returned empty chat response');
  }

  return data.message.content;
}


// Aliases for backward compatibility
export const checkOllamaHealth = checkHealth;
export const getHealthStatus = checkHealth;
export const getAvailableModels = listModels;
