"use client";

import { useEffect, useState } from "react";
import { listDeletedNotes, restoreNote, hardDeleteNote } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";

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
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const load = () => {
    listDeletedNotes().then(setNotes).catch(console.error);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const handleRestore = async (id: string) => {
    try {
      await restoreNote(id);
      toastSuccess("Note restored");
      load();
    } catch {
      toastError("Failed to restore note");
    }
  };

  const handleHardDelete = async (id: string) => {
    const ok = await confirm({
      title: "Permanently delete note",
      message: "This note will be permanently deleted. This action cannot be undone.",
      confirmLabel: "Delete forever",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await hardDeleteNote(id);
      toastSuccess("Note permanently deleted");
      load();
    } catch {
      toastError("Failed to delete note");
    }
  };

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-display font-bold mb-6">Deleted Notes</h2>
      {notes.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🗑️</div>
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>No deleted notes</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Notes you delete will appear here for recovery.</p>
        </div>
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
                  className="text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{ color: '#4ade80', background: 'rgba(74,222,128,0.1)' }}
                >
                  Restore
                </button>
                <button
                  onClick={() => handleHardDelete(note.id)}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{ color: '#f87171', background: 'rgba(248,113,113,0.1)' }}
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
