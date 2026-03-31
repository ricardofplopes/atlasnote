"use client";

import { AppShell } from "@/components/app-shell";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getSection,
  listNotesBySection,
  createNote,
  createSection,
  deleteSection,
} from "@/lib/api";

interface Section {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  children: Section[];
}

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned: boolean;
  updated_at: string;
}

export default function SectionPage() {
  return (
    <AppShell>
      <SectionContent />
    </AppShell>
  );
}

function SectionContent() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const [section, setSection] = useState<Section | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [showNewNote, setShowNewNote] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");
  const [showNewSub, setShowNewSub] = useState(false);
  const [newSubName, setNewSubName] = useState("");

  const load = () => {
    getSection(slug).then(setSection).catch(console.error);
    listNotesBySection(slug, true).then(setNotes).catch(console.error);
  };

  useEffect(() => {
    load();
  }, [slug]);

  const handleCreateNote = async () => {
    if (!newTitle.trim()) return;
    await createNote(slug, {
      title: newTitle,
      content: newContent,
      tags: newTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setNewTitle("");
    setNewContent("");
    setNewTags("");
    setShowNewNote(false);
    load();
  };

  const handleCreateSub = async () => {
    if (!newSubName.trim() || !section) return;
    await createSection({ name: newSubName, parent_id: section.id });
    setNewSubName("");
    setShowNewSub(false);
    load();
  };

  const handleDelete = async () => {
    if (!confirm("Delete this section and all its notes?")) return;
    await deleteSection(slug);
    router.push("/");
  };

  if (!section) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">{section.name}</h2>
          {section.description && (
            <p className="text-gray-500 mt-1">{section.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNewNote(!showNewNote)}
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
          >
            + Note
          </button>
          <button
            onClick={() => setShowNewSub(!showNewSub)}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300"
          >
            + Sub-section
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-red-500 text-sm rounded-lg hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Sub-sections */}
      {section.children && section.children.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
            Sub-sections
          </h3>
          <div className="flex flex-wrap gap-2">
            {section.children.map((child) => (
              <Link
                key={child.id}
                href={`/sections/${child.slug}`}
                className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm hover:bg-indigo-100"
              >
                {child.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {showNewSub && (
        <div className="mb-4 p-4 bg-white rounded-lg border flex gap-2">
          <input
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateSub()}
            placeholder="Sub-section name"
            className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
          <button
            onClick={handleCreateSub}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Create
          </button>
        </div>
      )}

      {showNewNote && (
        <div className="mb-4 p-4 bg-white rounded-lg border space-y-3">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Note title"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Note content (markdown)"
            rows={6}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
          />
          <input
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            placeholder="Tags (comma separated)"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleCreateNote}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Create Note
          </button>
        </div>
      )}

      {/* Notes list */}
      <div className="space-y-3">
        {notes.length === 0 ? (
          <p className="text-gray-500">No notes in this section yet.</p>
        ) : (
          notes.map((note) => (
            <Link
              key={note.id}
              href={`/notes/${note.id}`}
              className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-sm transition"
            >
              <div className="flex items-center gap-2">
                {note.is_pinned && <span>📌</span>}
                <h3 className="font-medium">{note.title}</h3>
              </div>
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                {note.content.slice(0, 200)}
              </p>
              <div className="flex gap-2 mt-2">
                {note.tags?.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-600"
                  >
                    {tag}
                  </span>
                ))}
                <span className="ml-auto text-xs text-gray-400">
                  {new Date(note.updated_at).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
