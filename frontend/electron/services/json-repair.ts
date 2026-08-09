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

export function repairAndParseJson(input: string): any {
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
    return JSON.parse(cleaned);
  } catch (err) {
    // 4. Attempt to repair truncated JSON
    const repairAttempts = [
      cleaned + '"}',
      cleaned + '}',
      cleaned + '"]',
      cleaned + ']'
    ];
    for (const attempt of repairAttempts) {
      try {
        return JSON.parse(attempt);
      } catch (e) {
        // Continue
      }
    }
    throw new Error(`Failed to parse JSON: ${(err as Error).message}`);
  }
}
