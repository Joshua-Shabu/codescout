// Thin, dependency-free client for the Anthropic Messages API.
// Written against the raw HTTP contract (no @anthropic-ai/sdk) — the whole
// backend runs on Node's built-in `http` and `fetch`, nothing else.

import type { ToolDefinition } from "./tools";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string;
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ClaudeResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | string;
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export async function callClaude(params: {
  model: string;
  system: string;
  messages: ClaudeMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
}): Promise<ClaudeResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in the environment.");
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens ?? 2048,
      system: params.system,
      tools: params.tools,
      messages: params.messages,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status} ${res.statusText}: ${errBody}`);
  }

  return (await res.json()) as ClaudeResponse;
}
