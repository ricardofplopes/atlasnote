"use client";

import { useState, useEffect } from "react";
import { semanticSearch, listSections } from "@/lib/api";
import Link from "next/link";
import { useToast } from "@/components/toast";

interface ChunkResult {
  note_id: string;
  note_title: string;
  section_name: string;
  chunk_text: string;
  score: number;
}

interface Section {
  id: string;
  name: string;
  slug: string;
  children: Section[];
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
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionFilter, setSectionFilter] = useState("");
  const { error: toastError } = useToast();

  useEffect(() => {
    listSections().then(setSections).catch(() => {});
  }, []);

  const flatSections = (secs: Section[], depth = 0): { slug: string; name: string; depth: number }[] => {
    const result: { slug: string; name: string; depth: number }[] = [];
    for (const s of secs) {
      result.push({ slug: s.slug, name: s.name, depth });
      if (s.children) result.push(...flatSections(s.children, depth + 1));
    }
    return result;
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await semanticSearch(query, sectionFilter || undefined, 20, mode);
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
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Filters row */}
      <div className="flex gap-3 mb-6 items-center flex-wrap">
        {/* Search mode */}
        <div className="flex gap-1">
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

        {/* Section filter */}
        <select
          value={sectionFilter}
          onChange={(e) => setSectionFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{
            background: '#1a1735',
            color: '#e8e6f0',
            border: '1px solid var(--card-border)',
          }}
        >
          <option value="" style={{ background: '#1a1735', color: '#e8e6f0' }}>All sections</option>
          {flatSections(sections).map((s) => (
            <option key={s.slug} value={s.slug} style={{ background: '#1a1735', color: '#e8e6f0' }}>
              {"  ".repeat(s.depth)}{s.name}
            </option>
          ))}
        </select>

        {searched && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {results.length} result{results.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Results */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>No results found</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Try different keywords or switch search mode.</p>
        </div>
      )}

      {!loading && !searched && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🔎</div>
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Search your knowledge base</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Try &quot;project updates&quot;, &quot;meeting with Craig&quot;, or any topic from your notes.
          </p>
        </div>
      )}

      {!loading && (
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
      )}
    </div>
  );
}
