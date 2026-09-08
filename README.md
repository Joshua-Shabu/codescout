# CodeScout

An agentic AI assistant that answers questions about a local codebase. Point it at a
repo, and it uses the Claude API's tool-calling loop to decide for itself which files
to list, search, and read before answering — the same "give the model tools, let it
investigate iteratively" pattern behind most real agentic coding tools.

## How it works

The backend gives Claude three tools scoped to one repo directory:

- `list_directory` — see what's in a folder
- `search_code` — grep-style search across the repo
- `read_file` — read one file's contents

On each chat message, the backend calls the Claude Messages API with those tool
definitions. Claude decides whether it has enough information to answer, or whether it
needs to call a tool first. If it calls a tool, the backend executes it against the
filesystem (with a path-traversal guard so it can never read outside the repo root) and
sends the result back to Claude. This repeats — Claude can chain multiple tool calls
across several rounds — until it produces a final text answer, which is shown to the
user along with a collapsible log of every tool call it made along the way.

The backend has **zero runtime npm dependencies**. It's built on Node's built-in `http`
module and global `fetch`, calling the Anthropic Messages API directly over HTTPS
instead of going through the `@anthropic-ai/sdk` package — so the whole tool-use
request/response contract (`tool_use` / `tool_result` content blocks, the `stop_reason`
loop) is visible in `backend/src/agent.ts` and `backend/src/claude.ts` rather than
hidden inside a library.

## Project layout

```
codescout/
  backend/    Node + TypeScript API server (no runtime deps)
  frontend/   React + TypeScript chat UI (Vite)
```

## Running it

You'll need an Anthropic API key from https://console.anthropic.com/.

**Backend:**

```bash
cd backend
npm install
cp .env.example .env   # then paste your ANTHROPIC_API_KEY into .env
npm run dev
```

This starts the API on `http://localhost:4000`.

**Frontend** (in a second terminal):

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`), paste in the absolute
path to any repo on your machine (it must be a path the *backend* process can read —
same machine, not the browser's machine), and start asking questions.

## Example questions to try

- "What does this project do, at a high level?"
- "Where is the main entry point, and what does it set up?"
- "Are there any TODO comments left in the code?"
- "Walk me through how [some feature] works."

For a deeper look at the agent loop, the tool definitions, the API contract, and the design decisions behind them, see [DOCUMENTATION.md](./DOCUMENTATION.md).

## Notes on scope

This is a portfolio/learning project, not a production tool — a few deliberate
simplifications worth knowing about (and worth being able to talk through, since they're
exactly the kind of follow-up questions this kind of project invites):

- One repo "session" at a time per backend process (no multi-user/multi-repo isolation).
- Tool results are capped (8,000 chars per file read, 40 search matches) to keep a
  single turn from blowing through the context window on a huge file or a broad grep.
- The agent loop caps itself at 8 tool-call rounds per message as a safety stop.
- Read-only by design — there's no `write_file`/`edit_file` tool, so the agent can
  explore and explain a codebase but can't change it.
