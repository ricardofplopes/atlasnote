"use client";

import { useEffect, useState } from "react";
import { listRecentNotes } from "@/lib/api";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned: boolean;
  updated_at: string;
}

export default function HomePage() {
  return <RecentNotes />;
}

function RecentNotes() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      listRecentNotes()
        .then(setNotes)
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [user]);

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-display font-bold mb-6">Recent Notes</h2>
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-24 w-full" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📒</div>
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>No notes yet</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Create your first note from a section in the sidebar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <Link
              key={note.id}
              href={`/notes/${note.id}`}
              className="block p-4 rounded-xl transition-all duration-150 hover:scale-[1.01]"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--card-border)'}
            >
              <div className="flex items-center gap-2">
                {note.is_pinned && <span title="Pinned">📌</span>}
                <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>{note.title}</h3>
              </div>
              <p className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                {note.content.slice(0, 200)}
              </p>
              <div className="flex gap-2 mt-2">
                {note.tags?.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: '#a78bfa' }}>
                    {tag}
                  </span>
                ))}
                <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
                  {new Date(note.updated_at).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
