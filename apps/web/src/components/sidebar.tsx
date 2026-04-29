"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useCommandPalette } from "@/components/command-palette";
import { useEffect, useState, useRef } from "react";
import { listSections, createSection, getReminderCount, listReminders, dismissReminder, convertReminderToTodo } from "@/lib/api";

interface Section {
  id: string;
  name: string;
  slug: string;
  is_archived: boolean;
  children: Section[];
}

// SVG icons matching the logo's purple gradient style
function IconRecentNotes({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <rect x="3" y="3" width="14" height="14" rx="2.5" />
      <path d="M7 7h6M7 10h4M7 13h5" strokeLinecap="round" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <circle cx="9" cy="9" r="5" />
      <path d="M13 13l3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

function IconChat({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <path d="M4 5a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H8l-3 2.5V13H4a1 1 0 01-1-1V5z" />
      <path d="M7 7h6M7 10h3" strokeLinecap="round" />
    </svg>
  );
}

function IconImport({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <path d="M10 3v9M7 9l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 13v2a2 2 0 002 2h8a2 2 0 002-2v-2" strokeLinecap="round" />
    </svg>
  );
}

function IconDeleted({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <path d="M5 5h10l-.8 10a2 2 0 01-2 1.8H7.8a2 2 0 01-2-1.8L5 5z" />
      <path d="M3.5 5h13M8 3h4" strokeLinecap="round" />
      <path d="M8.5 8v5M11.5 8v5" strokeLinecap="round" />
    </svg>
  );
}

function IconGraph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <circle cx="10" cy="10" r="2.5" />
      <circle cx="4" cy="5" r="1.5" />
      <circle cx="16" cy="5" r="1.5" />
      <circle cx="5" cy="16" r="1.5" />
      <circle cx="16" cy="14" r="1.5" />
      <path d="M8 8.5L5.5 6M12 8.5l2.5-2.5M8.5 12l-2 2.5M12.5 11l2 2" strokeLinecap="round" />
    </svg>
  );
}

function IconWiki({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <path d="M4 3h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path d="M7 3v14" />
      <path d="M10 7h4M10 10h4M10 13h3" strokeLinecap="round" />
    </svg>
  );
}

