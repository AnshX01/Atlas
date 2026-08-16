/**
 * Atlas — Local Ollama LLM Integration
 * Manages connection to local Ollama daemon for:
 * - Chat completion with streaming
 * - Text embeddings
 * - Health checks
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, exec } from 'child_process';

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
  // Inactivity timeout — aborts if no data received for 10 minutes (accounts for model cold start on slow systems)
  let inactivityTimer = setTimeout(() => controller.abort(), 600000);

  const resetInactivityTimer = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), 600000);
  };

  if (abortSignal) {
    abortSignal.addEventListener('abort', () => controller.abort());
    if (abortSignal.aborted) controller.abort();
  }

  // Fallback: If using default model, try to use the first available model if default is not installed
  if (model === DEFAULT_MODEL) {
    try {
      const models = await listModels();
      // Look for an exact match or a match that starts with the model name (e.g., llama3:8b:latest)
      const exactMatch = models.includes(DEFAULT_MODEL);
      if (models.length > 0 && !exactMatch) {
        const chatModels = models.filter(m => !m.toLowerCase().includes('embed'));
        if (chatModels.length > 0) {
          model = chatModels[0];
          console.log(`[Ollama] ${DEFAULT_MODEL} not found, falling back to ${model}`);
        }
      }
    } catch (err) {
      console.warn("[Ollama] Could not list models for fallback check:", err);
    }
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
    if (response.status === 404) {
      throw new Error(`Model '${model}' is not installed. Run: ollama pull ${model}`);
    }
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
            const chunk = JSON.parse(buffer.trim()) as OllamaChatStreamChunk & { error?: string };
            if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`);
            if (chunk.message?.content) {
              yield chunk.message.content;
            }
          } catch (e: any) {
            if (e.message.startsWith('Ollama stream error:')) throw e;
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
          const chunk = JSON.parse(trimmed) as OllamaChatStreamChunk & { error?: string };
          if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`);
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
        } catch (e: any) {
          if (e.message.startsWith('Ollama stream error:')) throw e;
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

  // Fallback: If using default embedding model, try to use the first available model if default is not installed
  if (model === DEFAULT_EMBEDDING_MODEL) {
    try {
      const models = await listModels();
      if (models.length > 0 && !models.includes(DEFAULT_EMBEDDING_MODEL)) {
        const embedModels = models.filter(m => m.toLowerCase().includes('embed'));
        if (embedModels.length > 0) {
          model = embedModels[0];
          console.log(`[Ollama] ${DEFAULT_EMBEDDING_MODEL} not found, falling back to ${model} for embeddings`);
        }
      }
    } catch (err) {
      console.warn("[Ollama] Could not list models for embedding fallback check:", err);
    }
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: text,
    }),
    signal: AbortSignal.timeout(30000),
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
  model: string = DEFAULT_MODEL,
  timeoutMs: number = 600000
): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    if (response.status === 404) {
      throw new Error(`Model '${model}' is not installed. Run: ollama pull ${model}`);
    }
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

/**
 * Verify that inference actually works by sending a tiny prompt.
 * Tries a quick 10s check first (model may already be in memory),
 * then falls back to a full 60s timeout for cold model loads.
 */
export async function verifyInference(): Promise<boolean> {
  try {
    const models = await listModels();
    if (models.length === 0) return false;

    // Prefer DEFAULT_MODEL (llama3), or the first model that isn't an embedding model
    const chatModel = models.includes(DEFAULT_MODEL) 
      ? DEFAULT_MODEL 
      : (models.find(m => !m.includes('embed')) || models[0]);

    // Quick check first — if the model is already loaded, this returns fast.
    try {
      const response = await chat(
        [{ role: 'user', content: 'hi' }],
        chatModel,
        10000
      );
      return !!response;
    } catch {
      // Model needs loading from disk — allow up to 60s.
      const response = await chat(
        [{ role: 'user', content: 'hi' }],
        chatModel,
        60000
      );
      return !!response;
    }
  } catch {
    return false;
  }
}

/**
 * Check if Ollama is installed on the local system (Windows-focused).
 */
export async function isOllamaInstalled(): Promise<boolean> {
  const platform = os.platform();
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const ollamaPath = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
      if (fs.existsSync(ollamaPath)) {
        return true;
      }
    }
    // Also try checking PATH
    return new Promise((resolve) => {
      exec('where ollama', (error) => {
        resolve(!error);
      });
    });
  } else if (platform === 'darwin') {
    return fs.existsSync('/Applications/Ollama.app');
  } else {
    return new Promise((resolve) => {
      exec('which ollama', (error) => {
        resolve(!error);
      });
    });
  }
}

/**
 * Starts the Ollama daemon if installed.
 * If Ollama is already running, skips spawning to avoid a silent double-spawn failure.
 */
export async function startOllamaDaemon(): Promise<void> {
  // Skip spawn if Ollama is already healthy — avoids a silent error from double-spawn.
  const health = await checkHealth();
  if (health.available) return;

  const platform = os.platform();
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const ollamaPath = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
      if (fs.existsSync(ollamaPath)) {
        // Start detached process
        const child = spawn(ollamaPath, ['serve'], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return;
      }
    }
    // Fallback to checking PATH
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } else if (platform === 'darwin') {
    const child = spawn('open', ['-a', 'Ollama'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } else {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }
}

/**
 * Installs Ollama (Windows only for now, can be extended).
 */
export async function installOllama(): Promise<void> {
  const platform = os.platform();
  if (platform === 'win32') {
    const installerUrl = 'https://ollama.com/download/OllamaSetup.exe';
    const installerPath = path.join(os.tmpdir(), 'OllamaSetup.exe');

    // Download installer
    await new Promise<void>((resolve, reject) => {
      const https = require('https');
      const file = fs.createWriteStream(installerPath);
      https.get(installerUrl, (response: any) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err: any) => {
        fs.unlinkSync(installerPath);
        reject(err);
      });
    });

    // Run installer quietly
    return new Promise<void>((resolve, reject) => {
      // The Ollama installer might need UI interaction, but we try to run it directly
      const child = spawn(installerPath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      // Alternatively, just launch it and let the user interact
      // We'll launch it normally for the user to complete the installation
      resolve();
    });
  } else {
    throw new Error(`Auto-install not supported for platform: ${platform}. Please install manually from ollama.com.`);
  }
}
