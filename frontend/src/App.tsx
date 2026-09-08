import { useState, useRef, useEffect, FormEvent } from "react";
import { initRepo, sendChatMessage } from "./api";
import type { ChatTurn, ClaudeMessage } from "./types";
import "./App.css";

export default function App() {
  const [repoPath, setRepoPath] = useState("");
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingRepo, setLoadingRepo] = useState(false);

  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [history, setHistory] = useState<ClaudeMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function handleLoadRepo(e: FormEvent) {
    e.preventDefault();
    if (!repoPath.trim()) return;
    setLoadingRepo(true);
    setLoadError(null);
    try {
      const result = await initRepo(repoPath.trim());
      setRepoRoot(result.repoRoot);
      setTurns([]);
      setHistory([]);
    } catch (err: any) {
      setLoadError(err.message);
    } finally {
      setLoadingRepo(false);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending || !repoRoot) return;

    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: "user", text: message };
    setTurns((prev) => [...prev, userTurn]);
    setInput("");
    setSending(true);
    setChatError(null);

    try {
      const result = await sendChatMessage(message, history);
      setHistory(result.messages);
      setTurns((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result.reply,
          toolLog: result.toolLog,
        },
      ]);
    } catch (err: any) {
      setChatError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>CodeScout</h1>
        <p className="subtitle">An agentic AI assistant that explores a codebase to answer questions about it.</p>
      </header>

      <form className="repo-form" onSubmit={handleLoadRepo}>
        <input
          type="text"
          placeholder="Absolute path to a repo on the machine running the backend, e.g. /Users/you/projects/swapper"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          disabled={loadingRepo}
        />
        <button type="submit" disabled={loadingRepo || !repoPath.trim()}>
          {loadingRepo ? "Loading..." : "Load repo"}
        </button>
      </form>
      {loadError && <p className="error">{loadError}</p>}
      {repoRoot && <p className="repo-status">Scoped to: {repoRoot}</p>}

      <div className="chat-window" ref={scrollRef}>
        {turns.length === 0 && repoRoot && (
          <p className="hint">Ask something like "what does this project do?" or "where is the API defined?"</p>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className={`turn turn-${turn.role}`}>
            <div className="turn-label">{turn.role === "user" ? "You" : "CodeScout"}</div>
            {turn.toolLog && turn.toolLog.length > 0 && (
              <details className="tool-log">
                <summary>{turn.toolLog.length} tool call(s)</summary>
                {turn.toolLog.map((call, i) => (
                  <div key={i} className="tool-call">
                    <code>{call.name}({JSON.stringify(call.input)})</code>
                    <pre>{call.result}</pre>
                  </div>
                ))}
              </details>
            )}
            <div className="turn-text">{turn.text}</div>
          </div>
        ))}
      </div>

      {chatError && <p className="error">{chatError}</p>}

      <form className="chat-form" onSubmit={handleSend}>
        <input
          type="text"
          placeholder={repoRoot ? "Ask about this codebase..." : "Load a repo above first"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!repoRoot || sending}
        />
        <button type="submit" disabled={!repoRoot || sending || !input.trim()}>
          {sending ? "Thinking..." : "Send"}
        </button>
      </form>
    </div>
  );
}
