"use client";

import { AppShell } from "@/components/app-shell";
import { useEffect, useState } from "react";
import { listDeletedNotes, restoreNote, hardDeleteNote } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Note {
  id: string;
  title: string;
  deleted_at: string;
}

export default function DeletedPage() {
  return (
    <AppShell>
      <DeletedContent />
    </AppShell>
  );
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
      <h2 className="text-2xl font-bold mb-6">🗑️ Deleted Notes</h2>
      {notes.length === 0 ? (
        <p className="text-gray-500">No deleted notes.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className="p-4 bg-white rounded-lg border flex items-center justify-between"
            >
              <div>
                <h3 className="font-medium">{note.title}</h3>
                <p className="text-xs text-gray-400">
                  Deleted: {new Date(note.deleted_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleRestore(note.id)}
                  className="text-sm text-green-600 hover:underline"
                >
                  Restore
                </button>
                <button
                  onClick={() => handleHardDelete(note.id)}
                  className="text-sm text-red-500 hover:underline"
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
