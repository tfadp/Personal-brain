"use client";

import { useState, useEffect, useRef } from "react";
import { Signal } from "@/lib/types";

interface SignalResult extends Signal {
  relevance?: string;
}

export default function SignalPage() {
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    type: "success" | "error";
    message: string;
    signal?: Signal;
  } | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — Vercel body limit
    if (file.size > MAX_BYTES) {
      setSaveStatus({ type: "error", message: "File too large (max 4 MB). Paste the text directly for larger documents." });
      return;
    }
    const allowed = ["application/pdf", "text/plain", "text/markdown"];
    if (!allowed.includes(file.type) && !file.name.endsWith(".md")) {
      setSaveStatus({ type: "error", message: "Only PDF, .txt, and .md files are supported." });
      return;
    }
    setAttachedFile(file);
    setSaveStatus(null);
  }

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
    if (!input.trim() && !attachedFile) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      let body: Record<string, string | undefined>;

      if (attachedFile) {
        // Read file as base64
        const file_data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]); // strip data:...;base64, prefix
          };
          reader.onerror = reject;
          reader.readAsDataURL(attachedFile);
        });
        body = {
          file_data,
          file_type: attachedFile.type || (attachedFile.name.endsWith(".md") ? "text/markdown" : "text/plain"),
          file_name: attachedFile.name,
          context: input.trim() || undefined,
        };
      } else {
        body = { raw_input: input };
      }

      const res = await fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveStatus({ type: "success", message: "Saved", signal: data.signal });
        setRecent((prev) => [data.signal, ...prev]);
        setInput("");
        setAttachedFile(null);
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
          placeholder={attachedFile ? "Add context (optional)..." : "Paste anything..."}
          rows={attachedFile ? 2 : 6}
          className="w-full px-4 py-3 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
        />

        {/* Attached file pill */}
        {attachedFile && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg">
            <span className="text-xs text-zinc-500">
              {attachedFile.type === "application/pdf" ? "PDF" : "TXT"}
            </span>
            <span className="text-sm text-zinc-700 flex-1 truncate">{attachedFile.name}</span>
            <button
              type="button"
              onClick={() => setAttachedFile(null)}
              className="text-zinc-400 hover:text-zinc-700 text-lg leading-none"
              aria-label="Remove file"
            >
              &times;
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-3">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 border border-zinc-200 hover:border-zinc-400 px-3 py-1.5 rounded-lg"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              Attach file
            </button>
            <p className="text-xs text-zinc-400 hidden sm:block">PDF, .txt, .md — max 4 MB</p>
          </div>
          <button
            type="submit"
            disabled={saving || (!input.trim() && !attachedFile)}
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
