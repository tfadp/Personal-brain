"use client";

import { useState } from "react";

interface QueryResult {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  city: string | null;
  country: string | null;
  relationship_strength: string | null;
  how_you_know_them: string | null;
  topics: string[] | null;
  last_meaningful_contact: string | null;
  notes: string | null;
  relevance: string;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Update command state
  const [command, setCommand] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  async function runQuery(text: string) {
    if (!text.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    await runQuery(query);
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!command.trim()) return;
    setUpdating(true);
    setUpdateStatus(null);
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      if (res.ok) {
        setUpdateStatus({ type: "success", message: data.action });
        setCommand("");
      } else {
        setUpdateStatus({ type: "error", message: data.error });
      }
    } catch {
      setUpdateStatus({ type: "error", message: "Update failed. Try again." });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-12">
        <h1 className="text-3xl font-semibold mb-2">Cortex</h1>
        <p className="text-zinc-500">
          Query your network in natural language.
        </p>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          "Who haven't I spoken to in a while?",
          "Who are my strongest connections?",
          "Who do I know in venture capital?",
        ].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setQuery(preset);
              runQuery(preset);
            }}
            className="text-xs px-3 py-1.5 border border-zinc-200 rounded-full text-zinc-500 hover:border-zinc-400 hover:text-zinc-800"
          >
            {preset}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearch} className="mb-10">
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Who do I know in London around sports investment?"
            className="flex-1 px-4 py-3 border border-zinc-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      {loading && (
        <div className="text-center text-zinc-500 py-8">
          Querying your network...
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center text-zinc-500 py-8">
          No relevant contacts found for that query.
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-4 mb-16">
          {results.map((result, i) => (
            <div
              key={result.id || i}
              className="border border-zinc-200 rounded-lg p-5"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-lg">
                    {result.name}
                    {result.city && (
                      <span className="text-zinc-400 text-sm font-normal ml-2">
                        {result.city}
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-zinc-600">
                    {[result.role, result.company].filter(Boolean).join(" at ")}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${
                    result.relationship_strength === "strong"
                      ? "bg-green-100 text-green-700"
                      : result.relationship_strength === "medium"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {result.relationship_strength || "—"}
                </span>
              </div>

              {result.how_you_know_them && (
                <p className="text-sm text-zinc-500 mt-2">
                  {result.how_you_know_them}
                </p>
              )}

              {result.topics && result.topics.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {result.topics.map((topic) => (
                    <span
                      key={topic}
                      className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              )}

              {result.last_meaningful_contact && (
                <p className="text-xs text-zinc-400 mt-2">
                  Last contact: {result.last_meaningful_contact}
                </p>
              )}

              {result.notes && (
                <p className="text-sm text-zinc-500 mt-2 italic">
                  &ldquo;{result.notes}&rdquo;
                </p>
              )}

              {result.relevance && (
                <p className="text-sm text-zinc-700 mt-3 bg-zinc-50 p-2 rounded">
                  {result.relevance}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Update ─────────────────────────────────────────────────────── */}
      <div className="border-t border-zinc-100 pt-10">
        <p className="text-sm font-medium text-zinc-700 mb-1">Update a contact</p>
        <p className="text-xs text-zinc-400 mb-3">
          Examples: &ldquo;add note to Sarah Chen — met at conference&rdquo; · &ldquo;update John's last contact to today&rdquo; · &ldquo;change Maria's strength to strong&rdquo;
        </p>
        <form onSubmit={handleUpdate}>
          <div className="flex gap-3">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="add note to [name] — [your note]"
              className="flex-1 px-4 py-3 border border-zinc-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
            <button
              type="submit"
              disabled={updating || !command.trim()}
              className="px-6 py-3 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              {updating ? "Updating..." : "Update"}
            </button>
          </div>
        </form>

        {updateStatus && (
          <div
            className={`mt-3 px-4 py-3 rounded-lg text-sm ${
              updateStatus.type === "success"
                ? "bg-green-50 text-green-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            {updateStatus.type === "success" ? "✓ " : "✗ "}
            {updateStatus.message}
          </div>
        )}
      </div>
    </div>
  );
}