function IconSettings({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconTodos({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <rect x="3" y="3" width="14" height="14" rx="2.5" />
      <path d="M7 7.5l1.5 1.5L11.5 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 13h6" strokeLinecap="round" />
      <path d="M7 10.5h4" strokeLinecap="round" />
    </svg>
  );
}

function IconWorkflows({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" strokeWidth={1.5} stroke="currentColor">
      <circle cx="10" cy="4.5" r="2" />
      <circle cx="5" cy="15" r="2" />
      <circle cx="15" cy="15" r="2" />
      <path d="M10 6.5v3M8.5 11l-2 2.5M11.5 11l2 2.5" strokeLinecap="round" />
      <circle cx="10" cy="10.5" r="1.5" />
    </svg>
  );
}

const navItems = [
  { href: "/", label: "Dashboard", Icon: IconRecentNotes },
  { href: "/todos", label: "TODOs", Icon: IconTodos },
  { href: "/search", label: "Search", Icon: IconSearch },
  { href: "/chat", label: "Chat", Icon: IconChat },
  { href: "/wiki", label: "Wiki", Icon: IconWiki },
  { href: "/workflows", label: "Workflows", Icon: IconWorkflows },
  { href: "/graph", label: "Graph", Icon: IconGraph },
  { href: "/import", label: "Import", Icon: IconImport },
  { href: "/deleted", label: "Deleted", Icon: IconDeleted },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export function Sidebar({ onClose, width }: { onClose?: () => void; width?: number }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const { open: openCommandPalette } = useCommandPalette();
  const [sections, setSections] = useState<Section[]>([]);
  const [newSection, setNewSection] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [reminderCount, setReminderCount] = useState(0);
  const [showReminders, setShowReminders] = useState(false);
  const [reminders, setReminders] = useState<{
    id: string; title: string; due_date: string; note_id?: string;
    note_title?: string; is_dismissed: boolean; source_text?: string;
  }[]>([]);
  const [loadingReminders, setLoadingReminders] = useState(false);
  const reminderRef = useRef<HTMLDivElement>(null);

  const loadSections = () => {
    listSections().then(setSections).catch(console.error);
  };

  useEffect(() => {
    if (user) loadSections();
  }, [user]);

  useEffect(() => {
    if (user) {
      getReminderCount().then((r) => setReminderCount(r?.count || 0)).catch(() => {});
    }
  }, [user]);

  // Close reminders panel when clicking outside
  useEffect(() => {
    if (!showReminders) return;
    const handleClick = (e: MouseEvent) => {
      if (reminderRef.current && !reminderRef.current.contains(e.target as Node)) {
        setShowReminders(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showReminders]);

  const openReminders = async () => {
    setShowReminders(!showReminders);
    if (!showReminders) {
      setLoadingReminders(true);
      try {
        const data = await listReminders();
        setReminders((data || []).filter((r: { is_dismissed: boolean }) => !r.is_dismissed));
      } catch {
        setReminders([]);
      } finally {
        setLoadingReminders(false);
      }
    }
  };

  const handleDismissReminder = async (id: string) => {
    try {
      await dismissReminder(id);
      setReminders((prev) => prev.filter((r) => r.id !== id));
      setReminderCount((prev) => Math.max(0, prev - 1));
    } catch {}
  };

  const handleConvertToTodo = async (id: string) => {
    try {
      await convertReminderToTodo(id);
      setReminders((prev) => prev.filter((r) => r.id !== id));
      setReminderCount((prev) => Math.max(0, prev - 1));
    } catch {}
  };

  const formatDueDate = (dateStr: string) => {
    const due = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays <= 7) return `In ${diffDays} days`;
    return due.toLocaleDateString();
  };

  useEffect(() => {
    const handleRefresh = () => loadSections();
    window.addEventListener("sections:refresh", handleRefresh);
    return () => window.removeEventListener("sections:refresh", handleRefresh);
  }, []);

  const handleCreate= async () => {
    if (!newSection.trim()) return;
    await createSection({ name: newSection });
    setNewSection("");
    setShowNew(false);
    loadSections();
  };

  return (
    <aside
      className="flex flex-col h-full border-r"
      style={{
        width: width || 260,
        minWidth: width || 260,
        background: 'var(--sidebar-bg)',
        borderColor: 'var(--card-border)',
      }}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--card-border)' }}>
        <div className="flex items-center gap-2.5">
          <img src="/icon.png" alt="" className="w-7 h-7" />
          <h1 className="font-display text-lg font-bold tracking-tight" style={{ color: 'var(--accent)' }}>
            Atlas Note
          </h1>
        </div>
        <div className="flex items-center gap-1">
          {/* Reminders bell */}
          <div className="relative" ref={reminderRef}>
            <button
              onClick={openReminders}
              className="p-1.5 rounded-lg relative transition-colors"
              style={{ color: reminderCount > 0 ? '#a78bfa' : 'var(--text-muted)' }}
              title="Reminders"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
              {reminderCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  {reminderCount > 99 ? '99+' : reminderCount}
                </span>
              )}
            </button>
            {showReminders && (
              <div
                className="absolute right-0 top-full mt-1 z-[9999] w-72 rounded-xl shadow-2xl overflow-hidden"
                style={{ background: "#1a1735", border: "1px solid rgba(122,92,255,0.2)" }}
              >
                <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  Reminders
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {loadingReminders ? (
                    <div className="p-4 text-center text-xs" style={{ color: "var(--text-muted)" }}>Loading…</div>
                  ) : reminders.length === 0 ? (
                    <div className="p-4 text-center text-xs" style={{ color: "var(--text-muted)" }}>No active reminders</div>
                  ) : (
                    reminders.map((r) => (
                      <div
                        key={r.id}
                        className="px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
                        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                      >
                        <div className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{r.title}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                            background: formatDueDate(r.due_date) === "Today" || formatDueDate(r.due_date).includes("overdue")
                              ? "rgba(248,113,113,0.15)" : "rgba(122,92,255,0.12)",
                            color: formatDueDate(r.due_date) === "Today" || formatDueDate(r.due_date).includes("overdue")
                              ? "#f87171" : "#a78bfa",
                          }}>
                            {formatDueDate(r.due_date)}
                          </span>
                          {r.note_id && (
                            <Link
                              href={`/notes/${r.note_id}`}
                              className="text-[10px] truncate hover:underline"
                              style={{ color: "var(--accent)" }}
                              onClick={() => setShowReminders(false)}
                            >
                              {r.note_title || "View note"}
                            </Link>
                          )}
                        </div>
                        <div className="flex gap-1.5 mt-1.5">
                          <button
                            onClick={() => handleDismissReminder(r.id)}
                            className="text-[10px] px-2 py-0.5 rounded-md"
                            style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.06)" }}
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => handleConvertToTodo(r.id)}
                            className="text-[10px] px-2 py-0.5 rounded-md"
                            style={{ color: "#a78bfa", background: "rgba(122,92,255,0.12)" }}
                          >
                            → Todo
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          {onClose && (
            <button onClick={onClose} className="p-1 rounded" style={{ color: 'var(--text-muted)' }} title="Collapse sidebar">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Quick search trigger */}
      <div className="px-3 pt-3">
        <button
          onClick={openCommandPalette}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--card-border)',
            color: 'var(--text-muted)',
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <span className="flex-1 text-left">Quick search…</span>
          <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
            Ctrl+K
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150 ${!isActive ? 'hover-subtle' : ''}`}
              style={{
                background: isActive ? 'var(--accent-soft)' : 'transparent',
                color: isActive ? '#a78bfa' : 'var(--text-secondary)',
              }}
            >
              <item.Icon className="w-[18px] h-[18px] shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}

        {/* Sections header */}
        <div className="pt-5 pb-2 px-3">
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-bold uppercase tracking-[0.15em]"
              style={{ color: 'var(--text-muted)' }}
            >
              Sections
            </span>
            <button
              onClick={() => setShowNew(!showNew)}
              className="w-5 h-5 flex items-center justify-center rounded-md text-sm leading-none hover-accent"
              style={{ color: 'var(--text-muted)' }}
              title="New section"
            >
              +
            </button>
          </div>
        </div>

        {showNew && (
          <div className="px-2 pb-2 flex gap-1.5">
            <input
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Section name"
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border-0 focus:outline-none focus:ring-1"
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: 'var(--foreground)',
                boxShadow: 'none',
              }}
              onFocus={(e) => e.currentTarget.style.boxShadow = '0 0 0 1px var(--accent)'}
              onBlur={(e) => e.currentTarget.style.boxShadow = 'none'}
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-white shrink-0"
              style={{ background: 'var(--accent)' }}
            >
              Add
            </button>
          </div>
        )}

        {sections
          .filter((s) => !s.is_archived)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((section) => (
            <SectionItem
              key={section.id}
              section={section}
              pathname={pathname}
              depth={0}
            />
          ))}
      </nav>

      {/* User footer */}
      {user && (
        <div className="p-3" style={{ borderTop: '1px solid var(--card-border)' }}>
          <div className="flex items-center gap-2.5 px-1">
            {user.avatar_url && (
              <img
                src={user.avatar_url}
                alt=""
                className="w-8 h-8 rounded-full"
                style={{ outline: '1px solid var(--card-border)', outlineOffset: '1px', borderRadius: '9999px' }}
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                {user.name}
              </p>
            </div>
            <button
              onClick={logout}
              className="p-1.5 rounded-lg hover-danger"
              style={{ color: 'var(--text-muted)' }}
              title="Logout"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function SectionItem({
  section,
  pathname,
  depth,
}: {
  section: Section;
  pathname: string;
  depth: number;
}) {
  const isActive = pathname === `/sections/${section.slug}`;
  const [expanded, setExpanded] = useState(true);
  const hasChildren = section.children && section.children.length > 0;

  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: `${depth * 12}px` }}>
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-5 shrink-0 text-xs text-center"
            style={{ color: 'var(--text-muted)' }}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Link
          href={`/sections/${section.slug}`}
          className={`flex-1 block px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors truncate ${!isActive ? 'hover-subtle' : ''}`}
          style={{
            background: isActive ? 'var(--accent-soft)' : 'transparent',
            color: isActive ? '#a78bfa' : 'var(--text-secondary)',
          }}
        >
          {section.name}
        </Link>
      </div>
      {expanded &&
        hasChildren &&
        [...section.children].sort((a, b) => a.name.localeCompare(b.name)).map((child) => (
          <SectionItem
            key={child.id}
            section={child}
            pathname={pathname}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}
