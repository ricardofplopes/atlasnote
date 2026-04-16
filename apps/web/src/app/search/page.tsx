"use client";

import { useState } from "react";
import { semanticSearch } from "@/lib/api";
import Link from "next/link";
import { useToast } from "@/components/toast";

interface ChunkResult {
  note_id: string;
  note_title: string;
  section_name: string;
  chunk_text: string;
  score: number;
}

export default function SearchPage() {
  return <SearchContent />;
}

function SearchContent() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChunkResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [mode, setMode] = useState<"hybrid" | "semantic" | "keyword">("hybrid");
  const { error: toastError } = useToast();

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await semanticSearch(query, undefined, 10, mode);
      setResults(data.results);
      setSearched(true);
    } catch (e) {
      toastError("Search failed. Check your connection settings.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-display font-bold mb-6">Search</h2>
      <div className="flex gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search your notes..."
          className="flex-1 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 text-lg"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--card-border)',
            color: 'var(--foreground)',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-6 py-3 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
          style={{ background: 'var(--accent)' }}
        >
          {loading ? "..." : "Search"}
        </button>
      </div>

      {/* Search mode selector */}
      <div className="flex gap-2 mb-6">
        {(["hybrid", "semantic", "keyword"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition"
            style={{
              background: mode === m ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
              color: mode === m ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--card-border)'}`,
            }}
          >
            {m === "hybrid" ? "Hybrid" : m === "semantic" ? "Semantic" : "Keyword"}
          </button>
        ))}
      </div>

      {searched && results.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>No results found.</p>
      )}

      <div className="space-y-3">
        {results.map((result, i) => (
          <Link
            key={i}
            href={`/notes/${result.note_id}`}
            className="block p-4 rounded-xl transition-all duration-150 hover:scale-[1.01]"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--card-border)'}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>{result.note_title}</h3>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {result.section_name} · {(result.score * 100).toFixed(0)}% match
              </span>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{result.chunk_text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
