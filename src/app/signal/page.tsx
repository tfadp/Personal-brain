"use client";

import { useState, useEffect } from "react";
import { Signal } from "@/lib/types";

interface SignalResult extends Signal {
  relevance?: string;
}

export default function SignalPage() {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    type: "success" | "error";
    message: string;
    signal?: Signal;
  } | null>(null);

  const [query, setQuery] = useState("");
  const [querying, setQuerying] = useState(false);
  const [results, setResults] = useState<SignalResult[]>([]);
  const [searched, setSearched] = useState(false);

  const [recent, setRecent] = useState<Signal[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  useEffect(() => {
    fetch("/api/signal")
      .then((r) => r.json())
      .then((d) => {
        setRecent(d.signals || []);
        setLoadingRecent(false);
      })
      .catch(() => setLoadingRecent(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_input: input }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveStatus({
          type: "success",
          message: "Saved",
          signal: data.signal,
        });
        // Prepend to recent feed
        setRecent((prev) => [data.signal, ...prev]);
        setInput("");
      } else {
        setSaveStatus({ type: "error", message: data.error });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setQuerying(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/signal?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.signals || []);
    } finally {
      setQuerying(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">

      {/* Header */}
      <div className="mb-12">
        <h1 className="text-3xl font-semibold mb-2">Signal</h1>
        <p className="text-zinc-500">
          Paste anything — article, newsletter, idea, tweet. Your brain digests it.
        </p>
      </div>

      {/* ── Save input ─────────────────────────────────────────────────── */}
      <form onSubmit={handleSave} className="mb-10">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste anything..."
          rows={6}
          className="w-full px-4 py-3 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
        />
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-zinc-400">
            Claude will summarize and tag it. The original is kept as a footnote.
          </p>
          <button
            type="submit"
            disabled={saving || !input.trim()}
            className="px-6 py-2.5 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
          >
            {saving ? "Processing..." : "Save to brain"}
          </button>
        </div>
      </form>

      {/* Save result */}
      {saveStatus && (
        <div
          className={`mb-8 p-4 rounded-lg border ${
            saveStatus.type === "success"
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }`}
        >
          {saveStatus.type === "success" && saveStatus.signal ? (
            <div>
              <p className="text-green-800 text-sm font-medium mb-2">
                Saved — here&apos;s what your brain extracted:
              </p>
              <p className="text-green-900 text-sm mb-2">
                {saveStatus.signal.summary}
              </p>
              {saveStatus.signal.topics && (
                <div className="flex flex-wrap gap-1">
                  {saveStatus.signal.topics.map((t) => (
                    <span
                      key={t}
                      className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-red-800 text-sm">{saveStatus.message}</p>
          )}
        </div>
      )}

      {/* ── Query ──────────────────────────────────────────────────────── */}
      <div className="border-t border-zinc-100 pt-10 mb-10">
        <p className="text-sm font-medium text-zinc-700 mb-3">
          Query your knowledge
        </p>
        <form onSubmit={handleQuery}>
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What do I know about AI and sports media distribution?"
              className="flex-1 px-4 py-3 border border-zinc-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
            <button
              type="submit"
              disabled={querying || !query.trim()}
              className="px-6 py-3 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              {querying ? "Thinking..." : "Ask"}
            </button>
          </div>
        </form>

        {querying && (
          <p className="text-zinc-500 text-sm text-center py-8">
            Searching your brain...
          </p>
        )}

        {!querying && searched && results.length === 0 && (
          <p className="text-zinc-500 text-sm text-center py-8">
            Nothing saved on that topic yet.
          </p>
        )}

        {!querying && results.length > 0 && (
          <div className="space-y-4 mt-6">
            {results.map((r) => (
              <div key={r.id} className="border border-zinc-200 rounded-lg p-5">
                <p className="text-sm text-zinc-900 mb-2">{r.summary}</p>

                {r.topics && r.topics.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {r.topics.map((t) => (
                      <span
                        key={t}
                        className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {r.relevance && (
                  <p className="text-sm text-zinc-700 bg-zinc-50 px-3 py-2 rounded mt-2">
                    {r.relevance}
                  </p>
                )}

                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-zinc-400">
                    {r.source_title || "No title"}
                    {" · "}
                    {new Date(r.captured_at).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </p>
                  {r.source_url && (
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-zinc-400 hover:text-zinc-700 underline"
                    >
                      Source ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Recent feed ────────────────────────────────────────────────── */}
      <div className="border-t border-zinc-100 pt-10">
        <p className="text-sm font-medium text-zinc-700 mb-4">
          Recently saved
        </p>

        {loadingRecent && (
          <p className="text-zinc-400 text-sm">Loading...</p>
        )}

        {!loadingRecent && recent.length === 0 && (
          <p className="text-zinc-400 text-sm">
            Nothing saved yet. Paste something above to get started.
          </p>
        )}

        {!loadingRecent && recent.length > 0 && (
          <div className="space-y-3">
            {recent.map((s) => (
              <div key={s.id} className="border border-zinc-100 rounded-lg p-4">
                <p className="text-sm text-zinc-800">{s.summary}</p>
                {s.topics && s.topics.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {s.topics.map((t) => (
                      <span
                        key={t}
                        className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-zinc-400 mt-2">
                  {s.source_title && `${s.source_title} · `}
                  {new Date(s.captured_at).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
