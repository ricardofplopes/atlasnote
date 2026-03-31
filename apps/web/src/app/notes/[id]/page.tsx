"use client";

import { AppShell } from "@/components/app-shell";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getNote,
  updateNote,
  softDeleteNote,
  restoreNote,
  togglePin,
  listVersions,
  restoreVersion,
} from "@/lib/api";

interface Note {
  id: string;
  section_id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned: boolean;
  is_deleted: boolean;
  updated_at: string;
  created_at: string;
}

interface Version {
  id: string;
  note_id: string;
  title: string;
  content: string;
  version_number: number;
  created_at: string;
}

export default function NotePage() {
  return (
    <AppShell>
      <NoteContent />
    </AppShell>
  );
}

function NoteContent() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.id as string;
  const [note, setNote] = useState<Note | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVersions, setShowVersions] = useState(false);

  const load = () => {
    getNote(noteId).then((n) => {
      setNote(n);
      setTitle(n.title);
      setContent(n.content);
      setTags((n.tags || []).join(", "));
    });
  };

  useEffect(() => {
    load();
  }, [noteId]);

  const handleSave = async () => {
    await updateNote(noteId, {
      title,
      content,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    setEditing(false);
    load();
  };

  const handleDelete = async () => {
    if (!note) return;
    if (note.is_deleted) {
      await restoreNote(noteId);
    } else {
      await softDeleteNote(noteId);
    }
    load();
  };

  const handlePin = async () => {
    await togglePin(noteId);
    load();
  };

  const handleShowVersions = async () => {
    const v = await listVersions(noteId);
    setVersions(v);
    setShowVersions(!showVersions);
  };

  const handleRestoreVersion = async (versionId: string) => {
    await restoreVersion(noteId, versionId);
    setShowVersions(false);
    load();
  };

  if (!note) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
          ←
        </button>
        <div className="flex-1" />
        <button
          onClick={handlePin}
          className={`px-3 py-1.5 text-sm rounded-lg ${
            note.is_pinned ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
          }`}
        >
          {note.is_pinned ? "📌 Pinned" : "Pin"}
        </button>
        <button
          onClick={handleShowVersions}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"
        >
          History
        </button>
        <button
          onClick={() => setEditing(!editing)}
          className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {editing ? "Cancel" : "Edit"}
        </button>
        <button
          onClick={handleDelete}
          className={`px-3 py-1.5 text-sm rounded-lg ${
            note.is_deleted
              ? "bg-green-100 text-green-700 hover:bg-green-200"
              : "text-red-500 hover:bg-red-50"
          }`}
        >
          {note.is_deleted ? "Restore" : "Delete"}
        </button>
      </div>

      {editing ? (
        <div className="space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-2xl font-bold px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
          />
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags (comma separated)"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Save
          </button>
        </div>
      ) : (
        <div>
          <h1 className="text-2xl font-bold mb-2">{note.title}</h1>
          <div className="flex gap-2 mb-4">
            {note.tags?.map((tag) => (
              <span key={tag} className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full">
                {tag}
              </span>
            ))}
          </div>
          <div className="prose max-w-none bg-white p-6 rounded-lg border">
            {note.content.split("\n").map((line, i) => (
              <p key={i} className={line ? "" : "h-4"}>
                {line}
              </p>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Created: {new Date(note.created_at).toLocaleString()} · Updated:{" "}
            {new Date(note.updated_at).toLocaleString()}
          </p>
        </div>
      )}

      {showVersions && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-3">Version History</h3>
          {versions.length === 0 ? (
            <p className="text-gray-500">No versions yet.</p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="p-3 bg-white border rounded-lg flex items-center justify-between"
                >
                  <div>
                    <span className="font-medium">v{v.version_number}</span>
                    <span className="text-gray-500 ml-2">{v.title}</span>
                    <span className="text-xs text-gray-400 ml-2">
                      {new Date(v.created_at).toLocaleString()}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRestoreVersion(v.id)}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
