const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const LLM_TIMEOUT = 60000; // 60 seconds for LLM calls

async function apiFetch(path: string, options: RequestInit = {}, timeout = DEFAULT_TIMEOUT) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.dispatchEvent(new Event("auth:logout"));
      throw new Error("Unauthorized");
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }
    if (res.status === 204) return null;
    return res.json();
  } catch (e: unknown) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Request timed out. The server may be busy — please try again.");
    }
    throw e;
  }
}

// Auth
export async function loginWithGoogle(accessToken: string) {
  return apiFetch("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ token: accessToken }),
  });
}

export async function loginWithGitHub(code: string) {
  return apiFetch("/api/auth/github", {
    method: "POST",
    body: JSON.stringify({ token: code }),
  });
}

export async function getMe() {
  return apiFetch("/api/auth/me");
}

// Sections
export async function listSections() {
  return apiFetch("/api/sections");
}

export async function createSection(data: {
  name: string;
  description?: string;
  parent_id?: string;
}) {
  return apiFetch("/api/sections", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getSection(slug: string) {
  return apiFetch(`/api/sections/${slug}`);
}

export async function updateSection(slug: string, data: { name?: string; description?: string }) {
  return apiFetch(`/api/sections/${slug}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteSection(slug: string) {
  return apiFetch(`/api/sections/${slug}`, { method: "DELETE" });
}

export async function archiveSection(slug: string) {
  return apiFetch(`/api/sections/${slug}/archive`, { method: "PATCH" });
}

export async function moveSection(slug: string, parentId: string | null) {
  return apiFetch(`/api/sections/${slug}/move`, {
    method: "PATCH",
    body: JSON.stringify({ parent_id: parentId }),
  });
}

// Notes
export async function listNotesBySection(slug: string, includeSubsections = false) {
  return apiFetch(
    `/api/notes/by-section/${slug}?include_subsections=${includeSubsections}`
  );
}

export async function createNote(
  sectionSlug: string,
  data: { title: string; content: string; tags?: string[] }
) {
  return apiFetch(`/api/notes/in-section/${sectionSlug}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getNote(id: string) {
  return apiFetch(`/api/notes/${id}`);
}

export async function updateNote(
  id: string,
  data: { title?: string; content?: string; tags?: string[]; source_url?: string }
) {
  return apiFetch(`/api/notes/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function softDeleteNote(id: string) {
  return apiFetch(`/api/notes/${id}`, { method: "DELETE" });
}

export async function restoreNote(id: string) {
  return apiFetch(`/api/notes/${id}/restore`, { method: "POST" });
}

export async function hardDeleteNote(id: string) {
  return apiFetch(`/api/notes/${id}/hard`, { method: "DELETE" });
}

export async function moveNote(id: string, sectionId: string) {
  return apiFetch(`/api/notes/${id}/move`, {
    method: "POST",
    body: JSON.stringify({ section_id: sectionId }),
  });
}

export async function togglePin(id: string) {
  return apiFetch(`/api/notes/${id}/pin`, { method: "PATCH" });
}

export async function reorderNotes(items: { id: string; position: number }[]) {
  return apiFetch("/api/notes/reorder", {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export async function listRecentNotes(limit = 20) {
  return apiFetch(`/api/notes/recent?limit=${limit}`);
}

export async function listDeletedNotes() {
  return apiFetch("/api/notes/deleted");
}

// Versions
export async function listVersions(noteId: string) {
  return apiFetch(`/api/notes/${noteId}/versions`);
}

export async function restoreVersion(noteId: string, versionId: string) {
  return apiFetch(`/api/notes/${noteId}/versions/${versionId}/restore`, {
    method: "POST",
  });
}

// Search
export async function semanticSearch(
  query: string,
  sectionSlug?: string,
  limit = 10,
  mode: "hybrid" | "semantic" | "keyword" = "hybrid"
) {
  const data: Record<string, unknown> = { query, limit, mode };
  if (sectionSlug) data.section_slug = sectionSlug;
  return apiFetch("/api/search", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Chat
export async function chat(question: string, sectionSlug?: string, history: unknown[] = []) {
  const data: Record<string, unknown> = { question, history };
  if (sectionSlug) data.section_slug = sectionSlug;
  return apiFetch("/api/chat", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Streaming Chat — returns EventSource-compatible URL and body
export function streamChat(question: string, sectionSlug?: string, history: unknown[] = []) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const data: Record<string, unknown> = { question, history };
  if (sectionSlug) data.section_slug = sectionSlug;

  return fetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });
}

// Wiki
export async function generateWiki(sectionSlug: string, topic?: string) {
  const data: Record<string, unknown> = { section_slug: sectionSlug };
  if (topic) data.topic = topic;
  return apiFetch("/api/wiki/generate", {
    method: "POST",
    body: JSON.stringify(data),
  }, LLM_TIMEOUT);
}

// Settings
export async function getSettings() {
  return apiFetch("/api/settings");
}

export async function updateSettings(items: { key: string; value: string | null }[]) {
  return apiFetch("/api/settings", {
    method: "PUT",
    body: JSON.stringify(items),
  });
}

export async function testLlmConnection() {
  return apiFetch("/api/settings/test-connection", { method: "POST" }, LLM_TIMEOUT);
}

export async function getLlmLogs(limit = 100) {
  return apiFetch(`/api/settings/logs?limit=${limit}`);
}

export async function clearLlmLogs() {
  return apiFetch("/api/settings/logs", { method: "DELETE" });
}

// Import
export async function uploadFilesForImport(files: File[]) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/import/upload`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error(`Import upload failed: ${res.status}`);
  return res.json();
}

interface ImportFilePreview {
  filename: string;
  suggested_section: string;
  suggested_subsection: string | null;
  suggested_title: string;
  suggested_tags: string[];
  content_preview: string;
  content_full?: string | null;
  split_from?: string | null;
}

export async function confirmImport(previews: ImportFilePreview[], files: File[]) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const formData = new FormData();
  formData.append("data", JSON.stringify({ files: previews }));
  files.forEach((f) => formData.append("files", f));
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/import/confirm`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error(`Import confirm failed: ${res.status}`);
  return res.json();
}

// Related notes
export async function getRelatedNotes(noteId: string, limit = 8) {
  return apiFetch(`/api/notes/${noteId}/related?limit=${limit}`);
}

// Format markdown
export async function formatNoteMarkdown(noteId: string) {
  return apiFetch(`/api/notes/${noteId}/format-markdown`, { method: "POST" }, LLM_TIMEOUT);
}

export async function formatContent(title: string, content: string) {
  return apiFetch("/api/notes/format-content", {
    method: "POST",
    body: JSON.stringify({ title, content }),
  }, LLM_TIMEOUT);
}

// Auto-tag
export async function autoTagNote(noteId: string) {
  return apiFetch(`/api/notes/${noteId}/auto-tag`, { method: "POST" }, LLM_TIMEOUT);
}

// Export
export function exportNoteUrl(noteId: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return `${API_URL}/api/notes/export/${noteId}${token ? `?token=${token}` : ""}`;
}

export function exportSectionUrl(slug: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return `${API_URL}/api/notes/export-section/${slug}${token ? `?token=${token}` : ""}`;
}

export async function exportNote(noteId: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(`${API_URL}/api/notes/export/${noteId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const filename = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] || "note.md";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportSection(slug: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(`${API_URL}/api/notes/export-section/${slug}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const filename = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] || "notes.zip";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Todos
export async function listTodos(filter: string = "all") {
  return apiFetch(`/api/todos?filter=${filter}`);
}

export async function createTodo(data: { title: string; description?: string; note_id?: string }) {
  return apiFetch("/api/todos", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateTodo(id: string, data: { title?: string; description?: string; is_done?: boolean }) {
  return apiFetch(`/api/todos/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteTodo(id: string) {
  return apiFetch(`/api/todos/${id}`, { method: "DELETE" });
}

export async function toggleTodo(id: string) {
  return apiFetch(`/api/todos/${id}/toggle`, { method: "PATCH" });
}

export async function suggestTodos(noteId: string) {
  return apiFetch(`/api/todos/suggest/${noteId}`, { method: "POST" }, LLM_TIMEOUT);
}

export async function dismissTodo(id: string) {
  return apiFetch(`/api/todos/${id}/dismiss`, { method: "POST" });
}
