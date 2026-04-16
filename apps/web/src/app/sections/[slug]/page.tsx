"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getSection,
  listNotesBySection,
  createNote,
  createSection,
  deleteSection,
  reorderNotes,
  listSections,
  moveSection,
  autoTagNote,
  formatContent,
  exportSection,
} from "@/lib/api";
import ReactMarkdown from "react-markdown";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Section {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  children: Section[];
}

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned: boolean;
  position: number;
  updated_at: string;
}

function SortableNoteCard({ note }: { note: Note }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: "var(--card-bg)" as string,
    border: "1px solid var(--card-border)" as string,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-xl transition-all duration-150 flex items-stretch"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="flex items-center px-2 cursor-grab active:cursor-grabbing rounded-l-xl shrink-0"
        style={{ color: "var(--text-muted)" }}
        title="Drag to reorder"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5" />
          <circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" />
          <circle cx="11" cy="13" r="1.5" />
        </svg>
      </button>

      {/* Note content (clickable link) */}
      <Link
        href={`/notes/${note.id}`}
        className="block p-4 flex-1 hover:bg-white/[0.02] rounded-r-xl transition"
      >
        <div className="flex items-center gap-2">
          {note.is_pinned && <span>📌</span>}
          <h3 className="font-semibold" style={{ color: "var(--foreground)" }}>
            {note.title}
          </h3>
        </div>
        <p
          className="text-sm mt-1 line-clamp-2"
          style={{ color: "var(--text-secondary)" }}
        >
          {note.content.slice(0, 200)}
        </p>
        <div className="flex gap-2 mt-2">
          {note.tags?.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: "var(--accent-soft)", color: "#a78bfa" }}
            >
              {tag}
            </span>
          ))}
          <span
            className="ml-auto text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {new Date(note.updated_at).toLocaleDateString()}
          </span>
        </div>
      </Link>
    </div>
  );
}

