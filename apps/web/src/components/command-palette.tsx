"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { listSections, listRecentNotes, listTodos } from "@/lib/api";

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  action: () => void;
  category: "navigation" | "notes" | "sections" | "todos" | "actions";
}

interface CommandPaletteContextType {
  open: () => void;
  close: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextType>({
  open: () => {},
  close: () => {},
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Global Ctrl+K listener
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, close }}>
      {children}
      {isOpen && <CommandPaletteModal onClose={close} />}
    </CommandPaletteContext.Provider>
  );
}

function CommandPaletteModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CommandItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<CommandItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Navigation items (always available)
  const navigationItems: CommandItem[] = [
    { id: "nav-home", label: "Recent Notes", description: "Go to homepage", icon: "📝", action: () => router.push("/"), category: "navigation" },
    { id: "nav-todos", label: "TODOs", description: "Manage your tasks", icon: "✅", action: () => router.push("/todos"), category: "navigation" },
    { id: "nav-search", label: "Search", description: "Semantic search", icon: "🔍", action: () => router.push("/search"), category: "navigation" },
    { id: "nav-chat", label: "Chat", description: "AI-powered Q&A", icon: "💬", action: () => router.push("/chat"), category: "navigation" },
    { id: "nav-wiki", label: "Wiki", description: "Generate wiki from notes", icon: "📖", action: () => router.push("/wiki"), category: "navigation" },
    { id: "nav-graph", label: "Knowledge Graph", description: "Visualize connections", icon: "🕸️", action: () => router.push("/graph"), category: "navigation" },
    { id: "nav-import", label: "Import", description: "Import files", icon: "📥", action: () => router.push("/import"), category: "navigation" },
    { id: "nav-deleted", label: "Deleted Notes", description: "Restore deleted notes", icon: "🗑️", action: () => router.push("/deleted"), category: "navigation" },
    { id: "nav-settings", label: "Settings", description: "LLM configuration", icon: "⚙️", action: () => router.push("/settings"), category: "navigation" },
  ];

  // Load dynamic items
  useEffect(() => {
    const loadItems = async () => {
      setLoading(true);
      try {
        const [notes, sections, todos] = await Promise.all([
          listRecentNotes(50).catch(() => []),
          listSections().catch(() => []),
          listTodos("active").catch(() => []),
        ]);

        const noteItems: CommandItem[] = (notes || []).map((n: Record<string, string>) => ({
          id: `note-${n.id}`,
          label: n.title,
          description: `Note${n.tags?.length ? ` · ${(n.tags as unknown as string[]).join(", ")}` : ""}`,
          icon: "📄",
          action: () => router.push(`/notes/${n.id}`),
          category: "notes" as const,
        }));

        const flattenSections = (secs: Record<string, unknown>[], prefix = ""): CommandItem[] => {
          const result: CommandItem[] = [];
          for (const s of secs) {
            const name = prefix ? `${prefix} / ${s.name}` : s.name as string;
            result.push({
              id: `section-${s.id}`,
              label: name as string,
              description: "Section",
              icon: "📁",
              action: () => router.push(`/sections/${s.slug}`),
              category: "sections" as const,
            });
            if (Array.isArray(s.children) && s.children.length > 0) {
              result.push(...flattenSections(s.children, name));
            }
          }
          return result;
        };

        const sectionItems = flattenSections(sections || []);

        const todoItems: CommandItem[] = (todos || []).map((t: Record<string, string>) => ({
          id: `todo-${t.id}`,
          label: t.title,
          description: t.description || "Todo",
          icon: "☑️",
          action: () => router.push("/todos"),
          category: "todos" as const,
        }));

        setItems([...navigationItems, ...sectionItems, ...noteItems, ...todoItems]);
      } catch {
        setItems(navigationItems);
      }
      setLoading(false);
    };

    loadItems();
    inputRef.current?.focus();
  }, []);

  // Filter items based on query
  useEffect(() => {
    if (!query.trim()) {
      setFilteredItems(items.slice(0, 20));
      setSelectedIndex(0);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const terms = lowerQuery.split(/\s+/);

    const scored = items
      .map((item) => {
        const text = `${item.label} ${item.description || ""} ${item.category}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (text.includes(term)) score += 1;
          if (item.label.toLowerCase().startsWith(term)) score += 2;
          if (item.label.toLowerCase() === term) score += 3;
        }
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ item }) => item);

    setFilteredItems(scored);
    setSelectedIndex(0);
  }, [query, items]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && filteredItems[selectedIndex]) {
        e.preventDefault();
        filteredItems[selectedIndex].action();
        onClose();
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filteredItems, selectedIndex, onClose]
  );

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Group filtered items by category
  const grouped = filteredItems.reduce<Record<string, CommandItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const categoryLabels: Record<string, string> = {
    navigation: "Navigation",
    sections: "Sections",
    notes: "Notes",
    todos: "TODOs",
    actions: "Actions",
  };

  let globalIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in"
        style={{
          background: "#1a1735",
          border: "1px solid rgba(122,92,255,0.2)",
          maxHeight: "60vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <svg className="w-5 h-5 shrink-0" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes, sections, pages…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--foreground)" }}
            autoFocus
          />
          <kbd
            className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: "calc(60vh - 52px)" }}>
          {loading ? (
            <div className="p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Loading…
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No results for &ldquo;{query}&rdquo;
              </p>
            </div>
          ) : (
            Object.entries(grouped).map(([category, categoryItems]) => (
              <div key={category}>
                <div
                  className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  {categoryLabels[category] || category}
                </div>
                {categoryItems.map((item) => {
                  globalIndex++;
                  const idx = globalIndex;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                      style={{
                        background: isSelected ? "rgba(122,92,255,0.15)" : "transparent",
                        color: isSelected ? "var(--foreground)" : "var(--text-secondary)",
                      }}
                      onClick={() => {
                        item.action();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="text-base shrink-0">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block">{item.label}</span>
                        {item.description && (
                          <span className="text-xs truncate block" style={{ color: "var(--text-muted)" }}>
                            {item.description}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <kbd
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                        >
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-4 px-4 py-2 text-[10px]"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
        >
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
