"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  seedWorkflows,
  runWorkflowUrl,
  listSections,
  searchNoteTitles,
} from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import ReactMarkdown from "react-markdown";
import { remarkPlugins, markdownComponents } from "@/lib/markdown-config";

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  prompt_template: string;
  context_mode: string;
  icon: string | null;
  position: number;
}

interface Section {
  id: string;
  name: string;
  slug: string;
  children: Section[];
}

interface NoteResult {
  id: string;
  title: string;
}

const CONTEXT_MODES = [
  { value: "current_note", label: "Current Note" },
  { value: "section_notes", label: "Section Notes" },
  { value: "all_notes", label: "All Notes" },
  { value: "none", label: "None" },
];

export default function WorkflowsPage() {
  return <WorkflowsContent />;
}

function WorkflowsContent() {
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const loadWorkflows = async () => {
    try {
      const data = await listWorkflows();
      setWorkflows(data);
    } catch {
      console.error("Failed to load workflows");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadWorkflows();
  }, [user]);

  const handleSeed = async () => {
    try {
      await seedWorkflows();
      toastSuccess("Starter workflows created");
      await loadWorkflows();
    } catch {
      toastError("Failed to seed workflows");
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Delete workflow",
      message: "This workflow will be permanently deleted.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteWorkflow(id);
      toastSuccess("Workflow deleted");
      if (runningId === id) setRunningId(null);
      if (editingId === id) { setEditingId(null); setShowForm(false); }
      await loadWorkflows();
    } catch {
      toastError("Failed to delete workflow");
    }
  };

  const handleSave = async (data: {
    name: string;
    description?: string;
    prompt_template: string;
    context_mode: string;
    icon?: string;
  }) => {
    try {
      if (editingId) {
        await updateWorkflow(editingId, data);
        toastSuccess("Workflow updated");
      } else {
        await createWorkflow(data);
        toastSuccess("Workflow created");
      }
      setShowForm(false);
      setEditingId(null);
      await loadWorkflows();
    } catch {
      toastError("Failed to save workflow");
    }
  };

  const startEdit = (wf: Workflow) => {
    setEditingId(wf.id);
    setShowForm(true);
    setRunningId(null);
  };

  const startAdd = () => {
    setEditingId(null);
    setShowForm(true);
    setRunningId(null);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const editingWorkflow = editingId ? workflows.find((w) => w.id === editingId) : null;

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display font-bold">AI Workflows</h2>
        <div className="flex gap-2">
          {workflows.length === 0 && !loading && (
            <button
              onClick={handleSeed}
              className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
              style={{
                background: "rgba(255,255,255,0.04)",
                color: "var(--text-secondary)",
                border: "1px solid var(--card-border)",
              }}
            >
              ✨ Seed Starters
            </button>
          )}
          <button
            onClick={startAdd}
            className="px-4 py-2 text-sm font-semibold rounded-lg text-white transition hover:opacity-90"
            style={{ background: "var(--accent)" }}
          >
            + Add Workflow
          </button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <WorkflowForm
          workflow={editingWorkflow || undefined}
          onSave={handleSave}
          onCancel={cancelForm}
        />
      )}

      {/* Workflow list */}
      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : workflows.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-4">⚡</div>
          <p className="text-base font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            No workflows yet
          </p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Create a custom AI workflow or seed starter templates to get going.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
            <div key={wf.id}>
              <WorkflowCard
                workflow={wf}
                onEdit={() => startEdit(wf)}
                onDelete={() => handleDelete(wf.id)}
                onRun={() => setRunningId(runningId === wf.id ? null : wf.id)}
                isRunning={runningId === wf.id}
              />
              {runningId === wf.id && (
                <RunPanel workflow={wf} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Workflow Card ── */

function WorkflowCard({
  workflow,
  onEdit,
  onDelete,
  onRun,
  isRunning,
}: {
  workflow: Workflow;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const modeLabel = CONTEXT_MODES.find((m) => m.value === workflow.context_mode)?.label || workflow.context_mode;

  return (
    <div
      className="flex items-start gap-4 p-4 rounded-xl group transition-all"
      style={{
        background: "var(--card-bg)",
        border: isRunning ? "1px solid var(--accent)" : "1px solid var(--card-border)",
      }}
    >
      {/* Icon */}
      <span className="text-2xl shrink-0 mt-0.5">{workflow.icon || "⚡"}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            {workflow.name}
          </h3>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: "var(--accent-soft)", color: "#a78bfa" }}
          >
            {modeLabel}
          </span>
        </div>
        {workflow.description && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {workflow.description}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onRun}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg transition hover:opacity-90"
          style={{
            background: isRunning ? "rgba(255,255,255,0.08)" : "var(--accent)",
            color: isRunning ? "var(--accent)" : "white",
          }}
        >
          {isRunning ? "Close" : "▶ Run"}
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover-accent"
          style={{ color: "var(--text-muted)" }}
          title="Edit"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M11.5 2.5l2 2M2 11l-0.5 3.5L5 14l8.5-8.5-2-2L3 12z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg hover-danger"
          style={{ color: "var(--text-muted)" }}
          title="Delete"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M4 4h8l-.6 8a1.5 1.5 0 01-1.5 1.4H6.1a1.5 1.5 0 01-1.5-1.4L4 4z" />
            <path d="M2.5 4h11M6 2h4" strokeLinecap="round" />
            <path d="M6.5 6.5v4M9.5 6.5v4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ── Workflow Form ── */

function WorkflowForm({
  workflow,
  onSave,
  onCancel,
}: {
  workflow?: Workflow;
  onSave: (data: {
    name: string;
    description?: string;
    prompt_template: string;
    context_mode: string;
    icon?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(workflow?.name || "");
  const [icon, setIcon] = useState(workflow?.icon || "");
  const [description, setDescription] = useState(workflow?.description || "");
  const [promptTemplate, setPromptTemplate] = useState(workflow?.prompt_template || "");
  const [contextMode, setContextMode] = useState(workflow?.context_mode || "current_note");

  const handleSubmit = () => {
    if (!name.trim() || !promptTemplate.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      prompt_template: promptTemplate,
      context_mode: contextMode,
      icon: icon.trim() || undefined,
    });
  };

  const inputStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid var(--card-border)",
    color: "var(--foreground)",
  };

  return (
    <div
      className="p-5 rounded-xl mb-6 space-y-4"
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--accent)",
      }}
    >
      <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
        {workflow ? "Edit Workflow" : "New Workflow"}
      </h3>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summarize Notes"
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
            style={{ ...inputStyle, ["--tw-ring-color" as string]: "var(--accent)" }}
          />
        </div>
        <div className="w-20">
          <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Icon</label>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="⚡"
            className="w-full px-3 py-2 rounded-lg text-sm text-center focus:outline-none focus:ring-2"
            style={{ ...inputStyle, ["--tw-ring-color" as string]: "var(--accent)" }}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of what this workflow does"
          rows={2}
          className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 resize-none"
          style={{ ...inputStyle, ["--tw-ring-color" as string]: "var(--accent)" }}
        />
      </div>

      <div>
        <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Prompt Template</label>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          placeholder={"Use {{context}}, {{title}}, {{content}} as variables.\ne.g. Summarize the following note:\n\nTitle: {{title}}\nContent: {{content}}"}
          rows={6}
          className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 resize-none"
          style={{
            ...inputStyle,
            fontFamily: "monospace",
            ["--tw-ring-color" as string]: "var(--accent)",
          }}
        />
        <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
          Available variables: <code style={{ color: "var(--accent)" }}>{"{{context}}"}</code>,{" "}
          <code style={{ color: "var(--accent)" }}>{"{{title}}"}</code>,{" "}
          <code style={{ color: "var(--accent)" }}>{"{{content}}"}</code>
        </p>
      </div>

      <div>
        <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Context Mode</label>
        <select
          value={contextMode}
          onChange={(e) => setContextMode(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
          style={{
            background: "#1a1735",
            color: "#e8e6f0",
            border: "1px solid var(--card-border)",
            ["--tw-ring-color" as string]: "var(--accent)",
          }}
        >
          {CONTEXT_MODES.map((m) => (
            <option key={m.value} value={m.value} style={{ background: "#1a1735", color: "#e8e6f0" }}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !promptTemplate.trim()}
          className="px-5 py-2 text-sm font-semibold rounded-lg text-white hover:opacity-90 disabled:opacity-40 transition"
          style={{ background: "var(--accent)" }}
        >
          {workflow ? "Update" : "Create"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Run Panel ── */

function RunPanel({ workflow }: { workflow: Workflow }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [noteQuery, setNoteQuery] = useState("");
  const [noteResults, setNoteResults] = useState<NoteResult[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [executing, setExecuting] = useState(false);
  const [output, setOutput] = useState("");
  const [showNoteDropdown, setShowNoteDropdown] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { error: toastError } = useToast();

  useEffect(() => {
    if (workflow.context_mode === "section_notes") {
      listSections().then(setSections).catch(() => {});
    }
  }, [workflow.context_mode]);

  useEffect(() => {
    outputRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const handleNoteSearch = (query: string) => {
    setNoteQuery(query);
    setSelectedNoteId("");
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setNoteResults([]);
      setShowNoteDropdown(false);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchNoteTitles(query);
        setNoteResults(results);
        setShowNoteDropdown(true);
      } catch {
        setNoteResults([]);
      }
    }, 300);
  };

  const selectNote = (note: NoteResult) => {
    setNoteQuery(note.title);
    setSelectedNoteId(note.id);
    setShowNoteDropdown(false);
  };

  const flatSections = (secs: Section[], depth = 0): { slug: string; name: string; depth: number }[] => {
    const result: { slug: string; name: string; depth: number }[] = [];
    for (const s of secs) {
      result.push({ slug: s.slug, name: s.name, depth });
      if (s.children) result.push(...flatSections(s.children, depth + 1));
    }
    return result;
  };

  const handleExecute = async () => {
    if (executing) return;
    if (workflow.context_mode === "current_note" && !selectedNoteId) {
      toastError("Please select a note first");
      return;
    }
    if (workflow.context_mode === "section_notes" && !selectedSection) {
      toastError("Please select a section first");
      return;
    }

    setExecuting(true);
    setOutput("");

    try {
      const { url, token } = runWorkflowUrl(workflow.id);
      const body: Record<string, string> = {};
      if (selectedNoteId) body.note_id = selectedNoteId;
      if (selectedSection) body.section_slug = selectedSection;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;

          try {
            const event = JSON.parse(payload);
            if (event.type === "content") {
              accumulated += event.text;
              setOutput(accumulated);
            } else if (event.type === "error") {
              accumulated += `\n\n**Error:** ${event.text}`;
              setOutput(accumulated);
            }
          } catch {
            // non-JSON SSE line, ignore
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Execution failed";
      toastError(msg);
      setOutput((prev) => prev + `\n\n**Error:** ${msg}`);
    } finally {
      setExecuting(false);
    }
  };

  const needsNote = workflow.context_mode === "current_note";
  const needsSection = workflow.context_mode === "section_notes";

  return (
    <div
      className="mx-4 p-4 rounded-b-xl space-y-3 -mt-1"
      style={{
        background: "rgba(122,92,255,0.04)",
        border: "1px solid var(--accent)",
        borderTop: "none",
      }}
    >
      {/* Context selectors */}
      {needsNote && (
        <div className="relative">
          <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Select Note</label>
          <input
            value={noteQuery}
            onChange={(e) => handleNoteSearch(e.target.value)}
            onFocus={() => noteResults.length > 0 && setShowNoteDropdown(true)}
            onBlur={() => setTimeout(() => setShowNoteDropdown(false), 200)}
            placeholder="Search by note title..."
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--card-border)",
              color: "var(--foreground)",
              ["--tw-ring-color" as string]: "var(--accent)",
            }}
          />
          {showNoteDropdown && noteResults.length > 0 && (
            <div
              className="absolute z-10 w-full mt-1 rounded-lg overflow-hidden shadow-lg max-h-48 overflow-y-auto"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
            >
              {noteResults.map((note) => (
                <button
                  key={note.id}
                  onMouseDown={() => selectNote(note)}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: "var(--foreground)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {note.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {needsSection && (
        <div>
          <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Select Section</label>
          <select
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
            style={{
              background: "#1a1735",
              color: "#e8e6f0",
              border: "1px solid var(--card-border)",
              ["--tw-ring-color" as string]: "var(--accent)",
            }}
          >
            <option value="" style={{ background: "#1a1735", color: "#e8e6f0" }}>Choose a section…</option>
            {flatSections(sections).map((s) => (
              <option key={s.slug} value={s.slug} style={{ background: "#1a1735", color: "#e8e6f0" }}>
                {"  ".repeat(s.depth)}{s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={handleExecute}
        disabled={executing}
        className="px-5 py-2 text-sm font-semibold rounded-lg text-white hover:opacity-90 disabled:opacity-50 transition"
        style={{ background: "var(--accent)" }}
      >
        {executing ? "Running…" : "▶ Execute"}
      </button>

      {/* Output */}
      {(output || executing) && (
        <div
          className="p-4 rounded-xl"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
          }}
        >
          {output ? (
            <div className="prose prose-invert prose-sm max-w-none" style={{ color: "var(--foreground)" }}>
              <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                {output}
              </ReactMarkdown>
              {executing && <span className="animate-pulse ml-1">▊</span>}
            </div>
          ) : (
            <div className="animate-pulse text-sm" style={{ color: "var(--text-muted)" }}>
              Running workflow…
            </div>
          )}
          <div ref={outputRef} />
        </div>
      )}
    </div>
  );
}
