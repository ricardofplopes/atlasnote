"use client";

import { useState, useEffect } from "react";
import { getDashboard, generateDigest, getDailyBriefing, createNote, listSections } from "@/lib/api";
import { toggleTodo } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { remarkPlugins, markdownComponents } from "@/lib/markdown-config";
import { useToast } from "@/components/toast";

interface Activity {
  notes_today: number;
  notes_this_week: number;
  notes_this_month: number;
  sections_count: number;
  todos_pending: number;
}

interface RecentNote {
  id: string;
  title: string;
  updated_at: string;
  section_name: string | null;
}

interface PinnedNote {
  id: string;
  title: string;
  section_name: string | null;
}

interface PendingTodo {
  id: string;
  title: string;
  note_id: string | null;
}

interface Reminder {
  id: string;
  title: string;
  due_date: string;
  note_id: string | null;
}

interface DashboardData {
  activity: Activity;
  recent_notes: RecentNote[];
  pinned_notes: PinnedNote[];
  pending_todos: PendingTodo[];
  reminders: Reminder[];
}

interface Section {
  id: string;
  name: string;
  slug: string;
}

export default function HomePage() {
  return <DashboardContent />;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div
      className="p-4 rounded-xl flex items-center gap-3"
      style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
    >
      <span className="text-2xl">{icon}</span>
      <div>
        <div className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>{value}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
      </div>
    </div>
  );
}

function SkeletonCard({ height = "h-24" }: { height?: string }) {
  return <div className={`skeleton ${height} w-full rounded-xl`} />;
}

