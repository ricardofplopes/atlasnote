"use client";

import { AppShell } from "@/components/app-shell";
import { useState, useRef, useEffect } from "react";
import { confirmImport } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface FilePreview {
  filename: string;
  suggested_section: string;
  suggested_subsection: string | null;
  suggested_title: string;
  suggested_tags: string[];
  content_preview: string;
  content_full: string | null;
  split_from: string | null;
}

export default function ImportPage() {
  return (
    <AppShell>
      <ImportContent />
    </AppShell>
  );
}

function ImportContent() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [imported, setImported] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [clicking, setClicking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const addFiles = (newFiles: File[]) => {
    const valid = newFiles.filter(f => f.name.endsWith(".txt") || f.name.endsWith(".md"));
    if (valid.length === 0) return;
    setFiles(valid);
    setPreviews([]);
    setImported(false);
    setLogs([]);
    addLog(`Selected ${valid.length} file(s): ${valid.map(f => f.name).join(", ")}`);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleZoneClick = () => {
    setClicking(true);
    setTimeout(() => setClicking(false), 150);
    fileInputRef.current?.click();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setLogs([]);
    addLog("Starting file analysis...");

    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const allPreviews: FilePreview[] = [];

    // Process files one by one for progress feedback
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      addLog(`📄 Analyzing "${file.name}" (${i + 1}/${files.length})...`);
      addLog(`   ↳ Sending to LLM for categorization...`);

      try {
        const formData = new FormData();
        formData.append("files", file);
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_URL}/api/import/upload`, {
          method: "POST",
          headers,
          body: formData,
        });

        if (!res.ok) {
          addLog(`   ✗ Error analyzing "${file.name}": ${res.status}`);
          continue;
        }

        const data = await res.json();
        if (data.files && data.files.length > 0) {
          const splitFrom = data.files[0].split_from;
          if (splitFrom && data.files.length > 1) {
            // File was split into multiple entries by date
            addLog(`   ✓ Detected ${data.files.length} date entries — splitting into separate notes`);
            for (const preview of data.files) {
              allPreviews.push(preview);
              addLog(`     → "${preview.suggested_title}"`);
            }
            addLog(`   ✓ Section: ${data.files[0].suggested_section}${data.files[0].suggested_subsection ? ` / ${data.files[0].suggested_subsection}` : ""}`);
          } else {
            const preview = data.files[0];
            allPreviews.push(preview);
            addLog(`   ✓ Suggested: "${preview.suggested_title}" → ${preview.suggested_section}${preview.suggested_subsection ? ` / ${preview.suggested_subsection}` : ""}`);
            addLog(`   ✓ Tags: ${preview.suggested_tags.join(", ") || "(none)"}`);
          }
        }
      } catch (e) {
        addLog(`   ✗ Failed to analyze "${file.name}": ${e}`);
      }
    }

    addLog(`\n✅ Analysis complete. ${allPreviews.length}/${files.length} files categorized.`);
    addLog("Review the suggestions below and click 'Confirm Import' to proceed.");
    setPreviews(allPreviews);
    setLoading(false);
  };

  const handleConfirmImport = async () => {
    if (previews.length === 0) return;
    setConfirming(true);
    addLog("\n🚀 Starting import...");

    try {
      const result = await confirmImport(previews, files);
      setImportedCount(result.length);
      setImported(true);
      addLog(`✅ Successfully imported ${result.length} note(s)!`);
    } catch (e) {
      addLog(`✗ Import failed: ${e}`);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-display font-bold mb-6">Import Notes</h2>
      <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
        Upload text files and the LLM will analyze and categorize each into sections.
      </p>

      <div
        ref={dropRef}
        className={`mb-6 p-8 border-2 border-dashed rounded-xl text-center transition-all ${dragging ? 'scale-[1.01]' : ''}`}
        style={{
          borderColor: dragging ? 'var(--accent)' : 'var(--card-border)',
          background: clicking ? 'rgba(122,92,255,0.12)' : dragging ? 'var(--accent-soft)' : 'transparent',
          cursor: 'pointer',
        }}
        onClick={handleZoneClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <svg className="w-10 h-10 mx-auto mb-3 opacity-40" viewBox="0 0 20 20" fill="none" strokeWidth={1.2} stroke="currentColor" style={{ color: 'var(--text-muted)' }}>
          <path d="M10 3v9M7 9l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 13v2a2 2 0 002 2h8a2 2 0 002-2v-2" strokeLinecap="round" />
        </svg>
        <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
          Drag & drop files here, or click to browse
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        {files.length > 0 && (
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>{files.length} file(s) selected</p>
        )}
      </div>

      {files.length > 0 && previews.length === 0 && !loading && (
        <button
          onClick={handleUpload}
          className="px-6 py-3 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
          style={{ background: 'var(--accent)' }}
        >
          Analyze & Preview
        </button>
      )}

      {/* Progress console */}
      {logs.length > 0 && (
        <div className="mt-6 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full" style={{ background: loading ? '#4ade80' : 'var(--text-muted)' }}>
              {loading && <div className="w-2 h-2 rounded-full animate-ping" style={{ background: '#4ade80' }} />}
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {loading ? "Processing..." : "Console"}
            </span>
          </div>
          <div
            ref={logRef}
            className="rounded-xl p-4 font-mono text-xs max-h-60 overflow-y-auto"
            style={{
              background: '#090820',
              border: '1px solid var(--card-border)',
              color: '#94a3b8',
            }}
          >
            {logs.map((log, i) => (
              <div key={i} className="whitespace-pre-wrap leading-relaxed">
                {log.includes("✓") ? (
                  <span style={{ color: '#4ade80' }}>{log}</span>
                ) : log.includes("✗") ? (
                  <span style={{ color: '#f87171' }}>{log}</span>
                ) : log.includes("✅") ? (
                  <span style={{ color: '#a78bfa' }}>{log}</span>
                ) : log.includes("🚀") ? (
                  <span style={{ color: '#38bdf8' }}>{log}</span>
                ) : (
                  log
                )}
              </div>
            ))}
            {loading && (
              <div className="mt-1 animate-pulse" style={{ color: '#a78bfa' }}>▋</div>
            )}
          </div>
        </div>
      )}

      {previews.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Import Preview</h3>
          {(() => {
            // Group previews by split_from for visual grouping
            const groups: { source: string | null; items: FilePreview[] }[] = [];
            let currentGroup: typeof groups[0] | null = null;

            for (const p of previews) {
              if (p.split_from) {
                if (!currentGroup || currentGroup.source !== p.split_from) {
                  currentGroup = { source: p.split_from, items: [p] };
                  groups.push(currentGroup);
                } else {
                  currentGroup.items.push(p);
                }
              } else {
                groups.push({ source: null, items: [p] });
                currentGroup = null;
              }
            }

            return groups.map((group, gi) => (
              <div key={gi}>
                {group.source && (
                  <div className="flex items-center gap-2 mb-2 mt-4">
                    <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{group.source}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80" }}>
                      Split into {group.items.length} notes
                    </span>
                  </div>
                )}
                <div className={group.source ? "space-y-2 pl-3" : "space-y-2"} style={group.source ? { borderLeft: "2px solid rgba(122,92,255,0.3)" } : {}}>
                  {group.items.map((p, i) => (
                    <div
                      key={i}
                      className="p-4 rounded-xl"
                      style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold" style={{ color: "var(--foreground)" }}>{p.suggested_title}</p>
                          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                            {p.suggested_section}
                            {p.suggested_subsection && ` → ${p.suggested_subsection}`}
                          </p>
                        </div>
                        {!group.source && (
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{p.filename}</span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-2">
                        {p.suggested_tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: "var(--accent-soft)", color: "#a78bfa" }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs mt-2 line-clamp-2" style={{ color: "var(--text-muted)" }}>
                        {p.content_preview}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ));
          })()}

          {!imported ? (
            <button
              onClick={handleConfirmImport}
              disabled={confirming}
              className="px-6 py-3 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition flex items-center gap-2"
              style={{ background: '#4ade80' }}
            >
              {confirming ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                    <path d="M12 2a10 10 0 019.8 8" strokeLinecap="round" />
                  </svg>
                  Importing...
                </>
              ) : (
                <>Confirm Import ({previews.length} note{previews.length > 1 ? "s" : ""})</>
              )}
            </button>
          ) : (
            <div
              className="p-4 rounded-xl flex items-center gap-3"
              style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)' }}
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="#4ade80" strokeWidth={1.5}>
                <circle cx="10" cy="10" r="7" />
                <path d="M7 10l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="font-semibold" style={{ color: '#4ade80' }}>
                Successfully imported {importedCount} note{importedCount > 1 ? "s" : ""}!
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
