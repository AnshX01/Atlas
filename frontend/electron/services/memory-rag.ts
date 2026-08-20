import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { generateEmbedding } from "./ollama";
import * as crypto from "crypto";
import { chat } from "./ollama";
import { repairAndParseJson } from "./json-repair";

export interface RAGEntry {
  id: string;
  summary: string;
  embedding: number[];
  timestamp: number;
}

let ragStore: RAGEntry[] = [];
let storePath: string = "";

export interface SemanticCacheEntry {
  queryEmbedding: number[];
  response: string;
  timestamp: number;
}
let semanticCacheStore: SemanticCacheEntry[] = [];
let cacheStorePath: string = "";


export function initRAGStore() {
  if (app) {
    storePath = path.join(app.getPath("userData"), "atlas-rag-store.json");
    cacheStorePath = path.join(app.getPath("userData"), "atlas-semantic-cache.json");
  } else {
    storePath = path.join(process.cwd(), "atlas-rag-store.json");
    cacheStorePath = path.join(process.cwd(), "atlas-semantic-cache.json");
  }
  
  if (fs.existsSync(storePath)) {
    try {
      const data = fs.readFileSync(storePath, "utf-8");
      ragStore = JSON.parse(data);
    } catch (e) {
      console.error("[Atlas RAG] Failed to load store:", e);
      ragStore = [];
    }
  } else {
    ragStore = [];
  }

  if (fs.existsSync(cacheStorePath)) {
    try {
      const data = fs.readFileSync(cacheStorePath, "utf-8");
      semanticCacheStore = JSON.parse(data);
    } catch (e) {
      console.error("[Atlas RAG] Failed to load semantic cache:", e);
      semanticCacheStore = [];
    }
  } else {
    semanticCacheStore = [];
  }
}

function persistStore() {
  if (!storePath) return;
  try {
    const tmpPath = `${storePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(ragStore));
    fs.renameSync(tmpPath, storePath);
  } catch (e) {
    console.error("[Atlas RAG] Failed to persist store:", e);
  }
}


function persistSemanticCache() {
  if (!cacheStorePath) return;
  try {
    const tmpPath = `${cacheStorePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(semanticCacheStore));
    fs.renameSync(tmpPath, cacheStorePath);
  } catch (e) {
    console.error("[Atlas RAG] Failed to persist semantic cache:", e);
  }
}

const MAX_RAG_STORE_SIZE = 1000;
const RAG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function storeContext(summary: string) {
  try {
    const embedding = await generateEmbedding(summary);
    const now = Date.now();
    
    ragStore.push({
      id: crypto.randomUUID(),
      summary,
      embedding,
      timestamp: now
    });
    
    // Prune old entries (TTL) and enforce max cap
    ragStore = ragStore.filter(entry => (now - entry.timestamp) < RAG_TTL_MS);
    if (ragStore.length > MAX_RAG_STORE_SIZE) {
      // Keep the most recent MAX_RAG_STORE_SIZE entries
      ragStore = ragStore.slice(-MAX_RAG_STORE_SIZE);
    }
    
    persistStore();
  } catch (e) {
    console.error("[Atlas RAG] Failed to store context:", e);
  }
}


export async function checkSemanticCache(query: string, threshold: number = 0.95): Promise<string | null> {
  if (semanticCacheStore.length === 0) return null;
  try {
    const queryEmbedding = await generateEmbedding(query);
    let bestMatch: string | null = null;
    let highestSimilarity = -1;
    for (const entry of semanticCacheStore) {
      const similarity = cosineSimilarity(queryEmbedding, entry.queryEmbedding);
      if (similarity > highestSimilarity && similarity >= threshold) {
        highestSimilarity = similarity;
        bestMatch = entry.response;
      }
    }
    return bestMatch;
  } catch (e) {
    return null;
  }
}

export async function storeInSemanticCache(query: string, response: string) {
  try {
    const queryEmbedding = await generateEmbedding(query);
    semanticCacheStore.push({
      queryEmbedding,
      response,
      timestamp: Date.now()
    });
    if (semanticCacheStore.length > 500) {
      semanticCacheStore.shift();
    }
    persistSemanticCache();
  } catch (e) {
    console.error("[Atlas RAG] Failed to store in semantic cache:", e);
  }
}

export async function crossEncoderRerank(query: string, documents: string[], topK: number = 3): Promise<string[]> {
  if (documents.length === 0) return [];
  if (documents.length <= 1) return documents;
  
  const prompt = `Rate the relevance of each document to the query on a scale of 0 to 10.
Query: "${query}"
Documents:
${documents.map((d, i) => `[${i}] ${d}`).join('\n')}

Output ONLY a JSON array of numbers corresponding to the scores, e.g. [8, 2, 5]. Nothing else.`;
  
  try {
    // Adding 120s timeout to prevent hanging if model fails
    const response = await chat([{ role: 'user', content: prompt }], undefined, 120000);
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in response");
    
    let scores = repairAndParseJson(match[0]);
    if (!Array.isArray(scores) || scores.length !== documents.length) {
      throw new Error("Invalid scoring output");
    }
    
    const scoredDocs = documents.map((doc, idx) => ({ doc, score: scores[idx] }));
    scoredDocs.sort((a, b) => b.score - a.score);
    return scoredDocs.slice(0, topK).map(d => d.doc);
  } catch (e) {
    console.warn("[Atlas RAG] Cross-encoder reranking failed, falling back to original order:", e);
    return documents.slice(0, topK);
  }
}

export async function searchContext(query: string, topK: number = 3): Promise<string[]> {
  if (ragStore.length === 0) return [];
  
  try {
    const queryEmbedding = await generateEmbedding(query);
    
    // Calculate cosine similarity
    const results = ragStore.map(entry => {
      return {
        summary: entry.summary,
        similarity: cosineSimilarity(queryEmbedding, entry.embedding)
      };
    });
    
    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);
    
    // Return top K summaries
    const topCandidates = results.slice(0, topK * 2).map(r => r.summary);
    return await crossEncoderRerank(query, topCandidates, topK);
  } catch (e) {
    console.error("[Atlas RAG] Failed to search context:", e);
    return [];
  }
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0; // dimension mismatch guard
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
