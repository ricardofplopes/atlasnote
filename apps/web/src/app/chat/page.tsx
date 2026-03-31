"use client";

import { AppShell } from "@/components/app-shell";
import { useState } from "react";
import { chat } from "@/lib/api";
import Link from "next/link";

interface Citation {
  note_id: string;
  note_title: string;
  chunk_text: string;
  score: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
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

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const question = input;
    setInput("");

    const userMsg: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const data = await chat(question, undefined, history);
      const assistantMsg: Message = {
        role: "assistant",
        content: data.answer,
        citations: data.citations,
      };
      setMessages((prev) => [...prev, assistantMsg]);
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
          <p className="text-center mt-20" style={{ color: 'var(--text-muted)' }}>
            Ask a question about your notes. Answers are grounded in your actual content.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className="p-4 rounded-xl"
            style={
              msg.role === "user"
                ? { background: 'var(--accent-soft)', color: '#c4b5fd', marginLeft: '3rem' }
                : { background: 'var(--card-bg)', border: '1px solid var(--card-border)', marginRight: '3rem' }
            }
          >
            <p className="whitespace-pre-wrap" style={{ color: msg.role === "user" ? '#e0d7ff' : 'var(--foreground)' }}>{msg.content}</p>
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--card-border)' }}>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                  Sources:
                </p>
                <div className="space-y-1">
                  {msg.citations
                    .filter((c) => c.score > 0.5)
                    .slice(0, 5)
                    .map((c, j) => (
                      <Link
                        key={j}
                        href={`/notes/${c.note_id}`}
                        className="block text-xs hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        📄 {c.note_title} ({(c.score * 100).toFixed(0)}%)
                      </Link>
                    ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="p-4 rounded-xl mr-12" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
            <div className="animate-pulse" style={{ color: 'var(--text-muted)' }}>Thinking...</div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about your notes..."
          className="flex-1 px-4 py-3 rounded-xl focus:outline-none focus:ring-2"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--card-border)',
            color: 'var(--foreground)',
            ['--tw-ring-color' as string]: 'var(--accent)',
          }}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="px-6 py-3 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
          style={{ background: 'var(--accent)' }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
