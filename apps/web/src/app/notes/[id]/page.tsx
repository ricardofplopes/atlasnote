"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getNote,
  updateNote,
  softDeleteNote,
  restoreNote,
  togglePin,
  listVersions,
  restoreVersion,
  getRelatedNotes,
  formatNoteMarkdown,
  autoTagNote,
  exportNote,
} from "@/lib/api";
import ReactMarkdown from "react-markdown";
import dynamic from "next/dynamic";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";

// Lazy load CodeMirror to avoid SSR issues
const MarkdownEditor = dynamic(
  () => import("@/components/markdown-editor").then((mod) => ({ default: mod.MarkdownEditor })),
  { ssr: false, loading: () => <div className="h-96 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} /> }
);

interface Note {
  id: string;
  section_id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned: boolean;
  is_deleted: boolean;
  source_url?: string;
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

interface RelatedNote {
  id: string;
  title: string;
  section_name: string;
  score: number;
}

export default function NotePage() {
  return <NoteContent />;
}

function MiniGraph({ noteId, noteTitle }: { noteId: string; noteTitle: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const router = useRouter();

  useEffect(() => {
    getRelatedNotes(noteId, 6).then(setRelated).catch(() => setRelated([]));
  }, [noteId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || related.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.32;

    // Node positions
    const nodes = [
      { x: cx, y: cy, label: noteTitle.slice(0, 20), id: noteId, isCenter: true },
      ...related.map((r, i) => {
        const angle = (i / related.length) * Math.PI * 2 - Math.PI / 2;
        return {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          label: r.title.slice(0, 18),
          id: r.id,
          isCenter: false,
          score: r.score,
        };
      }),
    ];

    // Draw edges
    for (let i = 1; i < nodes.length; i++) {
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      ctx.lineTo(nodes[i].x, nodes[i].y);
      ctx.strokeStyle = "rgba(122,92,255,0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      const r = node.isCenter ? 8 : 6;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.isCenter ? "#7A5CFF" : "rgba(122,92,255,0.5)";
      ctx.fill();

      ctx.font = "10px Inter, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.textAlign = "center";
      ctx.fillText(node.label, node.x, node.y + r + 12);
    }

    // Click handler
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const node of nodes) {
        if (!node.isCenter && Math.hypot(mx - node.x, my - node.y) < 12) {
          router.push(`/notes/${node.id}`);
          break;
        }
      }
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [related, noteId, noteTitle, router]);

  if (related.length === 0) return null;

  return (
    <div className="mt-6 p-4 rounded-xl" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
      <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-muted)" }}>Related Notes</h4>
      <canvas ref={canvasRef} className="w-full cursor-pointer" style={{ height: "200px" }} />
    </div>
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
  const [sourceUrl, setSourceUrl] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [formatPreview, setFormatPreview] = useState<string | null>(null);
  const [formatting, setFormatting] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[] | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "idle">("idle");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const load = () => {
    getNote(noteId).then((n) => {
      setNote(n);
      setTitle(n.title);
      setContent(n.content);
      setTags((n.tags || []).join(", "));
      setSourceUrl(n.source_url || "");
      setSaveStatus("idle");
    });
  };

  useEffect(() => {
    load();
  }, [noteId]);

  const performSave = useCallback(async (silent = false) => {
    setSaveStatus("saving");
    try {
      await updateNote(noteId, {
        title,
        content,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        source_url: sourceUrl || undefined,
      });
      setSaveStatus("saved");
      if (!silent) toastSuccess("Note saved");
      // Reload to get updated timestamps
      const n = await getNote(noteId);
      setNote(n);
    } catch (e) {
      setSaveStatus("unsaved");
      if (!silent) toastError("Failed to save note");
    }
  }, [noteId, title, content, tags, sourceUrl, toastSuccess, toastError]);

  // Auto-save: debounce 2.5s after edits while in editing mode
  useEffect(() => {
    if (!editing || saveStatus !== "unsaved") return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => performSave(true), 2500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [title, content, tags, sourceUrl, editing, saveStatus, performSave]);

  // Mark as unsaved when fields change while editing
  const markUnsaved = useCallback(() => {
    if (editing && saveStatus !== "saving") setSaveStatus("unsaved");
  }, [editing, saveStatus]);

  useEffect(() => { if (editing) markUnsaved(); }, [title, content, tags, sourceUrl]);

  // Keyboard shortcut: Ctrl+S to save
  useEffect(() => {
    if (!editing) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        performSave();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [editing, performSave]);

  const handleSave = async () => {
    await performSave();
    setEditing(false);
    load();
  };

  const handleDelete = async () => {
    if (!note) return;
    if (note.is_deleted) {
      await restoreNote(noteId);
      toastSuccess("Note restored");
    } else {
      const ok = await confirm({
        title: "Delete note",
        message: "This note will be moved to trash. You can restore it later.",
        confirmLabel: "Delete",
        variant: "danger",
      });
      if (!ok) return;
      await softDeleteNote(noteId);
      toastSuccess("Note moved to trash");
    }
    load();
  };

  const handlePin = async () => {
    await togglePin(noteId);
    toastSuccess(note?.is_pinned ? "Note unpinned" : "Note pinned");
    load();
  };

  const handleShowVersions = async () => {
    const v = await listVersions(noteId);
    setVersions(v);
    setShowVersions(!showVersions);
  };

  const handleRestoreVersion = async (versionId: string) => {
    const ok = await confirm({
      title: "Restore version",
      message: "This will replace the current note content with this version. A backup of the current version will be saved.",
      confirmLabel: "Restore",
      variant: "warning",
    });
    if (!ok) return;
    await restoreVersion(noteId, versionId);
    toastSuccess("Version restored");
    setShowVersions(false);
    load();
  };

  // Word count helper
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  if (!note) {
    return (
      <div className="max-w-4xl space-y-4">
        <div className="h-8 w-48 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
        <div className="h-96 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => router.back()}
          className="transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--foreground)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          ←
        </button>
        <div className="flex-1" />
        <button
          onClick={handlePin}
          className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
          style={{
            background: note.is_pinned ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)',
            color: note.is_pinned ? '#fbbf24' : 'var(--text-secondary)',
          }}
        >
          {note.is_pinned ? "📌 Pinned" : "Pin"}
        </button>
        <button
          onClick={handleShowVersions}
          className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
          style={{
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--text-secondary)',
          }}
        >
          History
        </button>
        <button
          onClick={async () => {
            try {
              await exportNote(noteId);
              toastSuccess("Note exported");
            } catch {
              toastError("Export failed");
            }
          }}
          className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
          style={{
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--text-secondary)',
          }}
        >
          Export
        </button>
        <button
          onClick={() => setEditing(!editing)}
          className="px-3 py-1.5 text-sm font-semibold rounded-lg text-white transition-colors hover:opacity-90"
          style={{ background: 'var(--accent)' }}
        >
          {editing ? "Cancel" : "Edit"}
        </button>
        <button
          onClick={handleDelete}
          className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
          style={{
            background: note.is_deleted ? 'rgba(74,222,128,0.15)' : 'transparent',
            color: note.is_deleted ? '#4ade80' : '#f87171',
          }}
        >
          {note.is_deleted ? "Restore" : "Delete"}
        </button>
      </div>

      {editing ? (
        <div className="space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-2xl font-display font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-2"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--card-border)',
              color: 'var(--foreground)',
              ['--tw-ring-color' as string]: 'var(--accent)',
            }}
          />
          <MarkdownEditor
            value={content}
            onChange={setContent}
            placeholder="Write your note in markdown..."
            onFormatAI={async () => {
              setFormatting(true);
              try {
                const res = await formatNoteMarkdown(noteId);
                setFormatPreview(res.formatted_content);
              } catch (e) {
                console.error("Format failed:", e);
              } finally {
                setFormatting(false);
              }
            }}
            formattingAI={formatting}
          />
          {formatPreview !== null && (
            <div className="p-4 rounded-xl space-y-3" style={{ background: "rgba(122,92,255,0.05)", border: "1px solid rgba(122,92,255,0.2)" }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: "#a78bfa" }}>✨ AI Formatted Preview</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setContent(formatPreview);
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
          <div className="flex items-center gap-2">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Tags (comma separated)"
              className="flex-1 px-3 py-2 rounded-xl focus:outline-none focus:ring-2"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--card-border)',
                color: 'var(--foreground)',
              }}
            />
            <button
              onClick={async () => {
                setTagging(true);
                try {
                  const res = await autoTagNote(noteId);
                  if (res?.tags && res.tags.length > 0) {
                    setSuggestedTags(res.tags);
                  }
                } catch (e) {
                  console.error("Tag suggestion failed:", e);
                } finally {
                  setTagging(false);
                }
              }}
              disabled={tagging}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
              style={{ background: "rgba(122,92,255,0.15)", color: "#a78bfa" }}
              type="button"
            >
              {tagging ? "..." : "✨ Suggest Tags"}
            </button>
          </div>
          {suggestedTags && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Suggested:</span>
              {suggestedTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    const currentTags = tags.split(",").map(t => t.trim()).filter(Boolean);
                    if (!currentTags.includes(tag)) {
                      setTags(currentTags.length > 0 ? `${tags}, ${tag}` : tag);
                    }
                  }}
                  className="text-xs px-2 py-0.5 rounded-full transition-colors cursor-pointer"
                  style={{ background: "rgba(122,92,255,0.15)", color: "#a78bfa" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(122,92,255,0.3)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(122,92,255,0.15)"}
                >
                  + {tag}
                </button>
              ))}
              <button
                onClick={() => {
                  const currentTags = tags.split(",").map(t => t.trim()).filter(Boolean);
                  const merged = [...new Set([...currentTags, ...suggestedTags])];
                  setTags(merged.join(", "));
                  setSuggestedTags(null);
                }}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80" }}
              >
                Accept all
              </button>
              <button
                onClick={() => setSuggestedTags(null)}
                className="text-xs px-2 py-0.5"
                style={{ color: "var(--text-muted)" }}
              >
                Dismiss
              </button>
            </div>
          )}
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="Source URL (optional)"
            className="w-full px-3 py-2 rounded-xl focus:outline-none focus:ring-2"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--card-border)',
              color: 'var(--foreground)',
            }}
          />
          <div className="flex items-center justify-between">
            <button
              onClick={handleSave}
              className="px-4 py-2 text-white rounded-xl font-semibold hover:opacity-90 transition"
              style={{ background: 'var(--accent)' }}
            >
              Save
            </button>
            <div className="flex items-center gap-4">
              {/* Save status indicator */}
              {saveStatus === "saving" && (
                <span className="text-xs flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#fbbf24" }} />
                  Saving...
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="text-xs flex items-center gap-1.5" style={{ color: "#4ade80" }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "#4ade80" }} />
                  Saved
                </span>
              )}
              {saveStatus === "unsaved" && (
                <span className="text-xs flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--text-muted)" }} />
                  Unsaved changes
                </span>
              )}
              {/* Word count */}
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {wordCount} words · {charCount} chars · {readingTime} min read
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <h1 className="text-2xl font-display font-bold mb-2">{note.title}</h1>
          <div className="flex gap-2 mb-4 flex-wrap">
            {note.tags?.map((tag) => (
              <span key={tag} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: '#a78bfa' }}>
                {tag}
              </span>
            ))}
          </div>
          {note.source_url && (
            <a href={note.source_url} target="_blank" rel="noopener noreferrer"
              className="text-xs mb-3 inline-block hover:underline" style={{ color: 'var(--accent)' }}>
              Source: {note.source_url}
            </a>
          )}
          <div
            className="p-6 rounded-xl prose prose-invert prose-sm max-w-none"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--foreground)' }}
          >
            <ReactMarkdown>{note.content}</ReactMarkdown>
          </div>
          <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
            Created: {new Date(note.created_at).toLocaleString()} · Updated:{" "}
            {new Date(note.updated_at).toLocaleString()}
          </p>

          {/* Mini neighborhood graph */}
          <MiniGraph noteId={noteId} noteTitle={note.title} />
        </div>
      )}

      {showVersions && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-3">Version History</h3>
          {versions.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No versions yet.</p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="p-3 rounded-xl flex items-center justify-between"
                  style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
                >
                  <div>
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>v{v.version_number}</span>
                    <span className="ml-2" style={{ color: 'var(--text-secondary)' }}>{v.title}</span>
                    <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                      {new Date(v.created_at).toLocaleString()}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRestoreVersion(v.id)}
                    className="text-sm font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
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
