"use client";

import { AppShell } from "@/components/app-shell";
import { useState } from "react";
import { uploadFilesForImport } from "@/lib/api";

interface FilePreview {
  filename: string;
  suggested_section: string;
  suggested_subsection: string | null;
  suggested_title: string;
  suggested_tags: string[];
  content_preview: string;
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
  const [imported, setImported] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
      setPreviews([]);
      setImported(false);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const data = await uploadFilesForImport(files);
      setPreviews(data.files);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-display font-bold mb-6">📥 Import Notes</h2>
      <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
        Upload .txt files and the LLM will suggest sections and sub-sections for each.
      </p>

      <div
        className="mb-6 p-6 border-2 border-dashed rounded-xl text-center"
        style={{ borderColor: 'var(--card-border)' }}
      >
        <input
          type="file"
          multiple
          accept=".txt"
          onChange={handleFileSelect}
          className="mb-3"
          style={{ color: 'var(--text-secondary)' }}
        />
        {files.length > 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{files.length} file(s) selected</p>
        )}
      </div>

      {files.length > 0 && previews.length === 0 && (
        <button
          onClick={handleUpload}
          disabled={loading}
          className="px-6 py-3 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition"
          style={{ background: 'var(--accent)' }}
        >
          {loading ? "Analyzing..." : "Analyze & Preview"}
        </button>
      )}

      {previews.length > 0 && (
        <div className="space-y-4 mt-6">
          <h3 className="text-lg font-semibold">Import Preview</h3>
          {previews.map((p, i) => (
            <div
              key={i}
              className="p-4 rounded-xl"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold" style={{ color: 'var(--foreground)' }}>{p.suggested_title}</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    📁 {p.suggested_section}
                    {p.suggested_subsection && ` → ${p.suggested_subsection}`}
                  </p>
                </div>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.filename}</span>
              </div>
              <div className="flex gap-1 mt-2">
                {p.suggested_tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--accent-soft)', color: '#a78bfa' }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <p className="text-xs mt-2 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                {p.content_preview}
              </p>
            </div>
          ))}
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            ✅ Review the suggestions above. To import, use the API endpoint{" "}
            <code className="px-1 rounded text-xs" style={{ background: 'rgba(255,255,255,0.08)', color: '#a78bfa' }}>POST /api/import/confirm</code>.
          </p>
        </div>
      )}
    </div>
  );
}
