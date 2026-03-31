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
    <AppShell>
      <Suspense fallback={null}>
        <GitHubCallbackHandler />
      </Suspense>
      <RecentNotes />
    </AppShell>
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
        <p className="text-gray-500">No notes yet. Create one from a section!</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <Link
              key={note.id}
              href={`/notes/${note.id}`}
              className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-sm transition"
            >
              <div className="flex items-center gap-2">
                {note.is_pinned && <span title="Pinned">📌</span>}
                <h3 className="font-medium">{note.title}</h3>
              </div>
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                {note.content.slice(0, 200)}
              </p>
              <div className="flex gap-2 mt-2">
                {note.tags?.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">
                    {tag}
                  </span>
                ))}
                <span className="ml-auto text-xs text-gray-400">
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
