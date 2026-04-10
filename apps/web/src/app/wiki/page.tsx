"use client";

import { useState, useEffect } from "react";
import { listSections, generateWiki } from "@/lib/api";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

interface Section {
  id: string;
  name: string;
  slug: string;
  children: Section[];
}

interface WikiCitation {
  index: number;
  note_id: string;
  note_title: string;
  chunk_text: string;
}

export default function WikiPage() {
  return <WikiContent />;
}

function WikiContent() {
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [topic, setTopic] = useState("");
  const [article, setArticle] = useState("");
  const [citations, setCitations] = useState<WikiCitation[]>([]);
  const [sectionName, setSectionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listSections().then(setSections).catch(console.error);
  }, []);

  const flatSections = (secs: Section[], depth = 0): { slug: string; name: string; depth: number }[] => {
    const result: { slug: string; name: string; depth: number }[] = [];
    for (const s of secs) {
      result.push({ slug: s.slug, name: s.name, depth });
      if (s.children) result.push(...flatSections(s.children, depth + 1));
    }
    return result;
  };

  const handleGenerate = async () => {
    if (!selectedSlug) return;
    setLoading(true);
    setError("");
    setArticle("");
    setCitations([]);

    try {
      const data = await generateWiki(selectedSlug, topic || undefined);
      setArticle(data.article);
      setCitations(data.citations || []);
      setSectionName(data.section_name);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to generate wiki article";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <h2 className="text-2xl font-display font-bold mb-6">Wiki Synthesis</h2>

      <div className="p-5 rounded-xl mb-6" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          Generate a synthesized wiki article from all notes in a section. The AI will compile and structure the information with inline citations.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={selectedSlug}
            onChange={(e) => setSelectedSlug(e.target.value)}
            className="flex-1 px-4 py-3 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--card-border)",
              color: "var(--foreground)",
            }}
          >
            <option value="" style={{ background: "#1a1735", color: "#e8e6f0" }}>Select a section...</option>
            {flatSections(sections).map((s) => (
              <option key={s.slug} value={s.slug} style={{ background: "#1a1735", color: "#e8e6f0" }}>
                {"  ".repeat(s.depth)}{s.name}
              </option>
            ))}
          </select>

          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic (optional)"
            className="flex-1 px-4 py-3 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--card-border)",
              color: "var(--foreground)",
            }}
          />

          <button
            onClick={handleGenerate}
            disabled={loading || !selectedSlug}
            className="px-6 py-3 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition whitespace-nowrap"
            style={{ background: "var(--accent)" }}
          >
            {loading ? "Generating..." : "Generate Article"}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl mb-4" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
          {error}
        </div>
      )}

      {loading && (
        <div className="p-8 rounded-xl text-center" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
          <div className="animate-pulse mb-2" style={{ color: "var(--accent)" }}>
            <svg className="w-8 h-8 mx-auto animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" opacity="0.3" />
              <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
            </svg>
          </div>
          <p style={{ color: "var(--text-muted)" }}>Synthesizing article from your notes... This may take a moment.</p>
        </div>
      )}

      {article && (
        <div>
          {/* Article */}
          <div className="p-6 rounded-xl mb-6" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-xl font-display font-bold mb-4" style={{ color: "var(--accent)" }}>
              {sectionName} {topic ? `— ${topic}` : ""}
            </h3>
            <div className="prose prose-invert prose-sm max-w-none" style={{ color: "var(--foreground)" }}>
              <ReactMarkdown>{article}</ReactMarkdown>
            </div>
          </div>

          {/* Citations */}
          {citations.length > 0 && (
            <div className="p-5 rounded-xl" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <h4 className="text-sm font-semibold mb-3" style={{ color: "var(--text-muted)" }}>Sources ({citations.length})</h4>
              <div className="space-y-2">
                {citations.map((c) => (
                  <div key={c.index} className="flex gap-3 text-sm">
                    <span className="font-mono text-xs mt-0.5 shrink-0" style={{ color: "var(--accent)" }}>[{c.index}]</span>
                    <div>
                      <Link href={`/notes/${c.note_id}`} className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
                        {c.note_title}
                      </Link>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {c.chunk_text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
