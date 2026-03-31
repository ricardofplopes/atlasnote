"use client";

import { AppShell } from "@/components/app-shell";
import { useState } from "react";
import { semanticSearch } from "@/lib/api";
import Link from "next/link";

interface ChunkResult {
  note_id: string;
  note_title: string;
  section_name: string;
  chunk_text: string;
  score: number;
}

export default function SearchPage() {
  return (
    <AppShell>
      <SearchContent />
    </AppShell>
  );
}

function SearchContent() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChunkResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await semanticSearch(query);
      setResults(data.results);
      setSearched(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-display font-bold mb-6">🔍 Semantic Search</h2>
      <div className="flex gap-2 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search your notes by meaning..."
          className="flex-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "..." : "Search"}
        </button>
      </div>

      {searched && results.length === 0 && (
        <p className="text-gray-500">No results found.</p>
      )}

      <div className="space-y-3">
        {results.map((result, i) => (
          <Link
            key={i}
            href={`/notes/${result.note_id}`}
            className="block p-4 bg-white rounded-lg border hover:border-indigo-300 hover:shadow-sm transition"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-medium">{result.note_title}</h3>
              <span className="text-xs text-gray-400">
                {result.section_name} · {(result.score * 100).toFixed(0)}% match
              </span>
            </div>
            <p className="text-sm text-gray-600">{result.chunk_text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
