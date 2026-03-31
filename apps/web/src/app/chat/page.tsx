"use client";

import { AppShell } from "@/components/app-shell";
import { useState, useRef, useEffect } from "react";
import { streamChat } from "@/lib/api";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

interface Citation {
  note_id: string;
  note_title: string;
  chunk_text: string;
  score: number;
}

interface ToolStep {
  tool: string;
  args?: Record<string, unknown>;
  status: "running" | "done";
}

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  toolSteps?: ToolStep[];
}

export default function ChatPage() {
  return (
    <AppShell>
      <ChatContent />
    </AppShell>
  );
}

function ChatContent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, toolSteps]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const question = input;
    setInput("");
    setStreamingContent("");
    setToolSteps([]);

    const userMsg: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const response = await streamChat(question, undefined, history);

      if (!response.ok) throw new Error("Stream request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let accumulated = "";
      let citations: Citation[] = [];
      const steps: ToolStep[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;

          try {
            const event = JSON.parse(payload);
            if (event.type === "content") {
              accumulated += event.text;
              setStreamingContent(accumulated);
            } else if (event.type === "tool_start") {
              steps.push({ tool: event.tool, args: event.args, status: "running" });
              setToolSteps([...steps]);
            } else if (event.type === "tool_complete") {
              const step = steps.find((s) => s.tool === event.tool && s.status === "running");
              if (step) step.status = "done";
              setToolSteps([...steps]);
            } else if (event.type === "citations") {
              citations = event.citations || [];
            }
          } catch {}
        }
      }

      const assistantMsg: Message = {
        role: "assistant",
        content: accumulated,
        citations,
        toolSteps: steps.length > 0 ? steps : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingContent("");
      setToolSteps([]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl flex flex-col h-[calc(100vh-3rem)]">
      <h2 className="text-2xl font-display font-bold mb-4">Chat with your notes</h2>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.length === 0 && (
          <p className="text-center mt-20" style={{ color: "var(--text-muted)" }}>
            Ask a question about your notes. The AI will search and retrieve relevant content to answer.
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i}>
            {/* Tool steps */}
            {msg.toolSteps && msg.toolSteps.length > 0 && (
              <div className="mb-2 ml-2 space-y-1">
                {msg.toolSteps.map((step, j) => (
                  <div key={j} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    <span className={step.status === "done" ? "text-green-400" : "text-yellow-400"}>
                      {step.status === "done" ? "✓" : "⟳"}
                    </span>
                    <span className="font-mono">
                      {step.tool === "search_notes" ? `Searching: "${step.args?.query}"` : `Reading note`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div
              className="p-4 rounded-xl"
              style={
                msg.role === "user"
                  ? { background: "var(--accent-soft)", color: "#c4b5fd", marginLeft: "3rem" }
                  : { background: "var(--card-bg)", border: "1px solid var(--card-border)", marginRight: "3rem" }
              }
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-invert prose-sm max-w-none" style={{ color: "var(--foreground)" }}>
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap" style={{ color: "#e0d7ff" }}>{msg.content}</p>
              )}
              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--card-border)" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>Sources:</p>
                  <div className="space-y-1">
                    {msg.citations.slice(0, 5).map((c, j) => (
                      <Link key={j} href={`/notes/${c.note_id}`} className="block text-xs hover:underline" style={{ color: "var(--accent)" }}>
                        {c.note_title} {c.score ? `(${(c.score * 100).toFixed(0)}%)` : ""}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming state */}
        {loading && (
          <div>
            {toolSteps.length > 0 && (
              <div className="mb-2 ml-2 space-y-1">
                {toolSteps.map((step, j) => (
                  <div key={j} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    <span className={step.status === "done" ? "text-green-400" : "text-yellow-400 animate-spin"}>
                      {step.status === "done" ? "✓" : "⟳"}
                    </span>
                    <span className="font-mono">
                      {step.tool === "search_notes" ? `Searching: "${step.args?.query}"` : `Reading note`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="p-4 rounded-xl mr-12" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              {streamingContent ? (
                <div className="prose prose-invert prose-sm max-w-none" style={{ color: "var(--foreground)" }}>
                  <ReactMarkdown>{streamingContent}</ReactMarkdown>
                  <span className="animate-pulse ml-1">▊</span>
                </div>
              ) : (
                <div className="animate-pulse" style={{ color: "var(--text-muted)" }}>
                  {toolSteps.length > 0 ? "Analyzing results..." : "Thinking..."}
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about your notes..."
          className="flex-1 px-4 py-3 rounded-xl focus:outline-none focus:ring-2"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid var(--card-border)",
            color: "var(--foreground)",
          }}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="px-6 py-3 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
          style={{ background: "var(--accent)" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
