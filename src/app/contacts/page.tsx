"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Contact } from "@/lib/types";

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
  contact_quality: "" as "" | "1" | "2" | "3",
  topics: [] as string[],
  notes: "",
  follow_up: false,
  follow_up_note: "",
};

function QualityStars({ value, onChange }: { value: number | null; onChange?: (v: number | null) => void }) {
  // Cycles: null→1→2→3→null on each tap
  function handleTap(star: number) {
    if (!onChange) return;
    onChange(value === star ? (star === 1 ? null : star - 1) : star);
  }
  return (
    <span className={`text-base leading-none ${onChange ? "cursor-pointer" : ""}`} title="Tap to rate">
      {[1, 2, 3].map((s) => (
        <span key={s} onClick={() => handleTap(s)}
          className={(value ?? 0) >= s ? "text-amber-400" : "text-zinc-300"}>
          ★
        </span>
      ))}
    </span>
  );
}

function ContactsPageInner() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showFollowUpOnly, setShowFollowUpOnly] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Contact>>({});
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState({ ...EMPTY_DRAFT });
  const [adding, setAdding] = useState(false);

  const searchParams = useSearchParams();

  const openEdit = useCallback((contact: Contact) => {
    setEditingId(contact.id);
    setEditDraft({
      name: contact.name,
      role: contact.role ?? "",
      company: contact.company ?? "",
      city: contact.city ?? "",
      country: contact.country ?? "",
      email: contact.email ?? "",
      linkedin_url: contact.linkedin_url ?? "",
      how_you_know_them: contact.how_you_know_them ?? "",
      last_meaningful_contact: contact.last_meaningful_contact ?? "",
      relationship_strength: contact.relationship_strength ?? "",
      contact_quality: contact.contact_quality ?? undefined,
      topics: contact.topics ?? [],
      notes: contact.notes ?? "",
      follow_up: contact.follow_up ?? false,
      follow_up_note: contact.follow_up_note ?? "",
    });
  }, []);

  useEffect(() => {
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data: Contact[]) => {
        setContacts(data);
        setLoading(false);
        // Open edit form if ?edit=<id> was passed from search results
        const edit_id = searchParams.get("edit");
        if (edit_id) {
          const target = data.find((c) => c.id === edit_id);
          if (target) openEdit(target);
        }
      })
      .catch(() => setLoading(false));
  }, [searchParams, openEdit]);

  const filtered = contacts.filter((c) => {
    if (showFollowUpOnly && !c.follow_up) return false;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.role?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.topics?.some((t) => t.toLowerCase().includes(q))
    );
  });

  // Stats
  const strong_count = contacts.filter((c) => c.relationship_strength === "strong").length;
  const city_count = new Set(contacts.map((c) => c.city).filter(Boolean)).size;
  const follow_up_count = contacts.filter((c) => c.follow_up).length;
  const topic_freq: Record<string, number> = {};
  contacts.forEach((c) => c.topics?.forEach((t) => { topic_freq[t] = (topic_freq[t] ?? 0) + 1; }));
  const top_topics = Object.entries(topic_freq).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);

  // ── Add ──────────────────────────────────────────────────────────────────

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addDraft.name.trim()) return;
    setAdding(true);
    try {
      const payload = {
        ...addDraft,
        relationship_strength: addDraft.relationship_strength || null,
        contact_quality: addDraft.contact_quality ? parseInt(addDraft.contact_quality) : null,
        topics: addDraft.topics.length > 0 ? addDraft.topics : null,
        role: addDraft.role || null,
        company: addDraft.company || null,
        city: addDraft.city || null,
        country: addDraft.country || null,
        email: addDraft.email || null,
        linkedin_url: addDraft.linkedin_url || null,
        how_you_know_them: addDraft.how_you_know_them || null,
        last_meaningful_contact: addDraft.last_meaningful_contact || null,
        notes: addDraft.notes || null,
        follow_up: addDraft.follow_up,
        follow_up_note: addDraft.follow_up_note || null,
      };
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const created: Contact = await res.json();
      setContacts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setAddDraft({ ...EMPTY_DRAFT });
      setShowAdd(false);
    } finally {
      setAdding(false);
    }
  }

  // ── Edit ─────────────────────────────────────────────────────────────────

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
      setContacts((prev) => prev.map((c) => (c.id === editingId ? updated : c)));
      setEditingId(null);
      setEditDraft({});
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    await fetch(`/api/contacts?id=${id}`, { method: "DELETE" });
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  // ── Quick follow-up toggle ───────────────────────────────────────────────

  async function setQuality(contact: Contact, value: number | null) {
    const res = await fetch("/api/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: contact.id, contact_quality: value }),
    });
    const updated: Contact = await res.json();
    setContacts((prev) => prev.map((c) => (c.id === contact.id ? updated : c)));
  }

  async function toggleFollowUp(contact: Contact) {
    const updated_follow_up = !contact.follow_up;
    const res = await fetch("/api/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: contact.id, follow_up: updated_follow_up }),
    });
    const updated: Contact = await res.json();
    setContacts((prev) => prev.map((c) => (c.id === contact.id ? updated : c)));
  }

  // ── CSV export ───────────────────────────────────────────────────────────

  function exportCsv() {
    const headers = [
      "name", "role", "company", "city", "country",
      "relationship_strength", "contact_quality", "how_you_know_them", "topics",
      "last_meaningful_contact", "notes", "email", "linkedin_url",
      "follow_up", "follow_up_note",
    ];
    const rows = contacts.map((c) =>
      headers.map((h) => {
        const val = c[h as keyof Contact];
        if (Array.isArray(val)) return `"${val.join(", ")}"`;
        if (val == null) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
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

  const text_fields: [string, string][] = [
    ["name", "Name *"], ["role", "Role"], ["company", "Company"],
    ["city", "City"], ["country", "Country"], ["email", "Email"],
    ["linkedin_url", "LinkedIn URL"], ["how_you_know_them", "How you know them"],
  ];

  if (loading) {
    return <div className="max-w-4xl mx-auto px-6 py-16 text-zinc-500">Loading contacts...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-zinc-500 text-sm mt-1">{contacts.length} people in your network</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {contacts.length > 0 && (
            <button onClick={exportCsv} className="text-xs px-3 py-2 border border-zinc-200 rounded-md text-zinc-500 hover:text-zinc-800 hover:border-zinc-400">
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

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="border border-zinc-300 rounded-lg p-5 mb-6 space-y-3 bg-zinc-50">
          <p className="text-sm font-medium text-zinc-700">New contact</p>
          <div className="grid grid-cols-2 gap-3">
            {text_fields.map(([field, label]) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">{label}</span>
                <input
                  type="text"
                  value={addDraft[field as keyof typeof addDraft] as string}
                  onChange={(e) => setAddDraft((d) => ({ ...d, [field]: e.target.value }))}
                  className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
                />
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Last contact</span>
              <input type="date" value={addDraft.last_meaningful_contact}
                onChange={(e) => setAddDraft((d) => ({ ...d, last_meaningful_contact: e.target.value }))}
                className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Relationship strength</span>
              <select value={addDraft.relationship_strength}
                onChange={(e) => setAddDraft((d) => ({ ...d, relationship_strength: e.target.value }))}
                className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
              >
                <option value="">—</option>
                <option value="strong">Strong</option>
                <option value="medium">Medium</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Contact quality</span>
              <select value={addDraft.contact_quality}
                onChange={(e) => setAddDraft((d) => ({ ...d, contact_quality: e.target.value as "" | "1" | "2" | "3" }))}
                className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
              >
                <option value="">— unreviewed</option>
                <option value="3">★★★ Real relationship</option>
                <option value="2">★★☆ Weak tie</option>
                <option value="1">★☆☆ Noise</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Topics (comma-separated)</span>
              <input type="text" value={addDraft.topics.join(", ")}
                onChange={(e) => setAddDraft((d) => ({ ...d, topics: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) }))}
                className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Notes</span>
            <textarea value={addDraft.notes} onChange={(e) => setAddDraft((d) => ({ ...d, notes: e.target.value }))}
              rows={2} className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300 w-full"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={addDraft.follow_up}
              onChange={(e) => setAddDraft((d) => ({ ...d, follow_up: e.target.checked }))}
              className="rounded"
            />
            Needs follow-up
          </label>
          {addDraft.follow_up && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Follow-up note</span>
              <input type="text" value={addDraft.follow_up_note}
                onChange={(e) => setAddDraft((d) => ({ ...d, follow_up_note: e.target.value }))}
                placeholder="e.g. said let's catch up at the Summit"
                className="px-2 py-1.5 border border-zinc-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
            </label>
          )}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={adding || !addDraft.name.trim()}
              className="px-4 py-1.5 bg-zinc-900 text-white text-sm rounded hover:bg-zinc-700 disabled:opacity-50">
              {adding ? "Adding…" : "Add contact"}
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setAddDraft({ ...EMPTY_DRAFT }); }}
              className="px-4 py-1.5 border border-zinc-200 text-sm rounded hover:bg-zinc-100">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Stats bar */}
      {contacts.length > 0 && (
        <div className="flex flex-wrap gap-4 text-sm text-zinc-500 mb-4 pb-4 border-b border-zinc-100">
          <span>{contacts.length} contacts</span>
          <span>{strong_count} strong</span>
          <span>{city_count} {city_count === 1 ? "city" : "cities"}</span>
          {follow_up_count > 0 && <span>{follow_up_count} follow-ups pending</span>}
          {top_topics.length > 0 && <span>top topics: {top_topics.join(", ")}</span>}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setShowFollowUpOnly(false)}
          className={`text-xs px-3 py-1.5 rounded-full border ${!showFollowUpOnly ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-200 text-zinc-500 hover:border-zinc-400"}`}
        >
          All
        </button>
        <button
          onClick={() => setShowFollowUpOnly(true)}
          className={`text-xs px-3 py-1.5 rounded-full border ${showFollowUpOnly ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-200 text-zinc-500 hover:border-zinc-400"}`}
        >
          Follow-ups {follow_up_count > 0 && `(${follow_up_count})`}
        </button>
      </div>

      <div className="space-y-3">
        {filtered.map((contact) =>
          editingId === contact.id ? (
            // ── Inline edit form ──────────────────────────────────────────
            <div key={contact.id} className="border border-zinc-400 rounded-lg p-5 space-y-3">
              <p className="text-sm font-medium text-zinc-700 mb-1">Editing {contact.name}</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ["name", "Name"], ["role", "Role"], ["company", "Company"],
                  ["city", "City"], ["country", "Country"], ["email", "Email"],
                  ["linkedin_url", "LinkedIn URL"], ["how_you_know_them", "How you know them"],
                ] as [keyof Contact, string][]).map(([field, label]) => (
                  <label key={field} className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">{label}</span>
                    <input type="text" value={(editDraft[field] as string) ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, [field]: e.target.value }))}
                      className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                    />
                  </label>
                ))}
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">Last contact</span>
                  <input type="date" value={(editDraft.last_meaningful_contact as string) ?? ""}
                    onChange={(e) => setEditDraft((d) => ({ ...d, last_meaningful_contact: e.target.value }))}
                    className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">Relationship strength</span>
                  <select value={editDraft.relationship_strength ?? ""}
                    onChange={(e) => setEditDraft((d) => ({ ...d, relationship_strength: e.target.value || null }))}
                    className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  >
                    <option value="">—</option>
                    <option value="strong">Strong</option>
                    <option value="medium">Medium</option>
                    <option value="light">Light</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">Contact quality</span>
                  <select value={editDraft.contact_quality ?? ""}
                    onChange={(e) => setEditDraft((d) => ({ ...d, contact_quality: e.target.value ? parseInt(e.target.value) : null }))}
                    className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  >
                    <option value="">— unreviewed</option>
                    <option value="3">★★★ Real relationship</option>
                    <option value="2">★★☆ Weak tie</option>
                    <option value="1">★☆☆ Noise</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">Topics (comma-separated)</span>
                  <input type="text" value={editDraft.topics?.join(", ") ?? ""}
                    onChange={(e) => setEditDraft((d) => ({ ...d, topics: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) }))}
                    className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">Notes</span>
                <textarea value={(editDraft.notes as string) ?? ""}
                  onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                  rows={2} className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 w-full"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input type="checkbox" checked={editDraft.follow_up ?? false}
                  onChange={(e) => setEditDraft((d) => ({ ...d, follow_up: e.target.checked }))}
                  className="rounded"
                />
                Needs follow-up
              </label>
              {editDraft.follow_up && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">Follow-up note</span>
                  <input type="text" value={(editDraft.follow_up_note as string) ?? ""}
                    onChange={(e) => setEditDraft((d) => ({ ...d, follow_up_note: e.target.value }))}
                    placeholder="e.g. said let's catch up at the Summit"
                    className="px-2 py-1.5 border border-zinc-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                </label>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={saveEdit} disabled={saving}
                  className="px-4 py-1.5 bg-zinc-900 text-white text-sm rounded hover:bg-zinc-700 disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={cancelEdit} className="px-4 py-1.5 border border-zinc-200 text-sm rounded hover:bg-zinc-50">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            // ── Read-only card ────────────────────────────────────────────
            <div key={contact.id} className={`border rounded-lg p-4 ${contact.follow_up ? "border-amber-200 bg-amber-50/30" : "border-zinc-200"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{contact.name}</h3>
                    {contact.follow_up && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        follow up
                      </span>
                    )}
                    <QualityStars value={contact.contact_quality} onChange={(v) => setQuality(contact, v)} />
                  </div>
                  <p className="text-sm text-zinc-600">
                    {[contact.role, contact.company].filter(Boolean).join(" at ")}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {[contact.city, contact.country].filter(Boolean).join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    contact.relationship_strength === "strong" ? "bg-green-100 text-green-700"
                    : contact.relationship_strength === "medium" ? "bg-yellow-100 text-yellow-700"
                    : "bg-zinc-100 text-zinc-600"
                  }`}>
                    {contact.relationship_strength || "—"}
                  </span>
                  <button onClick={() => toggleFollowUp(contact)}
                    className={`text-xs px-2 py-1 rounded hover:bg-zinc-100 ${contact.follow_up ? "text-amber-600" : "text-zinc-400 hover:text-zinc-700"}`}
                    title={contact.follow_up ? "Clear follow-up" : "Mark for follow-up"}
                  >
                    {contact.follow_up ? "✓ FU" : "FU"}
                  </button>
                  <button onClick={() => startEdit(contact)} className="text-xs text-zinc-400 hover:text-zinc-700 px-2 py-1 rounded hover:bg-zinc-100">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(contact.id, contact.name)} className="text-xs text-zinc-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>

              {contact.follow_up_note && (
                <p className="text-xs text-amber-700 mt-1.5 italic">
                  ↳ {contact.follow_up_note}
                </p>
              )}

              {contact.how_you_know_them && (
                <p className="text-sm text-zinc-500 mt-2">{contact.how_you_know_them}</p>
              )}

              {contact.topics && contact.topics.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {contact.topics.map((topic) => (
                    <button key={topic} onClick={() => setSearch(topic)}
                      className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded hover:bg-zinc-200 cursor-pointer">
                      {topic}
                    </button>
                  ))}
                </div>
              )}

              {contact.notes && (
                <p className="text-sm text-zinc-400 mt-2 italic">{contact.notes}</p>
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
              : showFollowUpOnly
              ? "No pending follow-ups."
              : "No contacts match your filter."}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ContactsPage() {
  return (
    <Suspense>
      <ContactsPageInner />
    </Suspense>
  );
}
