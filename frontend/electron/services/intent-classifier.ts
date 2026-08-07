/**
 * Atlas Intent Classifier
 *
 * Classifies user input into actionable intents using Ollama (with keyword fallback).
 *
 * Intents:
 * - 'search': user is looking for information ("find emails about...", "what PRs...")
 * - 'action': user wants to DO something ("reply to...", "merge...", "send...")
 * - 'chat': general conversation, questions, or discussion
 * - 'unknown': could not determine intent
 */

import { checkOllamaHealth, streamChat } from "./ollama";

// ── Types ──────────────────────────────────────────────────────────────────────

export type Intent = "search" | "action" | "chat" | "unknown";

export interface ClassificationResult {
  intent: Intent;
  confidence: number;
  extractedParams: Record<string, unknown>;
}

// ── Classification System Prompt ───────────────────────────────────────────────

const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a personal productivity assistant. Your job is to classify user input into exactly one of these categories:

- "search": The user wants to FIND or RETRIEVE information. Examples: "find emails about...", "what PRs are open", "show my calendar for today", "search for files about...", "list my recent notifications"
- "action": The user wants to PERFORM an action or CHANGE something. Examples: "reply to that email saying...", "merge the PR", "send a message to...", "close issue #42", "create a new file", "post in #general"
- "chat": General conversation, questions about the system, help requests, or anything else. Examples: "how does this work?", "what can you do?", "tell me about...", "explain X"

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"intent": "search|action|chat", "confidence": 0.0-1.0, "params": {}}

The "params" field should extract any relevant entities:
- For search: {"query": "...", "source": "email|calendar|github|files|slack|notion"}
- For action: {"action": "...", "target": "...", "details": "..."}
- For chat: {}

Examples:
User: "Find emails from John about the quarterly report"
{"intent": "search", "confidence": 0.95, "params": {"query": "quarterly report from John", "source": "email"}}

User: "Merge PR #123 on the atlas repo"
{"intent": "action", "confidence": 0.98, "params": {"action": "merge_pr", "target": "PR #123", "details": "atlas repo"}}

User: "What can you help me with?"
{"intent": "chat", "confidence": 0.9, "params": {}}`;

// ── Keyword-based Fallback Classifier ──────────────────────────────────────────

const SEARCH_KEYWORDS = [
  "find",
  "search",
  "look up",
  "lookup",
  "show me",
  "show my",
  "what",
  "which",
  "list",
  "get",
  "fetch",
  "retrieve",
  "check",
  "any",
  "are there",
  "is there",
  "open prs",
  "open issues",
  "recent",
  "latest",
  "unread",
  "upcoming",
  "calendar",
  "schedule",
  "emails from",
  "emails about",
  "messages from",
  "notifications",
];

const ACTION_KEYWORDS = [
  "send",
  "reply",
  "respond",
  "merge",
  "close",
  "open",
  "create",
  "delete",
  "remove",
  "update",
  "edit",
  "post",
  "write",
  "forward",
  "approve",
  "reject",
  "assign",
  "move",
  "archive",
  "mark as",
  "set",
  "change",
  "rename",
  "add",
  "push",
  "deploy",
  "schedule",
  "book",
  "cancel",
];

/**
 * Simple keyword-based intent classification.
 * Used as fallback when Ollama is not available.
 */
function classifyWithKeywords(input: string): ClassificationResult {
  const lower = input.toLowerCase().trim();

  // Score search intent
  let searchScore = 0;
  for (const keyword of SEARCH_KEYWORDS) {
    if (lower.includes(keyword)) {
      searchScore += 1;
    }
  }
  // Boost if input starts with a question word
  if (/^(what|which|who|where|when|how many|are there|is there|show|find|list|get)\b/.test(lower)) {
    searchScore += 2;
  }

  // Score action intent
  let actionScore = 0;
  for (const keyword of ACTION_KEYWORDS) {
    if (lower.includes(keyword)) {
      actionScore += 1;
    }
  }
  // Boost if input starts with an imperative verb
  if (/^(send|reply|merge|close|create|delete|post|write|forward|approve|reject|update|edit|move|add|push)\b/.test(lower)) {
    actionScore += 2;
  }

  // Determine winner
  const maxScore = Math.max(searchScore, actionScore);

  if (maxScore === 0) {
    return { intent: "chat", confidence: 0.5, extractedParams: {} };
  }

  if (searchScore > actionScore) {
    return {
      intent: "search",
      confidence: Math.min(0.4 + searchScore * 0.15, 0.85),
      extractedParams: { query: input },
    };
  }

  if (actionScore > searchScore) {
    return {
      intent: "action",
      confidence: Math.min(0.4 + actionScore * 0.15, 0.85),
      extractedParams: { action: input },
    };
  }

  // Tie — default to chat
  return { intent: "chat", confidence: 0.4, extractedParams: {} };
}

// ── Ollama-based Classifier ────────────────────────────────────────────────────

/**
 * Classify user input using Ollama for high-accuracy intent detection.
 * Collects streaming response tokens and parses the JSON result.
 */
async function classifyWithOllama(input: string): Promise<ClassificationResult> {
  const messages = [
    { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
    { role: "user", content: input },
  ];

  let fullResponse = "";

  try {
    for await (const token of streamChat(messages)) {
      fullResponse += token;
    }

    // Parse the JSON response
    const trimmed = fullResponse.trim();

    // Try to extract JSON from the response (handle potential markdown wrapping)
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[Intent Classifier] Could not parse Ollama response as JSON:", trimmed);
      return classifyWithKeywords(input);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const intent = parsed.intent as Intent;
    if (!["search", "action", "chat"].includes(intent)) {
      return classifyWithKeywords(input);
    }

    return {
      intent,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      extractedParams: parsed.params || {},
    };
  } catch (error) {
    console.warn("[Intent Classifier] Ollama classification failed, using keyword fallback:", error);
    return classifyWithKeywords(input);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

// Cache Ollama availability to avoid checking every single time
let ollamaAvailableCache: boolean | null = null;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 30_000; // Re-check every 30 seconds

/**
 * Classify user input into an intent.
 *
 * Uses Ollama when available for high-accuracy classification.
 * Falls back to keyword-based classification when Ollama is unavailable.
 */
export async function classifyIntent(input: string): Promise<ClassificationResult> {
  if (!input.trim()) {
    return { intent: "unknown", confidence: 0, extractedParams: {} };
  }

  // Check Ollama availability (with caching)
  const now = Date.now();
  if (ollamaAvailableCache === null || now - lastHealthCheck > HEALTH_CHECK_INTERVAL_MS) {
    ollamaAvailableCache = await checkOllamaHealth();
    lastHealthCheck = now;
  }

  if (ollamaAvailableCache) {
    return classifyWithOllama(input);
  }

  // Fallback to keyword-based classification
  return classifyWithKeywords(input);
}

/**
 * Force-reset the Ollama availability cache.
 * Useful after user starts/stops Ollama.
 */
export function resetClassifierCache(): void {
  ollamaAvailableCache = null;
  lastHealthCheck = 0;
}
