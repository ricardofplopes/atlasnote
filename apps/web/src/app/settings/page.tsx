"use client";

import { useState, useEffect, useCallback } from "react";
import { getSettings, updateSettings, testLlmConnection, getLlmLogs, clearLlmLogs } from "@/lib/api";

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
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "logs">("config");

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<{ chat: TestResult | null; embedding: TestResult | null } | null>(null);

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

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

  const allFields = SETTING_GROUPS.flatMap((g) => g.fields);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const items = Object.entries(values)
        .filter(([key]) => allFields.some((f) => f.key === key))
        .map(([key, value]) => ({ key, value: value || null }));
      await updateSettings(items);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error(e);
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
    } catch (e) {
      console.error(e);
    } finally {
      setTesting(false);
    }
  };

  const handleClearLogs = async () => {
    try {
      await clearLlmLogs();
      setLogs([]);
    } catch (e) {
      console.error(e);
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
        {(["config", "logs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all"
            style={{
              background: activeTab === tab ? "var(--accent)" : "transparent",
              color: activeTab === tab ? "#fff" : "var(--text-secondary)",
            }}
          >
            {tab === "config" ? "⚙️ Configuration" : "📋 Activity Logs"}
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
            {saved && (
              <span className="text-sm text-green-400">Settings saved successfully</span>
            )}
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