function DashboardContent() {
  const { user } = useAuth();
  const toast = useToast();

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  // Quick capture state
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureSection, setCaptureSection] = useState("");
  const [capturing, setCapturing] = useState(false);

  // Digest state
  const [digest, setDigest] = useState<string | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);

  // Briefing state
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(true);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingStats, setBriefingStats] = useState<{ notes_yesterday: number; overdue_todos: number; due_today: number } | null>(null);

  const fetchDashboard = async () => {
    try {
      const [data, secs] = await Promise.all([getDashboard(), listSections()]);
      setDashboard(data);
      setSections(secs);
      if (secs.length > 0 && !captureSection) {
        setCaptureSection(secs[0].slug);
      }
    } catch (e) {
      console.error("Failed to load dashboard", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchDashboard();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleQuickCapture = async () => {
    if (!captureTitle.trim() || !captureSection) return;
    setCapturing(true);
    try {
      await createNote(captureSection, { title: captureTitle.trim(), content: "" });
      setCaptureTitle("");
      toast.success("Note created!");
      await fetchDashboard();
    } catch {
      toast.error("Failed to create note");
    } finally {
      setCapturing(false);
    }
  };

  const handleGenerateDigest = async () => {
    setDigestLoading(true);
    setDigestOpen(true);
    try {
      const result = await generateDigest();
      setDigest(result.digest);
    } catch {
      toast.error("Failed to generate digest");
    } finally {
      setDigestLoading(false);
    }
  };

  const handleGenerateBriefing = async () => {
    setBriefingLoading(true);
    setBriefingOpen(true);
    try {
      const result = await getDailyBriefing();
      setBriefing(result.briefing);
      setBriefingStats(result.data || null);
    } catch {
      toast.error("Failed to generate briefing");
    } finally {
      setBriefingLoading(false);
    }
  };

  const handleToggleTodo = async (id: string) => {
    try {
      await toggleTodo(id);
      await fetchDashboard();
    } catch {
      toast.error("Failed to update todo");
    }
  };

  // Not logged in
  if (!loading && !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="text-5xl mb-4">🗺️</div>
          <h1 className="text-3xl font-display font-bold mb-2" style={{ color: "var(--foreground)" }}>
            Atlas Note
          </h1>
          <p className="text-base mb-6" style={{ color: "var(--text-secondary)" }}>
            Sign in to access your knowledge dashboard.
          </p>
          <Link
            href="/login"
            className="inline-block px-6 py-3 rounded-lg font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)" }}
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  // Loading skeleton
  if (loading || !dashboard) {
    return (
      <div className="max-w-6xl space-y-6">
        <SkeletonCard height="h-16" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} height="h-20" />)}
        </div>
        <SkeletonCard height="h-14" />
        <SkeletonCard height="h-12" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SkeletonCard height="h-64" />
          <SkeletonCard height="h-64" />
        </div>
      </div>
    );
  }

  const { activity, recent_notes, pinned_notes, pending_todos, reminders } = dashboard;

  return (
    <div className="max-w-6xl space-y-6">
      {/* Welcome header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold" style={{ color: "var(--foreground)" }}>
          {getGreeting()}, {user?.name?.split(" ")[0] || "there"} 👋
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Here&apos;s what&apos;s happening in your knowledge base.
        </p>
      </div>

      {/* Activity stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon="📝" label="Notes Today" value={activity.notes_today} />
        <StatCard icon="📅" label="This Week" value={activity.notes_this_week} />
        <StatCard icon="📂" label="Sections" value={activity.sections_count} />
        <StatCard icon="☑️" label="Pending Todos" value={activity.todos_pending} />
      </div>

      {/* Quick Capture */}
      <div
        className="p-4 rounded-xl"
        style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
      >
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Quick capture — type a note title..."
            value={captureTitle}
            onChange={(e) => setCaptureTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleQuickCapture(); }}
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--card-border)",
              color: "var(--foreground)",
            }}
          />
          {sections.length > 0 && (
            <select
              value={captureSection}
              onChange={(e) => setCaptureSection(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer"
              style={{
                background: "#1a1735",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#e8e6f0",
              }}
            >
              {sections.map((s) => (
                <option key={s.id} value={s.slug}>{s.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={handleQuickCapture}
            disabled={capturing || !captureTitle.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {capturing ? "..." : "+ Add"}
          </button>
        </div>
      </div>

      {/* AI Daily Briefing */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
      >
        <button
          onClick={() => setBriefingOpen(!briefingOpen)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <span className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>
              Smart Daily Briefing
            </span>
            {briefingStats && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(122,92,255,0.12)", color: "#a78bfa" }}>
                {briefingStats.overdue_todos > 0 ? `${briefingStats.overdue_todos} overdue` : "All clear"}
              </span>
            )}
          </div>
          <span
            className="text-xs transition-transform"
            style={{ color: "var(--text-muted)", transform: briefingOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            ▼
          </span>
        </button>
        {briefingOpen && (
          <div className="px-4 pb-4">
            {!briefing && !briefingLoading && (
              <button
                onClick={handleGenerateBriefing}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                Generate Briefing
              </button>
            )}
            {briefingLoading && (
              <div className="flex items-center gap-2 py-4">
                <span className="inline-block w-4 h-4 rounded-full animate-spin" style={{ border: "2px solid var(--card-border)", borderTopColor: "var(--accent)" }} />
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>Preparing your briefing…</span>
              </div>
            )}
            {briefing && !briefingLoading && (
              <div>
                <div className="prose prose-sm max-w-none text-sm" style={{ color: "var(--text-secondary)" }}>
                  <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                    {briefing}
                  </ReactMarkdown>
                </div>
                <button
                  onClick={handleGenerateBriefing}
                  className="mt-3 text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
                  style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
                >
                  ↻ Refresh
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI Weekly Digest */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
      >
        <button
          onClick={() => setDigestOpen(!digestOpen)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">✨</span>
            <span className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>
              AI Weekly Digest
            </span>
          </div>
          <span
            className="text-xs transition-transform"
            style={{
              color: "var(--text-muted)",
              transform: digestOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ▼
          </span>
        </button>
        {digestOpen && (
          <div className="px-4 pb-4">
            {!digest && !digestLoading && (
              <button
                onClick={handleGenerateDigest}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                Generate Digest
              </button>
            )}
            {digestLoading && (
              <div className="flex items-center gap-2 py-4">
                <span className="inline-block w-4 h-4 rounded-full animate-spin" style={{ border: "2px solid var(--card-border)", borderTopColor: "var(--accent)" }} />
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>Generating your digest…</span>
              </div>
            )}
            {digest && !digestLoading && (
              <div>
                <div className="prose prose-sm max-w-none text-sm" style={{ color: "var(--text-secondary)" }}>
                  <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                    {digest}
                  </ReactMarkdown>
                </div>
                <button
                  onClick={handleGenerateDigest}
                  className="mt-3 text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
                  style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
                >
                  ↻ Refresh
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Recent Notes */}
        <div
          className="rounded-xl p-4"
          style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
        >
          <h2 className="font-display font-bold text-base mb-3" style={{ color: "var(--foreground)" }}>
            📄 Recent Notes
          </h2>
          {recent_notes.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>
              No notes yet. Use quick capture above to get started!
            </p>
          ) : (
            <div className="space-y-1">
              {recent_notes.slice(0, 8).map((note) => (
                <Link
                  key={note.id}
                  href={`/notes/${note.id}`}
                  className="flex items-center justify-between p-2.5 rounded-lg transition-colors hover-subtle"
                  style={{ color: "var(--foreground)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span className="text-sm truncate mr-2">{note.title || "Untitled"}</span>
                  <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                    {note.section_name || "—"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Pinned + Todos + Reminders */}
        <div className="space-y-6">
          {/* Pinned Notes */}
          {pinned_notes.length > 0 && (
            <div
              className="rounded-xl p-4"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
            >
              <h2 className="font-display font-bold text-base mb-3" style={{ color: "var(--foreground)" }}>
                📌 Pinned Notes
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {pinned_notes.map((note) => (
                  <Link
                    key={note.id}
                    href={`/notes/${note.id}`}
                    className="p-3 rounded-lg text-sm transition-colors"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--card-border)",
                      color: "var(--foreground)",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--card-border)")}
                  >
                    <div className="truncate font-medium">{note.title || "Untitled"}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {note.section_name || "—"}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Pending Todos */}
          <div
            className="rounded-xl p-4"
            style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
          >
            <h2 className="font-display font-bold text-base mb-3" style={{ color: "var(--foreground)" }}>
              ☑️ Pending Todos
            </h2>
            {pending_todos.length === 0 ? (
              <p className="text-sm py-2" style={{ color: "var(--text-muted)" }}>All clear! 🎉</p>
            ) : (
              <div className="space-y-1">
                {pending_todos.slice(0, 5).map((todo) => (
                  <div
                    key={todo.id}
                    className="flex items-center gap-2 p-2 rounded-lg"
                  >
                    <button
                      onClick={() => handleToggleTodo(todo.id)}
                      className="w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors hover:opacity-80"
                      style={{ borderColor: "var(--text-muted)" }}
                      title="Mark as done"
                    />
                    <span className="text-sm truncate" style={{ color: "var(--text-secondary)" }}>
                      {todo.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {pending_todos.length > 5 && (
              <Link
                href="/todos"
                className="block text-xs mt-2 font-medium"
                style={{ color: "var(--accent)" }}
              >
                View all {pending_todos.length} todos →
              </Link>
            )}
          </div>

          {/* Upcoming Reminders */}
          {reminders.length > 0 && (
            <div
              className="rounded-xl p-4"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
            >
              <h2 className="font-display font-bold text-base mb-3" style={{ color: "var(--foreground)" }}>
                🔔 Upcoming Reminders
              </h2>
              <div className="space-y-1">
                {reminders.map((rem) => (
                  <div key={rem.id} className="flex items-center justify-between p-2 rounded-lg">
                    <span className="text-sm truncate mr-2" style={{ color: "var(--text-secondary)" }}>
                      {rem.title}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                      {new Date(rem.due_date).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
