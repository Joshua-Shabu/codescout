import type { ClaudeMessage, ToolCallLogEntry } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

export async function initRepo(repoPath: string): Promise<{ ok: boolean; repoRoot: string }> {
  const res = await fetch(`${API_BASE}/api/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repoPath }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to load repository");
  return body;
}

export async function sendChatMessage(
  message: string,
  history: ClaudeMessage[]
): Promise<{ reply: string; toolLog: ToolCallLogEntry[]; messages: ClaudeMessage[] }> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Chat request failed");
  return body;
}
