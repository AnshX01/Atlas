import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { generateEmbedding } from "./ollama";
import * as crypto from "crypto";

export interface RAGEntry {
  id: string;
  summary: string;
  embedding: number[];
  timestamp: number;
}

let ragStore: RAGEntry[] = [];
let storePath: string = "";

export function initRAGStore() {
  if (app) {
    storePath = path.join(app.getPath("userData"), "atlas-rag-store.json");
  } else {
    storePath = path.join(process.cwd(), "atlas-rag-store.json");
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
}

function persistStore() {
  if (!storePath) return;
  try {
    fs.writeFileSync(storePath, JSON.stringify(ragStore));
  } catch (e) {
    console.error("[Atlas RAG] Failed to persist store:", e);
  }
}

export async function storeContext(summary: string) {
  try {
    const embedding = await generateEmbedding(summary);
    ragStore.push({
      id: crypto.randomUUID(),
      summary,
      embedding,
      timestamp: Date.now()
    });
    persistStore();
  } catch (e) {
    console.error("[Atlas RAG] Failed to store context:", e);
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
    return results.slice(0, topK).map(r => r.summary);
  } catch (e) {
    console.error("[Atlas RAG] Failed to search context:", e);
    return [];
  }
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
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
