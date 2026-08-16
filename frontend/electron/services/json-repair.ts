/**
 * JSON Repair Utility
 * Extracts JSON from markdown blocks (e.g. ```json ... ```)
 * and repairs common formatting issues (like trailing commas) before parsing.
 */

export class MissingArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingArgumentError";
  }
}

const MAX_INPUT_BYTES = 512 * 1024; // 512KB

function checkDepth(str: string, maxDepth = 50): void {
  let depth = 0;
  for (const ch of str) {
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    if (depth > maxDepth) throw new Error(`JSON nesting depth exceeds ${maxDepth} — possible malicious input.`);
  }
}

export function repairAndParseJson(input: string): any {
  if (input.length > MAX_INPUT_BYTES) {
    throw new Error(`JSON input too large: ${input.length} chars (max ${MAX_INPUT_BYTES}). Possible runaway model output.`);
  }

  let cleaned = input;

  // 1. Strip surrounding markdown code blocks if present
  const markdownRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = input.match(markdownRegex);
  if (match && match[1]) {
    cleaned = match[1];
  } else {
    // Attempt to extract anything between { and } if no markdown block
    const objectRegex = /(\{[\s\S]*\})/;
    const objMatch = input.match(objectRegex);
    if (objMatch && objMatch[1]) {
      cleaned = objMatch[1];
    } else {
      // Handle truncated markdown or just truncated object
      const openMarkdownRegex = /```(?:json)?\s*([\s\S]*)/;
      const openMatch = input.match(openMarkdownRegex);
      if (openMatch && openMatch[1]) {
        cleaned = openMatch[1];
      } else {
        const openObjectRegex = /(\{[\s\S]*)/;
        const openObjMatch = input.match(openObjectRegex);
        if (openObjMatch && openObjMatch[1]) {
          cleaned = openObjMatch[1];
        }
      }
    }
  }

  // 2. Remove trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  // 3. Attempt to parse
  try {
    checkDepth(cleaned);
    return JSON.parse(cleaned);
  } catch (err) {
    // If it's our depth error, re-throw immediately
    if (err instanceof Error && err.message.includes('nesting depth exceeds')) {
      throw err;
    }
    // 4. Attempt to repair truncated JSON
    const repairAttempts = [
      cleaned + '"}',
      cleaned + '}',
      cleaned + '"]',
      cleaned + ']'
    ];
    for (const attempt of repairAttempts) {
      try {
        checkDepth(attempt);
        return JSON.parse(attempt);
      } catch (e) {
        // If depth error, re-throw
        if (e instanceof Error && e.message.includes('nesting depth exceeds')) {
          throw e;
        }
        // Continue
      }
    }
    throw new Error(`Failed to parse JSON: ${(err as Error).message}`);
  }
}
