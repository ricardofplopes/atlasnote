const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function apiFetch(path: string, options: RequestInit = {}) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("token");
    window.location.href = "/";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
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
  data: { title?: string; content?: string; tags?: string[] }
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
export async function semanticSearch(query: string, sectionSlug?: string, limit = 10) {
  const data: Record<string, unknown> = { query, limit };
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
