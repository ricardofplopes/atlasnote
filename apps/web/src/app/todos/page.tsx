"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { listTodos, createTodo, updateTodo, deleteTodo, toggleTodo, dismissTodo } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";

interface Todo {
  id: string;
  title: string;
  description: string | null;
  is_done: boolean;
  is_suggested: boolean;
  note_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export default function TodosPage() {
  return <TodosContent />;
}

function TodosContent() {
  const { user } = useAuth();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState("all");
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const loadTodos = async () => {
    try {
      const data = await listTodos(filter);
      setTodos(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadTodos();
  }, [user, filter]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      await createTodo({ title: newTitle.trim() });
      setNewTitle("");
      inputRef.current?.focus();
      toastSuccess("Todo added");
      await loadTodos();
    } catch (e) {
      toastError("Failed to add todo");
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await toggleTodo(id);
      await loadTodos();
    } catch (e) {
      toastError("Failed to toggle todo");
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Delete todo",
      message: "This todo will be permanently deleted.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteTodo(id);
      toastSuccess("Todo deleted");
      await loadTodos();
    } catch (e) {
      toastError("Failed to delete todo");
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await dismissTodo(id);
      toastSuccess("Suggestion dismissed");
      await loadTodos();
    } catch (e) {
      toastError("Failed to dismiss suggestion");
    }
  };

  const handleUpdate = async (id: string, data: { title?: string; description?: string }) => {
    try {
      await updateTodo(id, data);
      toastSuccess("Todo updated");
      await loadTodos();
    } catch (e) {
      toastError("Failed to update todo");
    }
  };

  const filters = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "done", label: "Done" },
    { key: "suggested", label: "Suggested" },
  ];

  const activeTodos = todos.filter(t => !t.is_done);
  const doneTodos = todos.filter(t => t.is_done);

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-display font-bold mb-6">TODOs</h2>

      {/* Quick add */}
      <div
        className="flex gap-2 mb-6 p-4 rounded-xl"
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
        }}
      >
        <input
          ref={inputRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="Add a new todo..."
          className="flex-1 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 text-sm"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid var(--card-border)",
            color: "var(--foreground)",
            ["--tw-ring-color" as string]: "var(--accent)",
          }}
        />
        <button
          onClick={handleCreate}
          disabled={!newTitle.trim()}
          className="px-5 py-2.5 text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 transition"
          style={{ background: "var(--accent)" }}
        >
          Add
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all"
            style={{
              background: filter === f.key ? "var(--accent-soft)" : "rgba(255,255,255,0.04)",
              color: filter === f.key ? "#a78bfa" : "var(--text-secondary)",
              border: filter === f.key ? "1px solid rgba(122,92,255,0.3)" : "1px solid transparent",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Todo list */}
      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : todos.length === 0 ? (
        <div className="text-center py-12">
          <p style={{ color: "var(--text-muted)" }}>
            {filter === "all"
              ? "No todos yet. Add one above!"
              : `No ${filter} todos.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {todos.map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onDismiss={handleDismiss}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}

      {/* Summary */}
      {!loading && todos.length > 0 && (
        <div className="mt-6 text-xs" style={{ color: "var(--text-muted)" }}>
          {activeTodos.length} active · {doneTodos.length} completed
        </div>
      )}
    </div>
  );
}

function TodoItem({
  todo,
  onToggle,
  onDelete,
  onDismiss,
  onUpdate,
}: {
  todo: Todo;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onDismiss: (id: string) => void;
  onUpdate: (id: string, data: { title?: string; description?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [editDesc, setEditDesc] = useState(todo.description || "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = () => {
    if (!editTitle.trim()) return;
    onUpdate(todo.id, {
      title: editTitle.trim(),
      description: editDesc.trim() || undefined,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(todo.title);
    setEditDesc(todo.description || "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="p-4 rounded-xl space-y-2"
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--accent)",
        }}
      >
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid var(--card-border)",
            color: "var(--foreground)",
            ["--tw-ring-color" as string]: "var(--accent)",
          }}
          autoFocus
        />
        <input
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          placeholder="Description (optional)"
          className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid var(--card-border)",
            color: "var(--text-secondary)",
            ["--tw-ring-color" as string]: "var(--accent)",
          }}
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white"
            style={{ background: "var(--accent)" }}
          >
            Save
          </button>
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl group transition-all"
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
      }}
    >
      {/* Checkbox */}
      <button
        onClick={() => onToggle(todo.id)}
        className="mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
        style={{
          borderColor: todo.is_done ? "var(--accent)" : "var(--card-border)",
          background: todo.is_done ? "var(--accent)" : "transparent",
        }}
      >
        {todo.is_done && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M2.5 6l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={`text-sm font-medium ${todo.is_done ? "line-through" : ""}`}
            style={{ color: todo.is_done ? "var(--text-muted)" : "var(--foreground)" }}
          >
            {todo.title}
          </p>
          {todo.is_suggested && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "var(--accent-soft)", color: "#a78bfa" }}
            >
              ✨ Suggested
            </span>
          )}
        </div>
        {todo.description && (
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {todo.description}
          </p>
        )}
        {todo.note_id && (
          <a
            href={`/notes/${todo.note_id}`}
            className="inline-flex items-center gap-1 text-[10px] mt-1.5 hover:underline"
            style={{ color: "var(--accent)" }}
          >
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M5 1H3a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2V7" strokeLinecap="round" />
              <path d="M7 1h4v4M11 1L5.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Source note
          </a>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {todo.is_suggested && !todo.is_done && (
          <button
            onClick={() => onDismiss(todo.id)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.background = "rgba(248,113,113,0.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
            title="Dismiss suggestion"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button
          onClick={() => setEditing(true)}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--accent-soft)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
          title="Edit"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M11.5 2.5l2 2M2 11l-0.5 3.5L5 14l8.5-8.5-2-2L3 12z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {confirmDelete ? (
          <button
            onClick={() => { onDelete(todo.id); setConfirmDelete(false); }}
            className="px-2 py-1 text-[10px] font-semibold rounded-lg"
            style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}
          >
            Confirm
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.background = "rgba(248,113,113,0.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
            title="Delete"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M4 4h8l-.6 8a1.5 1.5 0 01-1.5 1.4H6.1a1.5 1.5 0 01-1.5-1.4L4 4z" />
              <path d="M2.5 4h11M6 2h4" strokeLinecap="round" />
              <path d="M6.5 6.5v4M9.5 6.5v4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
