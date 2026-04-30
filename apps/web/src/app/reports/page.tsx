"use client";

import { useState } from "react";
import { generateReport } from "@/lib/api";
import { listSections } from "@/lib/api";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import ReactMarkdown from "react-markdown";
import { remarkPlugins, markdownComponents } from "@/lib/markdown-config";
import { useToast } from "@/components/toast";

interface Section {
  id: string;
  name: string;
  slug: string;
}

export default function ReportsPage() {
  const { user } = useAuth();
  const { error: toastError } = useToast();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [sectionId, setSectionId] = useState<string>("");
  const [sections, setSections] = useState<Section[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [stats, setStats] = useState<{ notes_count: number; todos_completed: number; sections_active: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      listSections().then((data) => {
        const flat: Section[] = [];
        const flatten = (secs: Record<string, unknown>[]) => {
          for (const s of secs) {
            flat.push({ id: s.id as string, name: s.name as string, slug: s.slug as string });
            if (Array.isArray(s.children)) flatten(s.children);
          }
        };
        flatten(data || []);
        setSections(flat);
      }).catch(() => {});
    }
  }, [user]);

  const handleGenerate = async () => {
    setLoading(true);
    setReport(null);
    setStats(null);
    try {
      const result = await generateReport(period, sectionId || undefined);
      setReport(result.report);
      setStats(result.stats || null);
    } catch {
      toastError("Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-display font-bold mb-2" style={{ color: "var(--foreground)" }}>
        📊 Summary Reports
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        AI-generated summaries of your activity grouped by section with themes, progress, and insights.
      </p>

      {/* Controls */}
      <div
        className="p-5 rounded-xl mb-6"
        style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
      >
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
              Period
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setPeriod("week")}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: period === "week" ? "var(--accent)" : "rgba(255,255,255,0.06)",
                  color: period === "week" ? "#fff" : "var(--text-secondary)",
                  border: `1px solid ${period === "week" ? "var(--accent)" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                📅 Past Week
              </button>
              <button
                onClick={() => setPeriod("month")}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: period === "month" ? "var(--accent)" : "rgba(255,255,255,0.06)",
                  color: period === "month" ? "#fff" : "var(--text-secondary)",
                  border: `1px solid ${period === "month" ? "var(--accent)" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                📆 Past Month
              </button>
            </div>
          </div>

          <div className="flex-1">
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
              Filter by Section (optional)
            </label>
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: "#1a1735",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#e8e6f0",
              }}
            >
              <option value="">All Sections</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
            style={{ background: "var(--accent)" }}
          >
            {loading ? "Generating..." : "✨ Generate Report"}
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3">
            <span className="inline-block w-5 h-5 rounded-full animate-spin" style={{ border: "2px solid var(--card-border)", borderTopColor: "var(--accent)" }} />
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>Analyzing your {period === "week" ? "weekly" : "monthly"} activity...</span>
          </div>
        </div>
      )}

      {/* Report */}
      {report && !loading && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
        >
          {/* Stats bar */}
          {stats && (
            <div className="flex gap-6 px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="text-center">
                <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>{stats.notes_count}</div>
                <div className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>Notes</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold" style={{ color: "#4ade80" }}>{stats.todos_completed}</div>
                <div className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>Todos Done</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold" style={{ color: "#fbbf24" }}>{stats.sections_active}</div>
                <div className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>Active Sections</div>
              </div>
            </div>
          )}

          {/* Report content */}
          <div className="p-5">
            <div className="prose prose-sm max-w-none" style={{ color: "var(--text-secondary)" }}>
              <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                {report}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
