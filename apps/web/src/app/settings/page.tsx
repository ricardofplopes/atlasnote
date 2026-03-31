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
}

const SETTING_FIELDS: SettingField[] = [
  { key: "llm_provider", label: "LLM Provider", type: "select", options: ["ollama", "openai"] },
  { key: "chat_model", label: "Chat Model", type: "text", placeholder: "e.g. llama3, gpt-4o-mini" },
  { key: "embedding_model", label: "Embedding Model", type: "text", placeholder: "e.g. nomic-embed-text" },
  { key: "ollama_base_url", label: "Ollama Base URL", type: "text", placeholder: "http://ollama:11434" },
  { key: "openai_api_key", label: "OpenAI API Key", type: "password", placeholder: "sk-..." },
  { key: "openai_base_url", label: "OpenAI Base URL", type: "text", placeholder: "https://api.openai.com/v1" },
  { key: "azure_openai_endpoint", label: "Azure OpenAI Endpoint", type: "text", placeholder: "https://..." },
  { key: "azure_openai_api_key", label: "Azure OpenAI API Key", type: "password", placeholder: "..." },
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

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const items = Object.entries(values)
        .filter(([key]) => SETTING_FIELDS.some((f) => f.key === key))
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

      <div className="p-5 rounded-xl mb-6" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
        <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--foreground)" }}>LLM Configuration</h3>
        <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
          Configure your AI provider. Changes apply to chat, search, wiki synthesis, and auto-tagging.
          Environment variables are used as defaults — settings here override them.
        </p>

        <div className="space-y-4">
          {SETTING_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {field.label}
              </label>
              {field.type === "select" ? (
                <select
                  value={values[field.key] || ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-lg"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid var(--card-border)",
                    color: "var(--foreground)",
                  }}
                >
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === "password" ? "password" : "text"}
                  value={values[field.key] || ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full px-4 py-2.5 rounded-lg"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid var(--card-border)",
                    color: "var(--foreground)",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
            style={{ background: "var(--accent)" }}
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
          {saved && (
            <span className="text-sm text-green-400">Settings saved successfully</span>
          )}
        </div>
      </div>

      <div className="p-5 rounded-xl" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
        <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--foreground)" }}>About</h3>
        <div className="text-sm space-y-1" style={{ color: "var(--text-muted)" }}>
          <p>Atlas Note v0.2.0</p>
          <p>Self-hosted note management with semantic search, LLM chat, and MCP integration.</p>
        </div>
      </div>
    </div>
  );
}
