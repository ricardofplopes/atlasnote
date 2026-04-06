"use client";

import { useEffect, useState } from "react";
import { listDeletedNotes, restoreNote, hardDeleteNote } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Note {
  id: string;
  title: string;
  deleted_at: string;
}

export default function DeletedPage() {
  return <DeletedContent />;
}

function DeletedContent() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);

  const load = () => {
    listDeletedNotes().then(setNotes).catch(console.error);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const handleRestore = async (id: string) => {
    await restoreNote(id);
    load();
  };

  const handleHardDelete = async (id: string) => {
    if (!confirm("Permanently delete this note? This cannot be undone.")) return;
    await hardDeleteNote(id);
    load();
  };

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-display font-bold mb-6">Deleted Notes</h2>
      {notes.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No deleted notes.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className="p-4 rounded-xl flex items-center justify-between"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
              }}
            >
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>{note.title}</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Deleted: {new Date(note.deleted_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleRestore(note.id)}
                  className="text-sm font-medium text-green-400 hover:underline"
                >
                  Restore
                </button>
                <button
                  onClick={() => handleHardDelete(note.id)}
                  className="text-sm font-medium text-red-400 hover:underline"
                >
                  Delete forever
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
