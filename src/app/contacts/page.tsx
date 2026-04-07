"use client";

import { useEffect, useState } from "react";
import { Contact } from "@/lib/types";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-zinc-500">
        Loading contacts...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {contacts.length} people in your network
          </p>
        </div>
        <input
          type="text"
          placeholder="Filter..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-zinc-200 rounded-md text-sm w-48 focus:outline-none focus:ring-2 focus:ring-zinc-300"
        />
      </div>

      <div className="space-y-3">
        {filtered.map((contact) => (
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
            </div>

            {contact.how_you_know_them && (
              <p className="text-sm text-zinc-500 mt-2">
                {contact.how_you_know_them}
              </p>
            )}

            {contact.topics && contact.topics.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {contact.topics.map((topic) => (
                  <span
                    key={topic}
                    className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded"
                  >
                    {topic}
                  </span>
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
        ))}

        {filtered.length === 0 && (
          <p className="text-zinc-500 text-center py-8">
            {contacts.length === 0
              ? "No contacts yet. Import a CSV to get started."
              : "No contacts match your filter."}
          </p>
        )}
      </div>
    </div>
  );
}