export default function SectionPage() {
  return <SectionContent />;
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
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [showMdHelp, setShowMdHelp] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [formatPreview, setFormatPreview] = useState<string | null>(null);

  const [showMove, setShowMove] = useState(false);
  const [allSections, setAllSections] = useState<Section[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const load = () => {
    setError(false);
    setLoading(true);
    Promise.all([
      getSection(slug).catch(() => { setError(true); return null; }),
      listNotesBySection(slug, true).catch(() => []),
    ]).then(([sec, notesList]) => {
      if (sec) setSection(sec);
      setNotes(notesList || []);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, [slug]);

  const handleCreateNote = async () => {
    if (!newTitle.trim()) return;
    try {
      const newNote = await createNote(slug, {
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
      toastSuccess("Note created");
      load();
      if (newNote?.id) {
        autoTagNote(newNote.id).catch(() => {});
      }
    } catch {
      toastError("Failed to create note");
    }
  };

  const handleCreateSub = async () => {
    if (!newSubName.trim() || !section) return;
    try {
      await createSection({ name: newSubName, parent_id: section.id });
      setNewSubName("");
      setShowNewSub(false);
      toastSuccess("Sub-section created");
      load();
      window.dispatchEvent(new Event("sections:refresh"));
    } catch {
      toastError("Failed to create sub-section");
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete section",
      message: "This section and all its notes will be soft-deleted. Notes can be recovered from the Deleted page.",
      confirmLabel: "Delete section",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteSection(slug);
      toastSuccess("Section deleted");
      window.dispatchEvent(new Event("sections:refresh"));
      router.push("/");
    } catch {
      toastError("Failed to delete section");
    }
  };

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = notes.findIndex((n) => n.id === active.id);
      const newIndex = notes.findIndex((n) => n.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Optimistic reorder
      const reordered = [...notes];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      setNotes(reordered);

      // Persist positions
      const items = reordered.map((n, i) => ({ id: n.id, position: i }));
      try {
        await reorderNotes(items);
      } catch (err) {
        console.error("Failed to save order:", err);
        load(); // Revert on failure
      }
    },
    [notes]
  );

  const suggestTitle = (): string => {
    if (notes.length === 0) return "";

    const datePatterns = [
      { regex: /(\d{2}\/\d{2}\/\d{4})/, format: (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` },
      { regex: /(\d{4}-\d{2}-\d{2})/, format: (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` },
      { regex: /(\d{2}-\d{2}-\d{4})/, format: (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}` },
      { regex: /(\d{2}\.\d{2}\.\d{4})/, format: (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` },
    ];

    for (const pattern of datePatterns) {
      const matches: { prefix: string; suffix: string }[] = [];

      for (const note of notes) {
        const match = note.title.match(pattern.regex);
        if (match) {
          const idx = match.index!;
          const prefix = note.title.substring(0, idx);
          const suffix = note.title.substring(idx + match[1].length);
          matches.push({ prefix, suffix });
        }
      }

      if (matches.length >= 2) {
        const prefixCounts: Record<string, number> = {};
        for (const m of matches) {
          prefixCounts[m.prefix] = (prefixCounts[m.prefix] || 0) + 1;
        }
        const topPrefix = Object.entries(prefixCounts).sort((a, b) => b[1] - a[1])[0];
        if (topPrefix && topPrefix[1] >= 2) {
          const today = new Date();
          return `${topPrefix[0]}${pattern.format(today)}`;
        }
      }
    }

    if (notes.length >= 2) {
      const titles = notes.map(n => n.title);
      let prefix = titles[0];
      for (let i = 1; i < titles.length; i++) {
        while (!titles[i].startsWith(prefix) && prefix.length > 0) {
          prefix = prefix.substring(0, prefix.length - 1);
        }
      }
      if (prefix.length >= 5) {
        const matchCount = titles.filter(t => t.startsWith(prefix)).length;
        if (matchCount >= Math.ceil(titles.length * 0.5)) {
          const today = new Date();
          const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
          const cleanPrefix = prefix.replace(/[\s—–\-]+$/, '');
          return `${cleanPrefix} — ${dateStr}`;
        }
      }
    }

    return "";
  };

  const insertMarkdown = (before: string, after: string = "") => {
    const ta = contentRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = newContent.substring(start, end);
    const replacement = before + (selected || "text") + after;
    const updated = newContent.substring(0, start) + replacement + newContent.substring(end);
    setNewContent(updated);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + (selected || "text").length);
    }, 0);
  };

  if (error)
    return (
      <div style={{ color: "var(--text-muted)" }}>
        Failed to load section. Please try again.
      </div>
    );
  if (!section)
    return <div style={{ color: "var(--text-muted)" }}>{loading ? "Loading..." : "Section not found."}</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-display font-bold">{section.name}</h2>
          {section.description && (
            <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
              {section.description}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {showNewNote ? (
            <button
              onClick={() => {
                setShowNewNote(false);
                setNewTitle("");
                setNewContent("");
                setNewTags("");
              }}
              className="px-3 py-1.5 text-sm font-medium rounded-lg transition text-red-400 hover:bg-red-400/10"
            >
              Cancel
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  setShowNewNote(true);
                  setNewTitle(suggestTitle());
                }}
                className="px-3 py-1.5 text-white text-sm font-semibold rounded-lg hover:opacity-90 transition"
                style={{ background: "var(--accent)" }}
              >
                + Note
              </button>
              <button
                onClick={() => setShowNewSub(!showNewSub)}
                className="px-3 py-1.5 text-sm font-semibold rounded-lg transition"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--text-secondary)",
                }}
              >
                + Sub-section
              </button>
              <button
                onClick={async () => {
                  const secs = await listSections();
                  setAllSections(secs);
                  setShowMove(!showMove);
                }}
                className="px-3 py-1.5 text-sm font-medium rounded-lg transition"
                style={{ color: "var(--text-secondary)", background: "rgba(255,255,255,0.06)" }}
              >
                Move
              </button>
              <button
                onClick={async () => {
                  try {
                    await exportSection(slug);
                    toastSuccess("Section exported");
                  } catch {
                    toastError("Export failed");
                  }
                }}
                className="px-3 py-1.5 text-sm font-medium rounded-lg transition"
                style={{ color: "var(--text-secondary)", background: "rgba(255,255,255,0.06)" }}
              >
                Export
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-sm font-medium rounded-lg transition text-red-400 hover:bg-red-400/10"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {showMove && (
        <div
          className="mb-4 p-4 rounded-xl"
          style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
        >
          <p className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
            Move to:
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            <button
              onClick={async () => {
                await moveSection(slug, null);
                setShowMove(false);
                load();
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              📁 Top level (no parent)
            </button>
            {allSections.flatMap((s) => {
              const items: Section[] = [s, ...(s.children || []).flatMap((c: Section) => [c, ...(c.children || [])])];
              return items
                .filter((item: Section) => item.id !== section?.id)
                .map((item: Section) => (
                  <button
                    key={item.id}
                    onClick={async () => {
                      await moveSection(slug, item.id);
                      setShowMove(false);
                      load();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
                    style={{ color: "var(--text-secondary)" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    {item.parent_id ? "  ↳ " : "📁 "}{item.name}
                  </button>
                ));
            })}
          </div>
        </div>
      )}

      {/* Sub-sections */}
      {section.children && section.children.length > 0 && (
        <div className="mb-6">
          <h3
            className="text-sm font-bold uppercase mb-2 tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            Sub-sections
          </h3>
          <div className="flex flex-wrap gap-2">
            {section.children.map((child) => (
              <Link
                key={child.id}
                href={`/sections/${child.slug}`}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition"
                style={{ background: "var(--accent-soft)", color: "#a78bfa" }}
              >
                {child.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {showNewSub && (
        <div
          className="mb-4 p-4 rounded-xl flex gap-2"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
          }}
        >
          <input
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateSub()}
            placeholder="Sub-section name"
            className="flex-1 px-3 py-2 rounded-lg focus:outline-none focus:ring-2"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--card-border)",
              color: "var(--foreground)",
              ["--tw-ring-color" as string]: "var(--accent)",
            }}
            autoFocus
          />
          <button
            onClick={handleCreateSub}
            className="px-4 py-2 text-white rounded-lg font-semibold hover:opacity-90 transition"
            style={{ background: "var(--accent)" }}
          >
            Create
          </button>
        </div>
      )}

      {showNewNote && (
        <div
          className="mb-4 p-4 rounded-xl space-y-3"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
          }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Note title"
            className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--card-border)",
              color: "var(--foreground)",
              ["--tw-ring-color" as string]: "var(--accent)",
            }}
            autoFocus
          />

          {/* Markdown toolbar */}
          <div className="flex items-center gap-1 flex-wrap" style={{ borderBottom: "1px solid var(--card-border)", paddingBottom: "8px" }}>
            {[
              { label: "B", title: "Bold", action: () => insertMarkdown("**", "**") },
              { label: "I", title: "Italic", action: () => insertMarkdown("*", "*") },
              { label: "H", title: "Heading", action: () => insertMarkdown("## ", "") },
              { label: "•", title: "Bullet List", action: () => insertMarkdown("- ", "") },
              { label: "1.", title: "Ordered List", action: () => insertMarkdown("1. ", "") },
              { label: "<>", title: "Code", action: () => insertMarkdown("`", "`") },
              { label: "🔗", title: "Link", action: () => insertMarkdown("[", "](url)") },
              { label: "❝", title: "Quote", action: () => insertMarkdown("> ", "") },
              { label: "—", title: "Horizontal Rule", action: () => insertMarkdown("\n---\n", "") },
            ].map((btn) => (
              <button
                key={btn.title}
                onClick={btn.action}
                title={btn.title}
                className="px-2 py-1 text-xs font-mono rounded transition-colors"
                style={{ color: "var(--text-secondary)", background: "rgba(255,255,255,0.04)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                  e.currentTarget.style.color = "var(--foreground)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
                type="button"
              >
                {btn.label}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={async () => {
                if (!newContent.trim()) return;
                setFormatting(true);
                try {
                  const res = await formatContent(newTitle || "Untitled", newContent);
                  setFormatPreview(res.formatted_content);
                } catch (e) {
                  console.error("Format failed:", e);
                } finally {
                  setFormatting(false);
                }
              }}
              disabled={formatting || !newContent.trim()}
              className="px-2.5 py-1 text-xs font-medium rounded transition-colors disabled:opacity-40"
              style={{ background: "rgba(122,92,255,0.15)", color: "#a78bfa" }}
              onMouseEnter={(e) => { if (!formatting) e.currentTarget.style.background = "rgba(122,92,255,0.25)"; }}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(122,92,255,0.15)"}
              type="button"
            >
              {formatting ? "Formatting..." : "✨ Format with AI"}
            </button>
            <button
              onClick={() => setShowMdHelp(!showMdHelp)}
              title="Markdown Help"
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "var(--foreground)"}
              onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-muted)"}
              type="button"
            >
              ?
            </button>
          </div>

          {showMdHelp && (
            <div
              className="p-3 rounded-lg text-xs font-mono space-y-1"
              style={{ background: "rgba(255,255,255,0.04)", color: "var(--text-secondary)" }}
            >
              <div><strong style={{ color: "var(--foreground)" }}>Markdown Cheat Sheet</strong></div>
              <div># Heading 1 &nbsp;&nbsp; ## Heading 2 &nbsp;&nbsp; ### Heading 3</div>
              <div>**bold** &nbsp;&nbsp; *italic* &nbsp;&nbsp; ~~strikethrough~~</div>
              <div>- bullet list &nbsp;&nbsp; 1. numbered list</div>
              <div>`inline code` &nbsp;&nbsp; ```code block```</div>
              <div>[link text](url) &nbsp;&nbsp; ![image](url)</div>
              <div>&gt; blockquote &nbsp;&nbsp; --- horizontal rule</div>
              <div>| Col 1 | Col 2 | &nbsp;&nbsp; (tables)</div>
            </div>
          )}

          <textarea
            ref={contentRef}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Write your note in markdown..."
            rows={8}
            className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 font-mono text-sm"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--card-border)",
              color: "var(--foreground)",
              ["--tw-ring-color" as string]: "var(--accent)",
            }}
          />

          {formatPreview !== null && (
            <div className="p-4 rounded-xl space-y-3" style={{ background: "rgba(122,92,255,0.05)", border: "1px solid rgba(122,92,255,0.2)" }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: "#a78bfa" }}>✨ AI Formatted Preview</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setNewContent(formatPreview);
                      setFormatPreview(null);
                    }}
                    className="px-3 py-1 text-xs font-semibold rounded-lg text-white"
                    style={{ background: "var(--accent)" }}
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => setFormatPreview(null)}
                    className="px-3 py-1 text-xs font-medium rounded-lg"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <div className="p-3 rounded-lg prose prose-invert prose-sm max-w-none text-sm" style={{ background: "rgba(0,0,0,0.2)" }}>
                <ReactMarkdown>{formatPreview}</ReactMarkdown>
              </div>
            </div>
          )}

          <input
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            placeholder="Tags (comma separated)"
            className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--card-border)",
              color: "var(--foreground)",
              ["--tw-ring-color" as string]: "var(--accent)",
            }}
          />
          <button
            onClick={handleCreateNote}
            className="px-4 py-2 text-white rounded-lg font-semibold hover:opacity-90 transition"
            style={{ background: "var(--accent)" }}
          >
            Create Note
          </button>
        </div>
      )}

      {/* Notes list with drag-and-drop */}
      <div className="space-y-3">
        {notes.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📝</div>
            <p className="text-base font-medium mb-1" style={{ color: "var(--text-secondary)" }}>No notes yet</p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Click &quot;+ Note&quot; above to create your first note in this section.</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={notes.map((n) => n.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {notes.map((note) => (
                  <SortableNoteCard key={note.id} note={note} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
