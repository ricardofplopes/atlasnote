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
      <h2 className="text-2xl font-bold mb-4">💬 Chat with your notes</h2>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.length === 0 && (
          <p className="text-gray-400 text-center mt-20">
            Ask a question about your notes. Answers are grounded in your actual content.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`p-4 rounded-lg ${
              msg.role === "user"
                ? "bg-indigo-50 text-indigo-900 ml-12"
                : "bg-white border mr-12"
            }`}
          >
            <p className="whitespace-pre-wrap">{msg.content}</p>
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 mb-2">
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
                        className="block text-xs text-indigo-600 hover:underline"
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
          <div className="p-4 bg-white border rounded-lg mr-12">
            <div className="animate-pulse text-gray-400">Thinking...</div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about your notes..."
          className="flex-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
