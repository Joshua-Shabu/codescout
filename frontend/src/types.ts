export interface ToolCallLogEntry {
  name: string;
  input: unknown;
  result: string;
}

export interface ChatContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  [key: string]: unknown;
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ChatContentBlock[];
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolLog?: ToolCallLogEntry[];
}
