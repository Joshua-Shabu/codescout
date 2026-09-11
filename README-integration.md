# Adding semantic search (RAG) to CodeScout

This adds a fourth tool — `semantic_search` — alongside the existing
`list_directory`, `search_code`, and `read_file` tools. It lets CodeScout
answer questions like "where do we validate the auth token?" by meaning,
not just by grepping for literal strings.

## 1. Files to drop in

Copy both files into your backend source tree, next to your other tool
implementations (wherever `search_code`'s implementation currently lives —
likely something like `backend/src/tools/`):

- `embeddingsClient.ts`
- `vectorIndex.ts`

They only depend on each other and on Node's built-in `fs`/`path`/`fetch` —
no new npm packages required.

## 2. Environment variable

Add to `backend/.env` (same file that already holds `ANTHROPIC_API_KEY`):

```
VOYAGE_API_KEY=your_key_here
```

Get a free key at https://dash.voyageai.com/ — Voyage's free tier is
generous enough for indexing personal-scale repos and querying them
during a coding session.

## 3. Register the tool definition

Wherever your existing tool schemas are declared (the array/object you pass
as `tools` to the Anthropic Messages API — probably near where
`list_directory`, `search_code`, and `read_file` are defined), add:

```ts
{
  name: "semantic_search",
  description:
    "Search the codebase by meaning rather than exact text. Use this when " +
    "the user's question is conceptual (e.g. 'where do we handle retries?', " +
    "'how is the user session validated?') and a literal grep in search_code " +
    "wouldn't reliably find the relevant code. Returns the most relevant " +
    "file chunks with their file path and line range.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A natural-language description of what to find.",
      },
      top_k: {
        type: "number",
        description: "How many chunks to return (default 5).",
      },
    },
    required: ["query"],
  },
}
```

## 4. Wire it into the dispatch loop

Wherever your tool-calling loop currently does something like:

```ts
if (toolUse.name === "search_code") {
  result = await searchCode(toolUse.input.pattern);
} else if (toolUse.name === "read_file") {
  result = await readFile(toolUse.input.path);
}
```

add a branch:

```ts
import { semanticSearch } from "./vectorIndex"; // adjust path to wherever you placed it

else if (toolUse.name === "semantic_search") {
  const hits = await semanticSearch(
    repoPath,                         // whatever variable already holds the repo root in this file
    toolUse.input.query,
    toolUse.input.top_k ?? 5
  );

  result = hits
    .map(
      (h) =>
        `${h.filePath}:${h.startLine}-${h.endLine} (score ${h.score.toFixed(3)})\n${h.text}`
    )
    .join("\n\n---\n\n");
}
```

`repoPath` should be whatever variable your other tools (`list_directory`,
`read_file`) already use as the indexed repo's root — reuse it rather than
hardcoding a path.

## 5. First run behavior

The first call to `semantic_search` for a repo will be slow (it has to
chunk every file and embed all of them via Voyage). After that,
`getOrBuildIndex` finds the cached `.codescout/index.json` and reuses it
instantly. There's no auto-invalidation on file changes yet — this is a
deliberate v1 simplification, not an oversight. To pick up new/edited
files, delete the cache and let it rebuild:

```
rm -rf .codescout/
```

A natural v2 improvement (not built here, to keep this addition scoped and
reviewable) would be hashing each file's content and only re-embedding
chunks whose file changed, instead of an all-or-nothing rebuild.

## 6. Add `.codescout/` to `.gitignore`

The index file contains embeddings for your whole codebase — it's
regenerable and shouldn't be committed:

```
echo ".codescout/" >> .gitignore
```

## 7. Testing it locally

Once wired in, ask CodeScout something conceptual that wouldn't match a
literal grep, e.g. "where do we handle rate limiting?" and confirm the
model actually calls `semantic_search` and gets back relevant chunks. If it
doesn't call the tool, double check the tool description above is present
in whatever list gets sent to the API — Claude only reaches for a tool it
can see.
