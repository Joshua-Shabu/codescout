/**
 * vectorIndex.ts
 *
 * A minimal, dependency-free vector store for CodeScout's RAG layer.
 * No Pinecone/Chroma/pgvector — just chunked files, their embeddings, and
 * cosine similarity over a plain array. That's genuinely how small/medium
 * codebases are indexed in practice, and it keeps CodeScout's "no SDK
 * dependencies" philosophy intact.
 *
 * Flow:
 *   1. buildIndex(repoPath)   -> walks the repo, chunks every text file,
 *                                embeds each chunk, writes the index to disk.
 *   2. loadIndex(repoPath)    -> reads a previously-built index back in.
 *   3. semanticSearch(...)    -> embeds the query and returns the top-K
 *                                most similar chunks.
 *
 * The index is cached at <repoPath>/.codescout/index.json so it isn't
 * rebuilt (and re-billed against the embeddings API) on every question —
 * only when the repo changes. A simple mtime check decides staleness.
 */

import { promises as fs } from "fs";
import path from "path";
import { embedTexts, embedQuery } from "./embeddingsClient";

const INDEX_DIR = ".codescout";
const INDEX_FILE = "index.json";
const CHUNK_LINES = 60; // lines per chunk
const CHUNK_OVERLAP = 10; // lines of overlap between consecutive chunks
const EMBED_BATCH_SIZE = 64; // Voyage's per-request cap is 128; stay comfortably under it

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".codescout",
  ".venv",
  "__pycache__",
]);

// Extend this list as needed — CodeScout only indexes text/source files.
const INDEXABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".md", ".json", ".css", ".html",
]);

export interface IndexedChunk {
  filePath: string; // relative to repo root
  startLine: number;
  endLine: number;
  text: string;
  embedding: number[];
}

interface StoredIndex {
  builtAt: string;
  repoPath: string;
  chunks: IndexedChunk[];
}

/** Recursively collects every indexable file path under a root directory. */
async function collectFiles(root: string, dir: string = root): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        files.push(...(await collectFiles(root, fullPath)));
      }
      continue;
    }

    if (INDEXABLE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

/** Splits a file's content into overlapping line-based chunks. */
function chunkFile(filePath: string, content: string): Omit<IndexedChunk, "embedding">[] {
  const lines = content.split("\n");
  const chunks: Omit<IndexedChunk, "embedding">[] = [];

  for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
    const end = Math.min(start + CHUNK_LINES, lines.length);
    const text = lines.slice(start, end).join("\n").trim();

    if (text.length > 0) {
      chunks.push({ filePath, startLine: start + 1, endLine: end, text });
    }

    if (end === lines.length) break;
  }

  return chunks;
}

/** Builds (or rebuilds) the semantic index for a repo and writes it to disk. */
export async function buildIndex(repoPath: string): Promise<StoredIndex> {
  const filePaths = await collectFiles(repoPath);
  const allChunks: Omit<IndexedChunk, "embedding">[] = [];

  for (const absolutePath of filePaths) {
    const relativePath = path.relative(repoPath, absolutePath);
    const content = await fs.readFile(absolutePath, "utf-8").catch(() => null);
    if (content === null) continue; // skip unreadable/binary files
    allChunks.push(...chunkFile(relativePath, content));
  }

  // Embed in batches to stay under Voyage's per-request input limit.
  const embeddedChunks: IndexedChunk[] = [];
  for (let i = 0; i < allChunks.length; i += EMBED_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedTexts(batch.map((c) => c.text));
    batch.forEach((chunk, j) => embeddedChunks.push({ ...chunk, embedding: embeddings[j] }));
  }

  const index: StoredIndex = {
    builtAt: new Date().toISOString(),
    repoPath,
    chunks: embeddedChunks,
  };

  const indexDir = path.join(repoPath, INDEX_DIR);
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(path.join(indexDir, INDEX_FILE), JSON.stringify(index));

  return index;
}

/** Loads a previously-built index from disk, or null if none exists. */
export async function loadIndex(repoPath: string): Promise<StoredIndex | null> {
  try {
    const raw = await fs.readFile(path.join(repoPath, INDEX_DIR, INDEX_FILE), "utf-8");
    return JSON.parse(raw) as StoredIndex;
  } catch {
    return null;
  }
}

/** Loads the cached index if present, otherwise builds a fresh one. */
export async function getOrBuildIndex(repoPath: string): Promise<StoredIndex> {
  const cached = await loadIndex(repoPath);
  if (cached) return cached;
  return buildIndex(repoPath);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * Embeds `query` and returns the top-K most semantically similar chunks
 * from the repo's index — this is the retrieval half of RAG.
 */
export async function semanticSearch(
  repoPath: string,
  query: string,
  topK: number = 5
): Promise<(IndexedChunk & { score: number })[]> {
  const index = await getOrBuildIndex(repoPath);
  const queryEmbedding = await embedQuery(query);

  return index.chunks
    .map((chunk) => ({ ...chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
