import { TOOL_DEFINITIONS, executeTool } from "./tools";
import { callClaude, type ClaudeMessage, type ContentBlock } from "./claude";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";
const MAX_TOOL_ROUNDS = 8; // hard stop so a confused agent can't loop forever

export interface ToolCallLogEntry {
  name: string;
  input: unknown;
  result: string;
}

export interface AgentResult {
  reply: string;
  toolLog: ToolCallLogEntry[];
  messages: ClaudeMessage[];
}

/**
 * Runs one turn of the "read a codebase and answer questions about it" agent.
 * This is the core agent loop: give Claude tools, let it decide which ones to
 * call and in what order, execute them locally against the filesystem, and
 * feed results back until it produces a final text answer (or we hit the
 * round cap, in case it never converges).
 */
export async function runAgent(
  userMessage: string,
  history: ClaudeMessage[],
  repoRoot: string
): Promise<AgentResult> {
  const messages: ClaudeMessage[] = [...history, { role: "user", content: userMessage }];

  const system = [
    "You are CodeScout, an AI assistant that answers questions about a codebase",
    `rooted at "${repoRoot}" using the tools you've been given.`,
    "Always investigate with list_directory / search_code / read_file before answering —",
    "never guess at file contents. Cite the specific file paths (and line numbers when",
    "relevant) that support your answer. If you can't find something after a reasonable",
    "search, say so plainly instead of speculating.",
  ].join(" ");

  const toolLog: ToolCallLogEntry[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callClaude({
      model: MODEL,
      system,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      return { reply: textBlock?.text ?? "", toolLog, messages };
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const toolResults: ContentBlock[] = [];
    for (const block of toolUseBlocks) {
      const result = executeTool(block.name!, block.input, repoRoot);
      toolLog.push({ name: block.name!, input: block.input, result });
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply: "I hit my tool-call limit for this turn without reaching a final answer — try narrowing the question.",
    toolLog,
    messages,
  };
}
