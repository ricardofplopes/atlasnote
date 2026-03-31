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

export function Sidebar() {
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

  const navItems = [
    { href: "/", label: "📋 Recent Notes" },
    { href: "/search", label: "🔍 Search" },
    { href: "/chat", label: "💬 Chat" },
    { href: "/import", label: "📥 Import" },
    { href: "/deleted", label: "🗑️ Deleted" },
  ];

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2.5">
          <img src="/icon.png" alt="" className="w-7 h-7" />
          <h1 className="font-display text-lg font-bold text-indigo-600 tracking-tight">Atlas Note</h1>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block px-3 py-2 rounded-lg text-sm ${
              pathname === item.href
                ? "bg-indigo-50 text-indigo-700 font-medium"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {item.label}
          </Link>
        ))}

        <div className="pt-4 pb-2 px-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Sections
            </span>
            <button
              onClick={() => setShowNew(!showNew)}
              className="text-gray-400 hover:text-indigo-600 text-lg leading-none"
              title="New section"
            >
              +
            </button>
          </div>
        </div>

        {showNew && (
          <div className="px-3 pb-2 flex gap-1">
            <input
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Section name"
              className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="px-2 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
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

      {user && (
        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-2">
            {user.avatar_url && (
              <img
                src={user.avatar_url}
                alt=""
                className="w-7 h-7 rounded-full"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
            </div>
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-red-500"
              title="Logout"
            >
              ↗
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
      <div className="flex items-center">
        {hasChildren && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-5 text-xs text-gray-400"
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
        <Link
          href={`/sections/${section.slug}`}
          className={`flex-1 block px-3 py-1.5 rounded-lg text-sm ${
            isActive
              ? "bg-indigo-50 text-indigo-700 font-medium"
              : "text-gray-600 hover:bg-gray-100"
          }`}
          style={{ paddingLeft: `${(hasChildren ? 0 : 20) + depth * 16}px` }}
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
