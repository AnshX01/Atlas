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
  correctedQuery?: string;
}

// ── Classification System Prompt ───────────────────────────────────────────────

const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a personal productivity assistant. Your job is to classify user input into exactly one of these categories:

- "search": The user wants to FIND or RETRIEVE information. Examples: "find emails about...", "what PRs are open", "show my calendar for today", "search for files about...", "list my recent notifications"
- "action": The user wants to PERFORM an action or CHANGE something. Examples: "reply to that email saying...", "merge the PR", "send a message to...", "close issue #42", "create a new file", "post in #general"
- "chat": General conversation, questions about the system, help requests, or anything else. Examples: "how does this work?", "what can you do?", "tell me about...", "explain X"

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"intent": "search|action|chat", "confidence": 0.0-1.0, "params": {}, "correctedQuery": "..."}

The "correctedQuery" field MUST fix all spelling mistakes, grammatical errors, and expand colloquialisms (e.g. 'tmrw' -> 'tomorrow', 'u' -> 'you') from the original user input. Keep the original meaning intact.

The "params" field should extract any relevant entities:
- For search: {"query": "...", "source": "email|calendar|github|files|slack|notion"}
- For action: {"action": "...", "target": "...", "details": "..."}
- For chat: {}

Examples:
User: "Find emails from John about the quarterly report"
{"intent": "search", "confidence": 0.95, "params": {"query": "quarterly report from John", "source": "email"}, "correctedQuery": "Find emails from John about the quarterly report"}

User: "Merge PR #123 on the atlas repo"
{"intent": "action", "confidence": 0.98, "params": {"action": "merge_pr", "target": "PR #123", "details": "atlas repo"}, "correctedQuery": "Merge PR #123 on the atlas repo"}

User: "What can u help me with tmrw?"
{"intent": "chat", "confidence": 0.9, "params": {}, "correctedQuery": "What can you help me with tomorrow?"}`;

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
  "emails from",
  "emails about",
  "messages from",
  "notifications",
  "summarize",
  "summary",
  "brief",
  "overview",
  "digest",
  "today",
  "yesterday",
  "emails",
  "inbox",
  "meetings",
  "prs",
  "pull requests",
  "issues",
  "repos",
  "files",
  "documents",
  "tell me",
  "give me",
  "how many",
  "task",
  "tasks",
  "to do",
  "pending",
  "due",
];

// NOTE: Some keywords (e.g. 'email', 'message', 'post') intentionally appear in both
// ACTION_KEYWORDS here and TOOL_ROUTING in orchestrator.ts. This is safe because:
// - classifyWithKeywords tie-breaks in favor of 'action' intent (action is more specific)
// - resolveTools() in orchestrator.ts filters by READONLY_TOOLS vs DESTRUCTIVE_TOOLS
//   based on the classified intentType, so the same keyword produces search tools for
//   search intent and action tools for action intent.
const ACTION_KEYWORDS = [
  "send",
  "reply",
  "respond",
  "mail",
  "email",
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
  "notify",
  "message",
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
  // Boost if input starts with an imperative verb — strong action signal
  if (/^(send|reply|mail|email|merge|close|create|delete|post|write|forward|approve|reject|update|edit|move|add|push|schedule|book|notify|message)\b/.test(lower)) {
    actionScore += 3;
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

  // Tie — favor action (it's more specific/intentional than search)
  if (actionScore === searchScore && actionScore > 0) {
    return {
      intent: "action",
      confidence: Math.min(0.4 + actionScore * 0.15, 0.85),
      extractedParams: { action: input },
    };
  }

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
      correctedQuery: parsed.correctedQuery,
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
 * Uses Ollama for intelligent context-aware classification.
 * Falls back to keyword-based if Ollama is unavailable.
 */
export async function classifyIntent(input: string): Promise<ClassificationResult> {
  if (!input.trim()) {
    return { intent: "unknown", confidence: 0, extractedParams: {} };
  }

  // First try keyword classification — if it's very confident (high score), use it directly
  const keywordResult = classifyWithKeywords(input);
  if (keywordResult.confidence >= 0.75) {
    return keywordResult;
  }

  // For ambiguous cases, use Ollama for smarter classification
  // Use cached health status to avoid a network round-trip on every call
  try {
    const now = Date.now();
    if (ollamaAvailableCache === null || (now - lastHealthCheck) >= HEALTH_CHECK_INTERVAL_MS) {
      // Cache expired or never set — do a real health check
      const health = await checkOllamaHealth();
      ollamaAvailableCache = health.available;
      lastHealthCheck = now;
    }
    if (ollamaAvailableCache) {
      return await classifyWithOllama(input);
    }
  } catch {
    // If Ollama call itself fails, mark as unavailable for next interval
    ollamaAvailableCache = false;
    lastHealthCheck = Date.now();
  }

  // Fallback to keyword result
  return keywordResult;
}

/**
 * Force-reset the Ollama availability cache.
 * Useful after user starts/stops Ollama.
 */
export function resetClassifierCache(): void {
  ollamaAvailableCache = null;
  lastHealthCheck = 0;
}

/**
 * Resolve ambiguous pronouns in the user input using conversation history.
 */
export async function resolveEntities(input: string, history: {role: string, content: string}[]): Promise<string> {
  const ambiguousRegex = /\b(it|them|him|her|that|this|he|she)\b/i;
  if (!ambiguousRegex.test(input) || history.length === 0) {
    return input;
  }

  const recentHistory = history.slice(-5);
  const historyText = recentHistory.map(m => `${m.role}: ${m.content}`).join("\n");
  
  const systemPrompt = `You are a helpful assistant. The user just said something containing an ambiguous pronoun (it, them, him, her, that, this, etc.). 
Based on the conversation history, replace the pronoun with the concrete noun it refers to. 
Output ONLY the rewritten sentence, with no quotes, no explanation, and no extra text. Keep the original intent intact.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `History:\n${historyText}\n\nUser input: ${input}` }
  ];

  let fullResponse = "";
  try {
    for await (const token of streamChat(messages)) {
      fullResponse += token;
    }
    return fullResponse.trim() || input;
  } catch (err) {
    return input;
  }
}

/**
 * Detects if a user input contains multiple actionable requests and splits them.
 */
export async function splitMultiIntent(input: string): Promise<string[]> {
  if (!/\b(and|then|also)\b/i.test(input)) {
    return [input];
  }

  const systemPrompt = `You are a prompt splitter. If the user's input contains multiple distinct actionable requests or questions, split them into a JSON array of separate strings. If it's a single request, return an array with just that one string. Do not split compound objects (e.g. 'cats and dogs' is one search). Output ONLY a valid JSON array of strings, nothing else.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input }
  ];

  let fullResponse = "";
  try {
    for await (const token of streamChat(messages)) {
      fullResponse += token;
    }
    
    const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
        return parsed;
      }
    }
    return [input];
  } catch (err) {
    return [input];
  }
}

