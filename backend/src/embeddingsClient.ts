/**
 * embeddingsClient.ts
 *
 * Thin fetch-based wrapper around Voyage AI's embeddings endpoint — the
 * embeddings provider Anthropic recommends alongside Claude (Claude itself
 * has no embeddings endpoint). This matches CodeScout's existing style:
 * Node's built-in fetch, no SDK dependency.
 *
 * Requires a free Voyage AI API key: https://dash.voyageai.com/
 * Add VOYAGE_API_KEY=... to backend/.env (same pattern as ANTHROPIC_API_KEY).
 */

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const EMBEDDING_MODEL = "voyage-code-3"; // Voyage's model tuned for source code

interface VoyageEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

/**
 * Embeds a batch of text chunks in a single request.
 * Voyage accepts up to 128 inputs per call — chunk your input list
 * upstream if you're indexing a very large repository.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY is not set. Get a free key at https://dash.voyageai.com/ and add it to backend/.env"
    );
  }

  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
      input_type: "document",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage embeddings request failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as VoyageEmbeddingResponse;
  // Voyage returns results possibly out of order; sort by index to be safe.
  return json.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/** Convenience wrapper for embedding a single query string at search time. */
export async function embedQuery(query: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY is not set. Get a free key at https://dash.voyageai.com/ and add it to backend/.env"
    );
  }

  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [query],
      model: EMBEDDING_MODEL,
      input_type: "query",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage embeddings request failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as VoyageEmbeddingResponse;
  return json.data[0].embedding;
}
