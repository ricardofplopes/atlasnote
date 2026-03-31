"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { listSections, createSection } from "@/lib/api";

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

const navItems = [
  { href: "/", label: "Recent Notes", Icon: IconRecentNotes },
  { href: "/search", label: "Search", Icon: IconSearch },
  { href: "/chat", label: "Chat", Icon: IconChat },
  { href: "/wiki", label: "Wiki", Icon: IconWiki },
  { href: "/graph", label: "Graph", Icon: IconGraph },
  { href: "/import", label: "Import", Icon: IconImport },
  { href: "/deleted", label: "Deleted", Icon: IconDeleted },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export function Sidebar({ onClose, width }: { onClose?: () => void; width?: number }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [sections, setSections] = useState<Section[]>([]);
  const [newSection, setNewSection] = useState("");
  const [showNew, setShowNew] = useState(false);

  const loadSections = () => {
    listSections().then(setSections).catch(console.error);
  };

  useEffect(() => {
    if (user) loadSections();
  }, [user]);

  const handleCreate = async () => {
    if (!newSection.trim()) return;
    await createSection({ name: newSection });
    setNewSection("");
    setShowNew(false);
    loadSections();
  };

  return (
    <aside
      className="flex flex-col h-full border-r overflow-hidden"
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
        {onClose && (
          <button onClick={onClose} className="lg:hidden p-1 rounded" style={{ color: 'var(--text-muted)' }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150"
              style={{
                background: isActive ? 'var(--accent-soft)' : 'transparent',
                color: isActive ? '#a78bfa' : 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
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
              className="w-5 h-5 flex items-center justify-center rounded-md text-sm leading-none transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-soft)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
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
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
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
          className="flex-1 block px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors truncate"
          style={{
            background: isActive ? 'var(--accent-soft)' : 'transparent',
            color: isActive ? '#a78bfa' : 'var(--text-secondary)',
          }}
          onMouseEnter={(e) => {
            if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
          }}
          onMouseLeave={(e) => {
            if (!isActive) e.currentTarget.style.background = isActive ? 'var(--accent-soft)' : 'transparent';
          }}
        >
          {section.name}
        </Link>
      </div>
      {expanded &&
        hasChildren &&
        section.children.map((child) => (
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
