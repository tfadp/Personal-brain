"use client";

import { useEffect, useState } from "react";
import { Contact } from "@/lib/types";

// Empty draft shape used to reset the add form
const EMPTY_DRAFT = {
  name: "",
  role: "",
  company: "",
  city: "",
  country: "",
  email: "",
  linkedin_url: "",
  how_you_know_them: "",
  last_meaningful_contact: "",
  relationship_strength: "",
  topics: [] as string[],
  notes: "",
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Contact>>({});
  const [saving, setSaving] = useState(false);

  // Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState({ ...EMPTY_DRAFT });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data) => {
        setContacts(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.role?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.topics?.some((t) => t.toLowerCase().includes(q))
    );
  });

  // Stats bar — computed from all contacts, not just filtered
  const strong_count = contacts.filter(
    (c) => c.relationship_strength === "strong"
  ).length;
  const city_count = new Set(contacts.map((c) => c.city).filter(Boolean)).size;
  const topic_freq: Record<string, number> = {};
  contacts.forEach((c) =>
    c.topics?.forEach((t) => {
      topic_freq[t] = (topic_freq[t] ?? 0) + 1;
    })
  );
  const top_topics = Object.entries(topic_freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t);

  // ── Add contact ──────────────────────────────────────────────────────────

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addDraft.name.trim()) return;
    setAdding(true);
    try {
      const payload = {
        ...addDraft,
        relationship_strength: addDraft.relationship_strength || null,
        topics: addDraft.topics.length > 0 ? addDraft.topics : null,
        // Normalize empty strings to null for optional fields
        role: addDraft.role || null,
        company: addDraft.company || null,
        city: addDraft.city || null,
        country: addDraft.country || null,
        email: addDraft.email || null,
        linkedin_url: addDraft.linkedin_url || null,
        how_you_know_them: addDraft.how_you_know_them || null,
        last_meaningful_contact: addDraft.last_meaningful_contact || null,
        notes: addDraft.notes || null,
      };
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const created: Contact = await res.json();
      // Insert alphabetically by name
      setContacts((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
      );
      setAddDraft({ ...EMPTY_DRAFT });
      setShowAdd(false);
    } finally {
      setAdding(false);
    }
  }

  // ── Edit contact ─────────────────────────────────────────────────────────

  function startEdit(contact: Contact) {
    setEditingId(contact.id);
    setEditDraft({ ...contact });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({});
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...editDraft }),
      });
      const updated: Contact = await res.json();
      setContacts((prev) =>
        prev.map((c) => (c.id === editingId ? updated : c))
      );
      setEditingId(null);
      setEditDraft({});
    } finally {
      setSaving(false);
    }
  }

  // ── Delete contact ───────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    await fetch(`/api/contacts?id=${id}`, { method: "DELETE" });
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  // ── CSV export ───────────────────────────────────────────────────────────

  function exportCsv() {
    const headers = [
      "name", "role", "company", "city", "country",
      "relationship_strength", "how_you_know_them", "topics",
      "last_meaningful_contact", "notes", "email", "linkedin_url",
    ];
    const rows = contacts.map((c) =>
      headers.map((h) => {
        const val = c[h as keyof Contact];
        if (Array.isArray(val)) return `"${val.join(", ")}"`;
        if (val == null) return "";
        // Wrap in quotes if the value contains a comma or quote
        const str = String(val);
        return str.includes(",") || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      })
    );
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cortex-contacts.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Shared field list used in both add and edit forms ────────────────────
  const text_fields: [string, string][] = [
    ["name", "Name *"],
    ["role", "Role"],
    ["company", "Company"],
    ["city", "City"],
    ["country", "Country"],
    ["email", "Email"],
    ["linkedin_url", "LinkedIn URL"],
    ["how_you_know_them", "How you know them"],
  ];

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-zinc-500">
        Loading contacts...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">

      {/* Header row */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {contacts.length} people in your network
          </p>
        </div>
        <div className="flex items-center gap-3">
          {contacts.length > 0 && (
            <button
              onClick={exportCsv}
              className="text-xs px-3 py-2 border border-zinc-200 rounded-md text-zinc-500 hover:text-zinc-800 hover:border-zinc-400"
            >
              Export CSV
            </button>
          )}
          <button
            onClick={() => { setShowAdd((v) => !v); setEditingId(null); }}
            className="text-xs px-3 py-2 bg-zinc-900 text-white rounded-md hover:bg-zinc-700"
          >
            {showAdd ? "Cancel" : "+ Add contact"}
          </button>
          <input
            type="text"
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border border-zinc-200 rounded-md text-sm w-40 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
        </div>
      </div>

      {/* Add contact form — collapsible */}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="border border-zinc-300 rounded-lg p-5 mb-6 space-y-3 bg-zinc-50"
        >
          <p className="text-sm font-medium text-zinc-700">New contact</p>
          <div className="grid grid-cols-2 gap-3">
            {text_fields.map(([field, label]) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">{label}</span>
                <input
                  type="text"
                  value={addDraft[field as keyof typeof addDraft] as string}
                  onChange={(e) =>
                    setAddDraft((d) => ({ ...d, [field]: e.target.value }))
                  }
                  className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
                />
              </label>
            ))}

            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Last contact</span>
              <input
                type="date"
                value={addDraft.last_meaningful_contact}
                onChange={(e) =>
                  setAddDraft((d) => ({
                    ...d,
                    last_meaningful_contact: e.target.value,
                  }))
                }
                className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Relationship strength</span>
              <select
                value={addDraft.relationship_strength}
                onChange={(e) =>
                  setAddDraft((d) => ({
                    ...d,
                    relationship_strength: e.target.value,
                  }))
                }
                className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
              >
                <option value="">—</option>
                <option value="strong">Strong</option>
                <option value="medium">Medium</option>
                <option value="light">Light</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Topics (comma-separated)</span>
              <input
                type="text"
                value={addDraft.topics.join(", ")}
                onChange={(e) =>
                  setAddDraft((d) => ({
                    ...d,
                    topics: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  }))
                }
                className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Notes</span>
            <textarea
              value={addDraft.notes}
              onChange={(e) =>
                setAddDraft((d) => ({ ...d, notes: e.target.value }))
              }
              rows={2}
              className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300 w-full"
            />
          </label>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={adding || !addDraft.name.trim()}
              className="px-4 py-1.5 bg-zinc-900 text-white text-sm rounded hover:bg-zinc-700 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add contact"}
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

      {/* Stats bar */}
      {contacts.length > 0 && (
        <div className="flex flex-wrap gap-4 text-sm text-zinc-500 mb-6 pb-6 border-b border-zinc-100">
          <span>{contacts.length} contacts</span>
          <span>{strong_count} strong</span>
          <span>{city_count} {city_count === 1 ? "city" : "cities"}</span>
          {top_topics.length > 0 && (
            <span>top topics: {top_topics.join(", ")}</span>
          )}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((contact) =>
          editingId === contact.id ? (
            // ── Inline edit form ──────────────────────────────────────────
            <div
              key={contact.id}
              className="border border-zinc-400 rounded-lg p-5 space-y-3"
            >
              <p className="text-sm font-medium text-zinc-700 mb-1">
                Editing {contact.name}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["name", "Name"],
                    ["role", "Role"],
                    ["company", "Company"],
                    ["city", "City"],
                    ["country", "Country"],
                    ["email", "Email"],
                    ["linkedin_url", "LinkedIn URL"],
                    ["how_you_know_them", "How you know them"],
                  ] as [keyof Contact, string][]
                ).map(([field, label]) => (
                  <label key={field} className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">{label}</span>
                    <input
                      type="text"
                      value={(editDraft[field] as string) ?? ""}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, [field]: e.target.value }))
                      }
                      className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                    />
                  </label>
                ))}

                {/* B2 — date picker for last contact */}
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">Last contact</span>
                  <input
                    type="date"
                    value={(editDraft.last_meaningful_contact as string) ?? ""}
                    onChange={(e) =>
                      setEditDraft((d) => ({
                        ...d,
                        last_meaningful_contact: e.target.value,
                      }))
                    }
                    className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">Relationship strength</span>
                  <select
                    value={editDraft.relationship_strength ?? ""}
                    onChange={(e) =>
                      setEditDraft((d) => ({
                        ...d,
                        relationship_strength: e.target.value || null,
                      }))
                    }
                    className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  >
                    <option value="">—</option>
                    <option value="strong">Strong</option>
                    <option value="medium">Medium</option>
                    <option value="light">Light</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">Topics (comma-separated)</span>
                  <input
                    type="text"
                    value={editDraft.topics?.join(", ") ?? ""}
                    onChange={(e) =>
                      setEditDraft((d) => ({
                        ...d,
                        topics: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      }))
                    }
                    className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">Notes</span>
                <textarea
                  value={(editDraft.notes as string) ?? ""}
                  onChange={(e) =>
                    setEditDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                  rows={2}
                  className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 w-full"
                />
              </label>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="px-4 py-1.5 bg-zinc-900 text-white text-sm rounded hover:bg-zinc-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-4 py-1.5 border border-zinc-200 text-sm rounded hover:bg-zinc-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            // ── Read-only card ────────────────────────────────────────────
            <div
              key={contact.id}
              className="border border-zinc-200 rounded-lg p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{contact.name}</h3>
                  <p className="text-sm text-zinc-600">
                    {[contact.role, contact.company].filter(Boolean).join(" at ")}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {[contact.city, contact.country].filter(Boolean).join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      contact.relationship_strength === "strong"
                        ? "bg-green-100 text-green-700"
                        : contact.relationship_strength === "medium"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {contact.relationship_strength || "—"}
                  </span>
                  <button
                    onClick={() => startEdit(contact)}
                    className="text-xs text-zinc-400 hover:text-zinc-700 px-2 py-1 rounded hover:bg-zinc-100"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(contact.id, contact.name)}
                    className="text-xs text-zinc-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {contact.how_you_know_them && (
                <p className="text-sm text-zinc-500 mt-2">
                  {contact.how_you_know_them}
                </p>
              )}

              {contact.topics && contact.topics.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {contact.topics.map((topic) => (
                    <button
                      key={topic}
                      onClick={() => setSearch(topic)}
                      className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded hover:bg-zinc-200 cursor-pointer"
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              )}

              {contact.notes && (
                <p className="text-sm text-zinc-400 mt-2 italic">
                  {contact.notes}
                </p>
              )}

              {contact.last_meaningful_contact && (
                <p className="text-xs text-zinc-400 mt-2">
                  Last contact: {contact.last_meaningful_contact}
                </p>
              )}
            </div>
          )
        )}

        {filtered.length === 0 && (
          <p className="text-zinc-500 text-center py-8">
            {contacts.length === 0
              ? "No contacts yet. Click \"+ Add contact\" to get started."
              : "No contacts match your filter."}
          </p>
        )}
      </div>
    </div>
  );
}
