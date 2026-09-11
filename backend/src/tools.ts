import fs from "fs";
import path from "path";
import { semanticSearch } from "./vectorIndex";

// Directories we never want to walk into when listing/searching — keeps
// the agent from burning its whole context on dependency trees.
const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "venv",
  "__pycache__", ".venv", "coverage", ".turbo",
]);

const MAX_FILE_CHARS = 8000; // per-file read cap, so one huge file can't blow the context
const MAX_SEARCH_MATCHES = 40;

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/**
 * Resolves a repo-relative path and guarantees the result stays inside
 * repoRoot. Throws on any attempt to escape it (e.g. "../../etc/passwd") —
 * this is the one thing that has to be airtight, since the model is the one
 * choosing these paths.
 */
function resolveSafe(repoRoot: string, relativePath: string): string {
  const target = path.resolve(repoRoot, relativePath || ".");
  const rootWithSep = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
  if (target !== repoRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`Path "${relativePath}" resolves outside the repository root and is not allowed.`);
  }
  return target;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_directory",
    description:
      "List files and subdirectories at a given path inside the repository. " +
      "Use this first to orient yourself before reading files.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'Directory path relative to the repo root, e.g. "src" or "." for the root.',
        },
      },
      required: ["path"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a single text file in the repository. " +
      "Large files are truncated — prefer search_code first to find the relevant region.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'File path relative to the repo root, e.g. "src/index.ts".',
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_code",
    description:
      "Search the repository for a text/regex pattern across files (like grep -rn). " +
      "Returns matching file paths, line numbers, and the matching line.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regular expression to search for." },
        file_extension: {
          type: "string",
          description: 'Optional filter, e.g. "ts" or "py", to restrict which files are searched.',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "semantic_search",
    description:
      "Search the codebase by meaning rather than exact text. Use this when the " +
      "user's question is conceptual (e.g. 'where do we handle retries?', 'how is " +
      "the user session validated?') and a literal grep in search_code wouldn't " +
      "reliably find the relevant code. Returns the most relevant file chunks with " +
      "their file path and line range.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A natural-language description of what to find." },
        top_k: { type: "number", description: "How many chunks to return (default 5)." },
      },
      required: ["query"],
    },
  },
];

function listDirectory(repoRoot: string, input: { path: string }): string {
  const dir = resolveSafe(repoRoot, input.path);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const lines = entries
    .filter((e) => !IGNORED_DIRS.has(e.name) && !e.name.startsWith("."))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
  return lines.length ? lines.join("\n") : "(empty directory)";
}

function readFile(repoRoot: string, input: { path: string }): string {
  const file = resolveSafe(repoRoot, input.path);
  const stat = fs.statSync(file);
  if (stat.isDirectory()) {
    throw new Error(`"${input.path}" is a directory, not a file. Use list_directory instead.`);
  }
  let content = fs.readFileSync(file, "utf-8");
  if (content.length > MAX_FILE_CHARS) {
    content = content.slice(0, MAX_FILE_CHARS) + `\n\n...[truncated, file continues beyond ${MAX_FILE_CHARS} chars]`;
  }
  return content;
}

function walkFiles(dir: string, extFilter: string | undefined, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, extFilter, out);
    } else if (!extFilter || full.endsWith(`.${extFilter}`)) {
      out.push(full);
    }
  }
}

function searchCode(repoRoot: string, input: { query: string; file_extension?: string }): string {
  const files: string[] = [];
  walkFiles(repoRoot, input.file_extension, files);

  let pattern: RegExp;
  try {
    pattern = new RegExp(input.query, "i");
  } catch {
    pattern = new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  const matches: string[] = [];
  for (const file of files) {
    if (matches.length >= MAX_SEARCH_MATCHES) break;
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue; // binary or unreadable file
    }
    const relPath = path.relative(repoRoot, file);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length && matches.length < MAX_SEARCH_MATCHES; i++) {
      if (pattern.test(lines[i])) {
        matches.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  return matches.length ? matches.join("\n") : "(no matches found)";
}

async function semanticSearchTool(
  repoRoot: string,
  input: { query: string; top_k?: number }
): Promise<string> {
  const hits = await semanticSearch(repoRoot, input.query, input.top_k ?? 5);
  if (!hits.length) return "(no matches found)";
  return hits
    .map((h) => `${h.filePath}:${h.startLine}-${h.endLine} (score ${h.score.toFixed(3)})\n${h.text}`)
    .join("\n\n---\n\n");
}

export async function executeTool(name: string, input: any, repoRoot: string): Promise<string> {
  try {
    switch (name) {
      case "list_directory":
        return listDirectory(repoRoot, input);
      case "read_file":
        return readFile(repoRoot, input);
      case "search_code":
        return searchCode(repoRoot, input);
      case "semantic_search":
        return await semanticSearchTool(repoRoot, input);
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Error running ${name}: ${err.message}`;
  }
}
