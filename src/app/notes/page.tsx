"use client";

import { useEffect, useState } from "react";
import { Note } from "@/lib/types";

const EMPTY_DRAFT = {
  title: "",
  body: "",
  topics: [] as string[],
};

// Formats an ISO timestamp as a human-readable relative string.
// Keeps it simple: days or a fallback to the ISO date for older notes.
function format_updated_at(iso: string): string {
  const diff_ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff_ms / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toISOString().split("T")[0];
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [load_error, set_load_error] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Controls whether the "new note" form is visible at the top
  const [show_add, setShowAdd] = useState(false);
  const [add_draft, setAddDraft] = useState({ ...EMPTY_DRAFT });
  const [adding, setAdding] = useState(false);

  // Which note is in inline-edit mode (by id), plus the draft being edited
  const [editing_id, setEditingId] = useState<string | null>(null);
  const [edit_draft, setEditDraft] = useState({ ...EMPTY_DRAFT });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const params = search ? `?q=${encodeURIComponent(search)}` : "";
    fetch(`/api/notes${params}`)
      .then((res) => {
        if (!res.ok) {
          set_load_error(`HTTP ${res.status} — make sure the database migration has been applied`);
          setLoading(false);
          return null;
        }
        return res.json();
      })
      .then((data: { notes?: Note[] } | null) => {
        if (data === null) return;
        set_load_error(null);
        setNotes(Array.isArray(data?.notes) ? data.notes : []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        set_load_error(err instanceof Error ? err.message : "Unknown fetch error");
        setLoading(false);
      });
  }, [search]);

  // ── Add ────────────────────────────────────────────────────────────────────

  async function handle_add(e: React.FormEvent) {
    e.preventDefault();
    if (!add_draft.title.trim() || !add_draft.body.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(add_draft),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to save note");
        return;
      }
      const created: { note: Note } = await res.json();
      setNotes((prev) => [created.note, ...prev]);
      setAddDraft({ ...EMPTY_DRAFT });
      setShowAdd(false);
    } finally {
      setAdding(false);
    }
  }

  // ── Edit ───────────────────────────────────────────────────────────────────

  function start_edit(note: Note) {
    setEditingId(note.id);
    setEditDraft({ title: note.title, body: note.body, topics: note.topics ?? [] });
    setShowAdd(false);
  }

  function cancel_edit() {
    setEditingId(null);
    setEditDraft({ ...EMPTY_DRAFT });
  }

  async function save_edit() {
    if (!editing_id) return;
    setSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing_id, ...edit_draft }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to update note");
        return;
      }
      const updated: { note: Note } = await res.json();
      setNotes((prev) => prev.map((n) => (n.id === editing_id ? updated.note : n)));
      setEditingId(null);
      setEditDraft({ ...EMPTY_DRAFT });
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handle_delete(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/notes?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Failed to delete note");
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (editing_id === id) cancel_edit();
  }

  if (loading) {
    return <div className="max-w-4xl mx-auto px-6 py-16 text-zinc-500">Loading notes...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Notes</h1>
          <p className="text-zinc-500 text-sm mt-1">{notes.length} note{notes.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setLoading(true); }}
            className="px-3 py-2 border border-zinc-200 rounded-md text-sm w-40 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
          <button
            onClick={() => { setShowAdd((v) => !v); cancel_edit(); }}
            className="text-xs px-3 py-2 bg-zinc-900 text-white rounded-md hover:bg-zinc-700"
          >
            {show_add ? "Cancel" : "+ New note"}
          </button>
        </div>
      </div>

      {/* New note form */}
      {show_add && (
        <form onSubmit={handle_add} className="border border-zinc-300 rounded-lg p-5 mb-6 space-y-3 bg-zinc-50">
          <p className="text-sm font-medium text-zinc-700">New note</p>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Title *</span>
            <input
              type="text"
              value={add_draft.title}
              onChange={(e) => setAddDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Give this note a title"
              className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Body *</span>
            <textarea
              value={add_draft.body}
              onChange={(e) => setAddDraft((d) => ({ ...d, body: e.target.value }))}
              rows={5}
              placeholder="Write your note here..."
              className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300 w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Topics (comma-separated)</span>
            <input
              type="text"
              value={add_draft.topics.join(", ")}
              onChange={(e) =>
                setAddDraft((d) => ({
                  ...d,
                  topics: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                }))
              }
              placeholder="e.g. ai, recruiting, strategy"
              className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={adding || !add_draft.title.trim() || !add_draft.body.trim()}
              className="px-4 py-1.5 bg-zinc-900 text-white text-sm rounded hover:bg-zinc-700 disabled:opacity-50"
            >
              {adding ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setAddDraft({ ...EMPTY_DRAFT }); }}
              className="px-4 py-1.5 border border-zinc-200 text-sm rounded hover:bg-zinc-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Load error banner — shown when the API fetch fails (e.g. migration not applied) */}
      {load_error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 mb-4">
          Could not load notes — make sure the database migration has been applied. ({load_error})
        </div>
      )}

      {/* Note list */}
      <div className="space-y-3">
        {notes.map((note) =>
          editing_id === note.id ? (
            // ── Inline edit form ──────────────────────────────────────────────
            <div key={note.id} className="border border-zinc-400 rounded-lg p-5 space-y-3">
              <p className="text-sm font-medium text-zinc-700">Editing note</p>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">Title</span>
                <input
                  type="text"
                  value={edit_draft.title}
                  onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                  className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">Body</span>
                <textarea
                  value={edit_draft.body}
                  onChange={(e) => setEditDraft((d) => ({ ...d, body: e.target.value }))}
                  rows={6}
                  className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 w-full"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">Topics (comma-separated)</span>
                <input
                  type="text"
                  value={edit_draft.topics.join(", ")}
                  onChange={(e) =>
                    setEditDraft((d) => ({
                      ...d,
                      topics: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                    }))
                  }
                  className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                />
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={save_edit}
                  disabled={saving}
                  className="px-4 py-1.5 bg-zinc-900 text-white text-sm rounded hover:bg-zinc-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={cancel_edit}
                  className="px-4 py-1.5 border border-zinc-200 text-sm rounded hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handle_delete(note.id, note.title)}
                  className="ml-auto px-4 py-1.5 border border-red-200 text-red-600 text-sm rounded hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            // ── Read-only card ────────────────────────────────────────────────
            <div
              key={note.id}
              className="border border-zinc-200 rounded-lg p-4 cursor-pointer hover:border-zinc-400 transition-colors"
              onClick={() => start_edit(note)}
            >
              <div className="flex items-start justify-between">
                <h3 className="font-medium">{note.title}</h3>
                <span className="text-xs text-zinc-400 flex-shrink-0 ml-4">{format_updated_at(note.updated_at)}</span>
              </div>

              {/* Body preview — first 200 chars */}
              <p className="text-sm text-zinc-500 mt-1 whitespace-pre-wrap line-clamp-3">
                {note.body.slice(0, 200)}{note.body.length > 200 ? "…" : ""}
              </p>

              {note.topics && note.topics.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {note.topics.map((topic) => (
                    <span key={topic} className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded">
                      {topic}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {notes.length === 0 && (
          <p className="text-zinc-500 text-center py-8">
            No notes yet. Click + New note to start.
          </p>
        )}
      </div>
    </div>
  );
}
