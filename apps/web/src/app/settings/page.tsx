"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getSettings, updateSettings, testLlmConnection, getLlmLogs, clearLlmLogs,
  exportBackup, importBackup, listBackups, downloadBackup,
  listMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, testMcpServer, toggleMcpServer,
  McpServerConfig,
} from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";

interface SettingField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  options?: string[];
  placeholder?: string;
  hint?: string;
  modelSuggestions?: Record<string, string[]>;
}

interface SettingGroup {
  title: string;
  description: string;
  fields: SettingField[];
}

const MODEL_SUGGESTIONS: Record<string, Record<string, string[]>> = {
  chat_model: {
    openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
    ollama: ["llama3.2", "llama3.1", "mistral", "mixtral", "gemma2", "phi3", "qwen2.5"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
  },
  embedding_model: {
    openai: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"],
    ollama: ["nomic-embed-text", "mxbai-embed-large", "all-minilm"],
  },
};

const SETTING_GROUPS: SettingGroup[] = [
  {
    title: "Chat Provider",
    description:
      "Configure the LLM used for chat, wiki synthesis, auto-tagging, and import categorisation.",
    fields: [
      {
        key: "llm_provider",
        label: "Provider",
        type: "select",
        options: ["openai", "ollama"],
        hint: 'Use "openai" for OpenAI, Groq, or any OpenAI-compatible API.',
      },
      {
        key: "chat_model",
        label: "Chat Model",
        type: "text",
        placeholder: "e.g. gpt-4o-mini, llama-3.3-70b-versatile",
      },
      {
        key: "openai_api_key",
        label: "API Key",
        type: "password",
        placeholder: "sk-... or gsk_...",
      },
      {
        key: "openai_base_url",
        label: "Base URL",
        type: "text",
        placeholder: "https://api.openai.com/v1",
        hint: "Change to https://api.groq.com/openai/v1 for Groq, etc.",
      },
      {
        key: "azure_openai_endpoint",
        label: "Azure Endpoint (optional)",
        type: "text",
        placeholder: "https://your-resource.openai.azure.com",
      },
      {
        key: "azure_openai_api_key",
        label: "Azure API Key (optional)",
        type: "password",
        placeholder: "...",
      },
    ],
  },
  {
    title: "Embedding Provider",
    description:
      "Configure the model used for vectorising notes. Can be a different provider than chat (e.g. Ollama for embeddings, Groq for chat).",
    fields: [
      {
        key: "embedding_provider",
        label: "Provider",
        type: "select",
        options: ["openai", "ollama"],
        hint: "Defaults to the chat provider if left unchanged.",
      },
      {
        key: "embedding_model",
        label: "Embedding Model",
        type: "text",
        placeholder: "e.g. nomic-embed-text, text-embedding-3-small",
      },
      {
        key: "embedding_openai_api_key",
        label: "API Key (if different from chat)",
        type: "password",
        placeholder: "Leave empty to reuse chat API key",
      },
      {
        key: "embedding_openai_base_url",
        label: "Base URL (if different from chat)",
        type: "text",
        placeholder: "Leave empty to reuse chat base URL",
      },
    ],
  },
  {
    title: "Ollama",
    description: "Base URL for the Ollama server (used when provider is set to ollama).",
    fields: [
      {
        key: "ollama_base_url",
        label: "Ollama Base URL",
        type: "text",
        placeholder: "http://ollama:11434",
      },
    ],
  },
];

interface LogEntry {
  timestamp: string;
  provider: string;
  operation: string;
  model: string;
  status: string;
  duration_ms: number;
  detail: string;
}

interface TestResult {
  status: string;
  provider?: string;
  response_preview?: string;
  dimensions?: number;
  error?: string;
  hint?: string;
}

export default function SettingsPage() {
  return <SettingsContent />;
}

function SettingsContent() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "backup" | "mcp" | "logs">("config");
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<{ chat: TestResult | null; embedding: TestResult | null } | null>(null);

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Backup state
  const [backups, setBackups] = useState<{filename: string; size_bytes: number; created_at: string}[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // MCP state
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpFormOpen, setMcpFormOpen] = useState(false);
  const [mcpEditing, setMcpEditing] = useState<McpServerConfig | null>(null);
  const [mcpForm, setMcpForm] = useState({ name: "", url: "", transport: "sse", api_key: "", description: "" });
  const [mcpTesting, setMcpTesting] = useState<string | null>(null);
  const [mcpTestResult, setMcpTestResult] = useState<{status: string; tools_count?: number; tools?: {name: string; description: string}[]; error?: string} | null>(null);

  useEffect(() => {
    getSettings()
      .then((data: { settings: Record<string, string> }) => {
        setValues(data.settings || {});
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await getLlmLogs();
      setLogs(data.logs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "logs") loadLogs();
  }, [activeTab, loadLogs]);

  const loadBackups = useCallback(async () => {
    setBackupsLoading(true);
    try {
      const data = await listBackups();
      setBackups(data.backups || []);
    } catch (e) {
      console.error(e);
    } finally {
      setBackupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "backup") loadBackups();
  }, [activeTab, loadBackups]);

  const loadMcpServers = useCallback(async () => {
    setMcpLoading(true);
    try {
      const data = await listMcpServers();
      setMcpServers(data);
    } catch (e) {
      console.error(e);
    } finally {
      setMcpLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "mcp") loadMcpServers();
  }, [activeTab, loadMcpServers]);

  const handleExportBackup = async () => {
    setExporting(true);
    try {
      await exportBackup();
      toastSuccess("Backup exported");
    } catch (e) {
      toastError("Failed to export backup");
    } finally {
      setExporting(false);
    }
  };

  const handleImportBackup = async (file: File) => {
    const ok = await confirm({
      title: "Import backup",
      message: "This will REPLACE all your current data (notes, sections, tags) with the backup contents. This action cannot be undone.",
      confirmLabel: "Import & Replace",
      variant: "danger",
    });
    if (!ok) return;
    setImporting(true);
    try {
      const result = await importBackup(file);
      toastSuccess(result.message || "Backup imported successfully");
      loadBackups();
    } catch (e) {
      toastError("Failed to import backup");
    } finally {
      setImporting(false);
    }
  };

  const handleMcpSave = async () => {
    try {
      if (mcpEditing) {
        await updateMcpServer(mcpEditing.id, {
          name: mcpForm.name,
          url: mcpForm.url,
          transport: mcpForm.transport,
          api_key: mcpForm.api_key || undefined,
          description: mcpForm.description || undefined,
        });
        toastSuccess("Server updated");
      } else {
        await createMcpServer({
          name: mcpForm.name,
          url: mcpForm.url,
          transport: mcpForm.transport,
          api_key: mcpForm.api_key || undefined,
          description: mcpForm.description || undefined,
        });
        toastSuccess("Server added");
      }
      setMcpFormOpen(false);
      setMcpEditing(null);
      setMcpForm({ name: "", url: "", transport: "sse", api_key: "", description: "" });
      loadMcpServers();
    } catch (e) {
      toastError("Failed to save MCP server");
    }
  };

  const handleMcpDelete = async (id: string) => {
    const ok = await confirm({
      title: "Delete MCP server",
      message: "This server configuration will be permanently deleted.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteMcpServer(id);
      toastSuccess("Server deleted");
      loadMcpServers();
    } catch (e) {
      toastError("Failed to delete server");
    }
  };

  const handleMcpToggle = async (id: string) => {
    try {
      await toggleMcpServer(id);
      loadMcpServers();
    } catch (e) {
      toastError("Failed to toggle server");
    }
  };

  const handleMcpTest = async (id: string) => {
    setMcpTesting(id);
    setMcpTestResult(null);
    try {
      const result = await testMcpServer(id);
      setMcpTestResult(result);
      if (result.status === "ok") {
        toastSuccess(`Connected — ${result.tools_count || 0} tools available`);
      } else {
        toastError("Connection test failed");
      }
    } catch (e) {
      toastError("Connection test failed");
    } finally {
      setMcpTesting(null);
    }
  };

  const openMcpEdit = (server: McpServerConfig) => {
    setMcpEditing(server);
    setMcpForm({
      name: server.name,
      url: server.url,
      transport: server.transport,
      api_key: "",
      description: server.description || "",
    });
    setMcpFormOpen(true);
    setMcpTestResult(null);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const allFields = SETTING_GROUPS.flatMap((g) => g.fields);

  const handleSave = async () => {
    setSaving(true);
    try {
      const items = Object.entries(values)
        .filter(([key]) => allFields.some((f) => f.key === key))
        .map(([key, value]) => ({ key, value: value || null }));
      await updateSettings(items);
      toastSuccess("Settings saved");
    } catch (e) {
      toastError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResults(null);
    try {
      const data = await testLlmConnection();
      setTestResults(data);
      if (data.chat?.status === "ok" && data.embedding?.status === "ok") {
        toastSuccess("Both providers connected successfully");
      } else if (data.chat?.status === "ok" || data.embedding?.status === "ok") {
        toastSuccess("Partial connection — check results");
      } else {
        toastError("Connection test failed");
      }
    } catch (e) {
      toastError("Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleClearLogs = async () => {
    const ok = await confirm({
      title: "Clear activity logs",
      message: "All LLM activity logs will be permanently cleared.",
      confirmLabel: "Clear logs",
      variant: "warning",
    });
    if (!ok) return;
    try {
      await clearLlmLogs();
      setLogs([]);
      toastSuccess("Logs cleared");
    } catch (e) {
      toastError("Failed to clear logs");
    }
  };

  // Detect if using Groq URL for model suggestions
  const detectGroq = (v: Record<string, string>) => {
    const url = v.openai_base_url || "";
    return url.includes("groq.com");
  };

  const getModelSuggestions = (fieldKey: string): string[] => {
    const suggestions = MODEL_SUGGESTIONS[fieldKey];
    if (!suggestions) return [];
    const providerKey = fieldKey === "embedding_model" ? "embedding_provider" : "llm_provider";
    const provider = values[providerKey] || "ollama";
    if (provider === "openai" && detectGroq(values)) {
      return suggestions.groq || suggestions.openai || [];
    }
    return suggestions[provider] || [];
  };

  if (loading) {
    return (
      <div className="max-w-2xl">
        <h2 className="text-2xl font-display font-bold mb-6">Settings</h2>
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-display font-bold mb-6">Settings</h2>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
        {(["config", "backup", "mcp", "logs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all"
            style={{
              background: activeTab === tab ? "var(--accent)" : "transparent",
              color: activeTab === tab ? "#fff" : "var(--text-secondary)",
            }}
          >
            {tab === "config" ? "⚙️ Configuration" : tab === "backup" ? "💾 Backup" : tab === "mcp" ? "🔌 MCP Servers" : "📋 Activity Logs"}
          </button>
        ))}
      </div>

      {activeTab === "config" ? (
        <>
          {SETTING_GROUPS.map((group) => (
            <div
              key={group.title}
              className="p-5 rounded-xl mb-5"
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
              }}
            >
              <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--foreground)" }}>
                {group.title}
              </h3>
              <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
                {group.description}
              </p>

              <div className="space-y-4">
                {group.fields.map((field) => {
                  const suggestions = getModelSuggestions(field.key);
                  return (
                    <div key={field.key}>
                      <label
                        className="block text-sm font-medium mb-1"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {field.label}
                      </label>
                      {field.type === "select" ? (
                        <select
                          value={values[field.key] || ""}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [field.key]: e.target.value }))
                          }
                          className="w-full px-4 py-2.5 rounded-lg"
                          style={{
                            background: "#1a1735",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "#e8e6f0",
                          }}
                        >
                          {field.options?.map((opt) => (
                            <option key={opt} value={opt} style={{ background: "#1a1735", color: "#e8e6f0" }}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div>
                          <input
                            type={field.type === "password" ? "password" : "text"}
                            value={values[field.key] || ""}
                            onChange={(e) =>
                              setValues((v) => ({ ...v, [field.key]: e.target.value }))
                            }
                            placeholder={field.placeholder}
                            className="w-full px-4 py-2.5 rounded-lg"
                            style={{
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid var(--card-border)",
                              color: "var(--foreground)",
                            }}
                          />
                          {suggestions.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {suggestions.map((s) => (
                                <button
                                  key={s}
                                  onClick={() => setValues((v) => ({ ...v, [field.key]: s }))}
                                  className="px-2.5 py-1 text-xs rounded-md transition-all"
                                  style={{
                                    background: values[field.key] === s ? "var(--accent)" : "rgba(255,255,255,0.06)",
                                    color: values[field.key] === s ? "#fff" : "var(--text-secondary)",
                                    border: "1px solid " + (values[field.key] === s ? "var(--accent)" : "rgba(255,255,255,0.08)"),
                                  }}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {field.hint && (
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                          {field.hint}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Action buttons */}
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
              style={{ background: "var(--accent)" }}
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-5 py-2.5 rounded-xl font-semibold transition hover:opacity-90 disabled:opacity-50"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "var(--foreground)",
                border: "1px solid var(--card-border)",
              }}
            >
              {testing ? "Testing..." : "🔌 Test Connection"}
            </button>
          </div>

          {/* Test results */}
          {testResults && (
            <div
              className="p-5 rounded-xl mb-5 space-y-3"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
            >
              <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
                Connection Test Results
              </h3>
              {(["chat", "embedding"] as const).map((type) => {
                const r = testResults[type];
                if (!r) return null;
                return (
                  <div
                    key={type}
                    className="p-3 rounded-lg"
                    style={{
                      background: r.status === "ok" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                      border: `1px solid ${r.status === "ok" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span>{r.status === "ok" ? "✅" : "❌"}</span>
                      <span className="font-medium" style={{ color: "var(--foreground)" }}>
                        {type === "chat" ? "Chat Provider" : "Embedding Provider"}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {r.provider}
                    </p>
                    {r.status === "ok" && r.response_preview && (
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        Response: &quot;{r.response_preview}&quot;
                      </p>
                    )}
                    {r.status === "ok" && r.dimensions !== undefined && (
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        Vector dimensions: {r.dimensions}
                      </p>
                    )}
                    {r.status === "error" && (
                      <>
                        <p className="text-xs mt-1 font-mono" style={{ color: "#ef4444" }}>
                          {r.error}
                        </p>
                        {r.hint && (
                          <p className="text-xs mt-1 px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "var(--text-secondary)" }}>
                            💡 {r.hint}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* About */}
          <div
            className="p-5 rounded-xl"
            style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
          >
            <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--foreground)" }}>
              About
            </h3>
            <div className="text-sm space-y-1" style={{ color: "var(--text-muted)" }}>
              <p>Atlas Note v0.3.0</p>
              <p>Self-hosted note management with semantic search, LLM chat, and MCP integration.</p>
            </div>
          </div>
        </>
      ) : activeTab === "backup" ? (
        /* Backup tab */
        <div className="space-y-5">
          {/* Export section */}
          <div
            className="p-5 rounded-xl"
            style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
          >
            <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--foreground)" }}>
              Export Backup
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
              Download a full backup of all your notes, sections, tags, and settings as a ZIP file.
            </p>
            <button
              onClick={handleExportBackup}
              disabled={exporting}
              className="px-6 py-2.5 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
              style={{ background: "var(--accent)" }}
            >
              {exporting ? "Exporting..." : "📦 Export Backup"}
            </button>
          </div>

          {/* Import section */}
          <div
            className="p-5 rounded-xl"
            style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
          >
            <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--foreground)" }}>
              Import Backup
            </h3>
            <p className="text-sm mb-2" style={{ color: "var(--text-muted)" }}>
              Restore from a previously exported backup file.
            </p>
            <div
              className="p-3 rounded-lg mb-4"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <p className="text-xs" style={{ color: "#ef4444" }}>
                ⚠️ Importing a backup will <strong>REPLACE</strong> all your current data. This action cannot be undone.
              </p>
            </div>
            <label
              className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl cursor-pointer transition hover:opacity-80"
              style={{
                border: "2px dashed rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <span className="text-2xl">📁</span>
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {importing ? "Importing..." : "Click to select a .zip backup file"}
              </span>
              <input
                type="file"
                accept=".zip"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportBackup(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {/* Auto-backups list */}
          <div
            className="p-5 rounded-xl"
            style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
                  Auto-Backups
                </h3>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Automatic backups created by the system.
                </p>
              </div>
              <button
                onClick={loadBackups}
                disabled={backupsLoading}
                className="px-3 py-1.5 text-xs rounded-lg transition hover:opacity-80"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "1px solid var(--card-border)" }}
              >
                {backupsLoading ? "Loading..." : "🔄 Refresh"}
              </button>
            </div>

            {backups.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>
                {backupsLoading ? "Loading backups..." : "No auto-backups found."}
              </p>
            ) : (
              <div className="space-y-2">
                {backups.map((b) => (
                  <div
                    key={b.filename}
                    className="flex items-center justify-between p-3 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
                        {b.filename}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {formatBytes(b.size_bytes)} · {new Date(b.created_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => downloadBackup(b.filename)}
                      className="ml-3 px-3 py-1.5 text-xs rounded-lg transition hover:opacity-80 shrink-0"
                      style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "1px solid var(--card-border)" }}
                    >
                      ⬇️ Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === "mcp" ? (
        /* MCP Servers tab */
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
                MCP Server Connections
              </h3>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Configure external MCP servers to extend Atlas Note with additional tools.
              </p>
            </div>
            <button
              onClick={() => {
                setMcpEditing(null);
                setMcpForm({ name: "", url: "", transport: "sse", api_key: "", description: "" });
                setMcpFormOpen(true);
                setMcpTestResult(null);
              }}
              className="px-4 py-2 text-white rounded-xl font-semibold hover:opacity-90 transition text-sm shrink-0"
              style={{ background: "var(--accent)" }}
            >
              + Add Server
            </button>
          </div>

          {/* Add/Edit form */}
          {mcpFormOpen && (
            <div
              className="p-5 rounded-xl"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--foreground)" }}>
                {mcpEditing ? "Edit Server" : "Add Server"}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    Name
                  </label>
                  <input
                    type="text"
                    value={mcpForm.name}
                    onChange={(e) => setMcpForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="My MCP Server"
                    className="w-full px-4 py-2.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    URL
                  </label>
                  <input
                    type="text"
                    value={mcpForm.url}
                    onChange={(e) => setMcpForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="http://localhost:9000/sse"
                    className="w-full px-4 py-2.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    Transport
                  </label>
                  <select
                    value={mcpForm.transport}
                    onChange={(e) => setMcpForm((f) => ({ ...f, transport: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-lg"
                    style={{ background: "#1a1735", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e6f0" }}
                  >
                    <option value="sse" style={{ background: "#1a1735", color: "#e8e6f0" }}>SSE</option>
                    <option value="stdio" style={{ background: "#1a1735", color: "#e8e6f0" }}>stdio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    API Key <span className="font-normal" style={{ color: "var(--text-muted)" }}>(optional)</span>
                  </label>
                  <input
                    type="password"
                    value={mcpForm.api_key}
                    onChange={(e) => setMcpForm((f) => ({ ...f, api_key: e.target.value }))}
                    placeholder={mcpEditing ? "Leave empty to keep current" : ""}
                    className="w-full px-4 py-2.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    Description <span className="font-normal" style={{ color: "var(--text-muted)" }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={mcpForm.description}
                    onChange={(e) => setMcpForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="What does this server provide?"
                    className="w-full px-4 py-2.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleMcpSave}
                    disabled={!mcpForm.name || !mcpForm.url}
                    className="px-6 py-2.5 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
                    style={{ background: "var(--accent)" }}
                  >
                    {mcpEditing ? "Update" : "Add Server"}
                  </button>
                  <button
                    onClick={() => { setMcpFormOpen(false); setMcpEditing(null); }}
                    className="px-5 py-2.5 rounded-xl font-semibold transition hover:opacity-80"
                    style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "1px solid var(--card-border)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Server list */}
          {mcpLoading ? (
            <p className="text-sm py-4" style={{ color: "var(--text-muted)" }}>Loading servers...</p>
          ) : mcpServers.length === 0 && !mcpFormOpen ? (
            <div
              className="p-8 rounded-xl text-center"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
            >
              <p className="text-lg mb-1" style={{ color: "var(--text-secondary)" }}>No MCP servers configured</p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Add an MCP server to extend Atlas Note with external tools and resources.
              </p>
            </div>
          ) : (
            mcpServers.map((server) => (
              <div
                key={server.id}
                className="p-5 rounded-xl"
                style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: server.enabled ? "#22c55e" : "#6b7280" }}
                      />
                      <h4 className="text-base font-semibold truncate" style={{ color: "var(--foreground)" }}>
                        {server.name}
                      </h4>
                    </div>
                    <p className="text-xs font-mono truncate" style={{ color: "var(--text-muted)" }}>
                      {server.url}
                    </p>
                    {server.description && (
                      <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                        {server.description}
                      </p>
                    )}
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      Transport: {server.transport} · Added {new Date(server.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleMcpToggle(server.id)}
                      className="px-3 py-1.5 text-xs rounded-lg transition hover:opacity-80"
                      style={{
                        background: server.enabled ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.06)",
                        color: server.enabled ? "#22c55e" : "var(--text-muted)",
                        border: `1px solid ${server.enabled ? "rgba(34,197,94,0.2)" : "var(--card-border)"}`,
                      }}
                    >
                      {server.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <button
                    onClick={() => handleMcpTest(server.id)}
                    disabled={mcpTesting === server.id}
                    className="px-3 py-1.5 text-xs rounded-lg transition hover:opacity-80 disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "1px solid var(--card-border)" }}
                  >
                    {mcpTesting === server.id ? "Testing..." : "🔌 Test"}
                  </button>
                  <button
                    onClick={() => openMcpEdit(server)}
                    className="px-3 py-1.5 text-xs rounded-lg transition hover:opacity-80"
                    style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "1px solid var(--card-border)" }}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleMcpDelete(server.id)}
                    className="px-3 py-1.5 text-xs rounded-lg transition hover:opacity-80"
                    style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
                  >
                    🗑 Delete
                  </button>
                </div>

                {/* Test results for this server */}
                {mcpTestResult && mcpTesting === null && mcpTestResult.status && (
                  <div
                    className="mt-3 p-3 rounded-lg"
                    style={{
                      background: mcpTestResult.status === "ok" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                      border: `1px solid ${mcpTestResult.status === "ok" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span>{mcpTestResult.status === "ok" ? "✅" : "❌"}</span>
                      <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                        {mcpTestResult.status === "ok"
                          ? `Connected — ${mcpTestResult.tools_count || 0} tools`
                          : "Connection failed"}
                      </span>
                    </div>
                    {mcpTestResult.error && (
                      <p className="text-xs font-mono" style={{ color: "#ef4444" }}>{mcpTestResult.error}</p>
                    )}
                    {mcpTestResult.tools && mcpTestResult.tools.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {mcpTestResult.tools.map((tool) => (
                          <div key={tool.name} className="text-xs px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.04)" }}>
                            <span className="font-medium" style={{ color: "var(--foreground)" }}>{tool.name}</span>
                            {tool.description && (
                              <span style={{ color: "var(--text-muted)" }}> — {tool.description}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        /* Logs tab */
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Recent LLM activity ({logs.length} entries)
            </p>
            <div className="flex gap-2">
              <button
                onClick={loadLogs}
                disabled={logsLoading}
                className="px-3 py-1.5 text-xs rounded-lg transition hover:opacity-80"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "1px solid var(--card-border)" }}
              >
                {logsLoading ? "Loading..." : "🔄 Refresh"}
              </button>
              <button
                onClick={handleClearLogs}
                className="px-3 py-1.5 text-xs rounded-lg transition hover:opacity-80"
                style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                🗑 Clear
              </button>
            </div>
          </div>

          {logs.length === 0 ? (
            <div
              className="p-8 rounded-xl text-center"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
            >
              <p className="text-lg mb-1" style={{ color: "var(--text-secondary)" }}>No logs yet</p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                LLM activity will appear here after you use chat, import, auto-tag, or other AI features.
              </p>
            </div>
          ) : (
            <div
              className="rounded-xl overflow-hidden font-mono text-xs"
              style={{ background: "#0d0b24", border: "1px solid var(--card-border)", maxHeight: "600px", overflowY: "auto" }}
            >
              <table className="w-full">
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                    <th className="px-3 py-2 text-left" style={{ color: "var(--text-muted)" }}>Time</th>
                    <th className="px-3 py-2 text-left" style={{ color: "var(--text-muted)" }}>Provider</th>
                    <th className="px-3 py-2 text-left" style={{ color: "var(--text-muted)" }}>Operation</th>
                    <th className="px-3 py-2 text-left" style={{ color: "var(--text-muted)" }}>Model</th>
                    <th className="px-3 py-2 text-left" style={{ color: "var(--text-muted)" }}>Status</th>
                    <th className="px-3 py-2 text-right" style={{ color: "var(--text-muted)" }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr
                      key={i}
                      className="border-t"
                      style={{ borderColor: "rgba(255,255,255,0.04)" }}
                    >
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                        {log.provider.length > 30 ? log.provider.slice(0, 30) + "…" : log.provider}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--foreground)" }}>
                        {log.operation}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                        {log.model}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-xs"
                          style={{
                            background: log.status === "ok" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                            color: log.status === "ok" ? "#22c55e" : "#ef4444",
                          }}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                        {log.duration_ms}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Expandable detail row */}
              {logs.some((l) => l.detail && l.status === "error") && (
                <div className="px-3 py-2" style={{ background: "rgba(239,68,68,0.05)" }}>
                  <p className="text-xs font-medium mb-1" style={{ color: "#ef4444" }}>Recent errors:</p>
                  {logs
                    .filter((l) => l.status === "error")
                    .slice(0, 5)
                    .map((l, i) => (
                      <p key={i} className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
                        [{new Date(l.timestamp).toLocaleTimeString()}] {l.operation} → {l.detail}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
