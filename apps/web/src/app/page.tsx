"use client";

import { AppShell } from "@/components/app-shell";
import { Suspense, useEffect, useState } from "react";
import { listRecentNotes, loginWithGitHub } from "@/lib/api";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSearchParams } from "next/navigation";

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned: boolean;
  updated_at: string;
}

function GitHubCallbackHandler() {
  const { setToken, user } = useAuth();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("github_code");
    if (code && !user) {
      loginWithGitHub(code)
        .then((data) => {
          setToken(data.access_token);
          window.history.replaceState({}, "", "/");
        })
        .catch(console.error);
    }
  }, [searchParams, user, setToken]);

  return null;
}

export default function HomePage() {
  return (
    <>
      <Suspense fallback={null}>
        <GitHubCallbackHandler />
      </Suspense>
      <AppShell>
        <RecentNotes />
      </AppShell>
    </>
  );
}

function RecentNotes() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (user) listRecentNotes().then(setNotes).catch(console.error);
  }, [user]);

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-display font-bold mb-6">Recent Notes</h2>
      {notes.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No notes yet. Create one from a section!</p>
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
