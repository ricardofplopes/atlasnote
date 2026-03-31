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
      <p className="text-gray-500 mb-4">
        Upload .txt files and the LLM will suggest sections and sub-sections for each.
      </p>

      <div className="mb-6 p-6 border-2 border-dashed border-gray-300 rounded-lg text-center">
        <input
          type="file"
          multiple
          accept=".txt"
          onChange={handleFileSelect}
          className="mb-3"
        />
        {files.length > 0 && (
          <p className="text-sm text-gray-500">{files.length} file(s) selected</p>
        )}
      </div>

      {files.length > 0 && previews.length === 0 && (
        <button
          onClick={handleUpload}
          disabled={loading}
          className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Analyze & Preview"}
        </button>
      )}

      {previews.length > 0 && (
        <div className="space-y-4 mt-6">
          <h3 className="text-lg font-semibold">Import Preview</h3>
          {previews.map((p, i) => (
            <div key={i} className="p-4 bg-white rounded-lg border">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{p.suggested_title}</p>
                  <p className="text-sm text-gray-500">
                    📁 {p.suggested_section}
                    {p.suggested_subsection && ` → ${p.suggested_subsection}`}
                  </p>
                </div>
                <span className="text-xs text-gray-400">{p.filename}</span>
              </div>
              <div className="flex gap-1 mt-2">
                {p.suggested_tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2 line-clamp-2">
                {p.content_preview}
              </p>
            </div>
          ))}
          <p className="text-sm text-gray-500 mt-2">
            ✅ Review the suggestions above. To import, use the API endpoint{" "}
            <code className="bg-gray-100 px-1 rounded">POST /api/import/confirm</code>.
          </p>
        </div>
      )}
    </div>
  );
}
