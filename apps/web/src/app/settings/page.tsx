"use client";

import { AppShell } from "@/components/app-shell";
import { useState, useEffect } from "react";
import { getSettings, updateSettings } from "@/lib/api";

interface SettingField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  options?: string[];
  placeholder?: string;
  hint?: string;
}

interface SettingGroup {
  title: string;
  description: string;
  fields: SettingField[];
}

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

export default function SettingsPage() {
  return (
    <AppShell>
      <SettingsContent />
    </AppShell>
  );
}

function SettingsContent() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings()
      .then((data: { settings: Record<string, string> }) => {
        setValues(data.settings || {});
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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

      {SETTING_GROUPS.map((group) => (
        <div
          key={group.title}
          className="p-5 rounded-xl mb-5"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
          }}
        >
          <h3
            className="text-lg font-semibold mb-1"
            style={{ color: "var(--foreground)" }}
          >
            {group.title}
          </h3>
          <p
            className="text-sm mb-5"
            style={{ color: "var(--text-muted)" }}
          >
            {group.description}
          </p>

          <div className="space-y-4">
            {group.fields.map((field) => (
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
                      setValues((v) => ({
                        ...v,
                        [field.key]: e.target.value,
                      }))
                    }
                    className="w-full px-4 py-2.5 rounded-lg"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid var(--card-border)",
                      color: "var(--foreground)",
                    }}
                  >
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === "password" ? "password" : "text"}
                    value={values[field.key] || ""}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        [field.key]: e.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    className="w-full px-4 py-2.5 rounded-lg"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid var(--card-border)",
                      color: "var(--foreground)",
                    }}
                  />
                )}
                {field.hint && (
                  <p
                    className="text-xs mt-1"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {field.hint}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
          style={{ background: "var(--accent)" }}
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
        {saved && (
          <span className="text-sm text-green-400">
            Settings saved successfully
          </span>
        )}
      </div>

      <div
        className="p-5 rounded-xl"
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
        }}
      >
        <h3
          className="text-lg font-semibold mb-2"
          style={{ color: "var(--foreground)" }}
        >
          About
        </h3>
        <div
          className="text-sm space-y-1"
          style={{ color: "var(--text-muted)" }}
        >
          <p>Atlas Note v0.2.0</p>
          <p>
            Self-hosted note management with semantic search, LLM chat, and MCP
            integration.
          </p>
        </div>
      </div>
    </div>
  );
}
