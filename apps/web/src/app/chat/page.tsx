"use client";

import { useState, useRef, useEffect } from "react";
import { streamChat, listSections } from "@/lib/api";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";

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

interface Section {
  id: string;
  name: string;
  slug: string;
  children: Section[];
}

export default function ChatPage() {
  return <ChatContent />;
}

function ChatContent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionFilter, setSectionFilter] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  useEffect(() => {
    listSections().then(setSections).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, toolSteps]);

  const flatSections = (secs: Section[], depth = 0): { slug: string; name: string; depth: number }[] => {
    const result: { slug: string; name: string; depth: number }[] = [];
    for (const s of secs) {
      result.push({ slug: s.slug, name: s.name, depth });
      if (s.children) result.push(...flatSections(s.children, depth + 1));
    }
    return result;
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toastSuccess("Copied to clipboard"));
  };

  const handleClear = async () => {
    if (messages.length === 0) return;
    const ok = await confirm({
      title: "Clear conversation",
      message: "This will clear all messages in the current conversation.",
      confirmLabel: "Clear",
      variant: "warning",
    });
    if (ok) {
      setMessages([]);
      toastSuccess("Conversation cleared");
    }
  };

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
      const response = await streamChat(question, sectionFilter || undefined, history);

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
      toastError("Chat failed. Check your LLM settings.");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong. Please check your LLM settings." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl flex flex-col h-[calc(100vh-3rem)]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-display font-bold">Chat with your notes</h2>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.04)" }}
          >
            Clear chat
          </button>
        )}
      </div>

      {/* Section scope filter */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Scope:</span>
        <select
          value={sectionFilter}
          onChange={(e) => setSectionFilter(e.target.value)}
          className="px-3 py-1 rounded-lg text-xs"
          style={{
            background: '#1a1735',
            color: '#e8e6f0',
            border: '1px solid var(--card-border)',
          }}
        >
          <option value="" style={{ background: '#1a1735', color: '#e8e6f0' }}>All notes</option>
          {flatSections(sections).map((s) => (
            <option key={s.slug} value={s.slug} style={{ background: '#1a1735', color: '#e8e6f0' }}>
              {"  ".repeat(s.depth)}{s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="text-center mt-20">
            <div className="text-4xl mb-4">💬</div>
            <p className="text-base font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
              Ask anything about your notes
            </p>
            <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
              The AI will search your knowledge base and cite sources.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {[
                "Summarize my recent meeting notes",
                "What were the key decisions last week?",
                "What projects is the team working on?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="px-3 py-2 text-xs rounded-lg transition-colors"
                  style={{ background: "rgba(255,255,255,0.04)", color: "var(--text-secondary)", border: "1px solid var(--card-border)" }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i}>
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
              className="p-4 rounded-xl relative group"
              style={
                msg.role === "user"
                  ? { background: "var(--accent-soft)", color: "#c4b5fd", marginLeft: "3rem" }
                  : { background: "var(--card-bg)", border: "1px solid var(--card-border)", marginRight: "3rem" }
              }
            >
              {/* Copy button */}
              {msg.role === "assistant" && (
                <button
                  onClick={() => handleCopy(msg.content)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                  title="Copy to clipboard"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="5" y="5" width="8" height="8" rx="1.5" />
                    <path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" strokeLinecap="round" />
                  </svg>
                </button>
              )}
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
