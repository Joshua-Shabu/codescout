# CodeScout — How It Works

CodeScout is an agentic AI assistant that answers questions about a codebase by
exploring it itself, rather than having the whole codebase pasted into a prompt. You
point it at a folder on your machine, ask a question in plain English, and it decides
on its own — one step at a time — which files to look at before it answers.

This document explains the mechanics behind that: the agent loop, the tools it has,
the API contract between the frontend and backend, and the safety and scoping
decisions made along the way. The top-level `README.md` covers running it; this
covers *why it's built the way it is*.

## The core idea: tool use as an agent loop

A plain call to an LLM is one request, one response. CodeScout instead gives Claude a
small set of tools and lets it call them repeatedly, inspecting real results between
calls, until it has enough information to give a grounded answer. This is the same
"agentic" pattern used by real coding assistants: the model isn't told what's in the
repo — it has to go find out.

The loop, implemented in `backend/src/agent.ts`, looks like this:

1. Send Claude the user's question, the conversation so far, and the three tool
   definitions below.
2. Claude's response either contains a final text answer, or a request to call one
   or more tools (`stop_reason: "tool_use"`).
3. If it's a tool request, the backend actually runs that tool against the
   filesystem, and sends the result back to Claude as a `tool_result` message.
4. Go back to step 2. Claude can chain several rounds of this — list a directory,
   then read a file it saw, then search for something else — before answering.
5. Stop when Claude gives a final answer, or after 8 rounds (a safety cap so a
   confused agent can't loop forever and run up API costs).

Every tool call and its result is logged and returned to the frontend alongside the
final answer, so you can see exactly what the agent looked at — this is what shows up
as the collapsible "N tool call(s)" section under each response in the UI.

## The three tools

Defined in `backend/src/tools.ts`, using the same JSON Schema format the Claude API
expects for tool definitions:

- **`list_directory(path)`** — lists files and subdirectories at a path relative to
  the repo root. This is usually the agent's first move, to orient itself.
- **`read_file(path)`** — reads one file's contents, truncated past 8,000 characters
  so a single huge file can't consume the whole context window.
- **`search_code(query, file_extension?)`** — a grep-style search across the repo,
  returning matching file paths, line numbers, and the matching line. This is how the
  agent finds things without reading every file.

All three are read-only by design. There is deliberately no `write_file` or
`edit_file` tool — CodeScout can explore and explain a codebase, but it can't change
it. That keeps the safety surface small and keeps the project's scope honest: it's a
codebase Q&A agent, not an autonomous coding agent that commits changes.

Common ignored directories (`node_modules`, `.git`, `dist`, `build`, `.next`, `venv`,
`__pycache__`, etc.) are filtered out of listings and searches, so the agent's limited
tool-call budget goes toward actual source code, not dependency trees.

## Path safety

Because the model itself is choosing what paths to pass to these tools, every path is
resolved and checked against the repo root before anything touches the filesystem
(`resolveSafe` in `tools.ts`). A request like `read_file("../../etc/passwd")` is
rejected before it ever reaches `fs.readFileSync`. This was tested directly: passing
`../` and `../../../etc/passwd` both return a clean "resolves outside the repository
root" error rather than leaking anything outside the loaded repo.

## The API contract

The backend is a small HTTP API (no framework — see "Why no dependencies" below):

| Endpoint | Method | Body | Purpose |
|---|---|---|---|
| `/api/init` | POST | `{ repoPath }` | Scopes the agent to one absolute path on disk; validates it exists and is a directory. |
| `/api/status` | GET | — | Returns the currently loaded `repoRoot`, or `null`. |
| `/api/chat` | POST | `{ message, history }` | Runs one turn of the agent loop and returns `{ reply, toolLog, messages }`. |

`history` and the returned `messages` are the full Claude-format message array
(including the `tool_use`/`tool_result` content blocks from prior turns) — the
frontend just stores whatever the backend hands back and passes it in on the next
message, so the backend stays stateless between requests and multi-turn conversation
history lives entirely in the browser tab.

## Why the backend has zero runtime dependencies

`backend/src/claude.ts` calls the Anthropic Messages API (`POST
https://api.anthropic.com/v1/messages`) directly with Node's built-in `fetch`, using
the `x-api-key` / `anthropic-version` headers the raw API expects — instead of going
through the `@anthropic-ai/sdk` package. The HTTP server itself
(`backend/src/index.ts`) is built on Node's built-in `http` module rather than
Express, with routing, JSON body parsing, and CORS headers handled by hand in about
80 lines.

This was a deliberate choice, not a workaround: it means the entire request/response
contract for tool use — the `tools` array, `tool_use` content blocks, `stop_reason`,
feeding `tool_result` blocks back in — is visible and readable in this repo, rather
than hidden behind a library's abstractions. It also means running the backend never
depends on installing a framework: `node --env-file=.env dist/index.js` is the whole
runtime.

## Frontend

A small React + TypeScript app (Vite): a form to load a repo path, a chat window, and
an input box. Each assistant turn renders its tool-call log in a `<details>` element
so it's visible but not in the way. There's no backend framework or state management
library here either — just `useState`/`useEffect` and two `fetch`-based functions in
`frontend/src/api.ts`.

## Known limitations (by design, not oversight)

- One loaded repo at a time per running backend process — there's no multi-user or
  multi-repo session isolation.
- Tool results are capped (8,000 characters per file, 40 search matches) to protect
  the context window, which means a very large file or an extremely broad search
  will come back truncated.
- The 8-round tool-call cap means an unusually complex question could hit the limit
  before the agent converges on an answer — the UI surfaces this plainly rather than
  returning a partial or fabricated answer.
- No authentication on the API — it's meant to run locally against your own
  machine's filesystem, not to be deployed as a public multi-tenant service.
