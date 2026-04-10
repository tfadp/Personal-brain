"use client";

import { useState, useRef } from "react";
import { Contact, Signal } from "@/lib/types";

type ResultType =
  | { type: "contacts"; results: (Contact & { relevance?: string })[] }
  | { type: "signals"; results: (Signal & { relevance?: string })[] }
  | { type: "ingested"; signal: Signal }
  | { type: "updated"; action: string; contact: Contact }
  | { type: "updated_bulk"; updated: string[]; not_found: string[]; action: string }
  | { type: "added"; action?: string; contact: Contact }
  | { type: "added_bulk"; contacts: Contact[]; action: string }
  | { type: "clarify"; message: string; candidates: Pick<Contact, "id" | "name" | "company" | "city">[] }
  | { type: "error"; message: string };

const EXAMPLES = [
  "Who do I know in sports media?",
  "What have I saved about creator monetization?",
  "Follow up with Sarah — said let's catch up",
  "https://youtube.com/watch?v=...",
];

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ResultType | null>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [pending_input, setPendingInput] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setAttachedFile(file);
    if (result) setResult(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() && !attachedFile) return;
    setLoading(true);
    setStatus("Thinking...");
    setResult(null);
    try {
      let body: Record<string, string | undefined>;

      if (attachedFile) {
        const file_data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(attachedFile);
        });
        body = {
          file_data,
          file_type: attachedFile.type || "image/jpeg",
          file_name: attachedFile.name,
        };
      } else {
        body = { input };
      }

      const res = await fetch("/api/unified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Read SSE stream — status messages arrive first, result arrives last
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete last line
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "status") {
              setStatus(data.message);
            } else {
              setResult(data);
              setStatus(null);
            }
          } catch { /* partial chunk */ }
        }
      }

      setPendingInput(input);
      setInput("");
      setAttachedFile(null);
    } catch {
      setResult({ type: "error", message: "Something went wrong. Try again." });
      setStatus(null);
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }

  async function handleClarifySelect(contact_id: string) {
    if (!pending_input) return;
    setLoading(true);
    setStatus("Updating contact...");
    setResult(null);
    try {
      const res = await fetch("/api/unified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: pending_input, contact_id }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "status") { setStatus(data.message); }
            else { setResult(data); setStatus(null); }
          } catch { /* partial chunk */ }
        }
      }
      setPendingInput("");
    } catch {
      setResult({ type: "error", message: "Something went wrong. Try again." });
      setStatus(null);
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">

      <div className="mb-10">
        <h1 className="text-3xl font-semibold mb-2">Cortex</h1>
        <p className="text-zinc-400 text-sm">
          Ask anything. Save anything. Update anyone.
        </p>
      </div>

      {/* ── Single input ─────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="mb-6">
        <textarea
          value={input}
          onChange={(e) => { setInput(e.target.value); if (result) setResult(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Ask, save, or update..."
          rows={3}
          className="w-full px-4 py-3 border border-zinc-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
        />

        {/* Attached screenshot pill */}
        {attachedFile && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm text-zinc-700 flex-1 truncate">{attachedFile.name}</span>
            <button type="button" onClick={() => setAttachedFile(null)} className="text-zinc-400 hover:text-zinc-700 text-lg leading-none">&times;</button>
          </div>
        )}

        <div className="flex items-center justify-between mt-3">
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 border border-zinc-200 hover:border-zinc-400 px-3 py-1.5 rounded-lg"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Screenshot
            </button>
          </div>
          <button
            type="submit"
            disabled={loading || (!input.trim() && !attachedFile)}
            className="px-6 py-2.5 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
          >
            {loading ? "Thinking..." : "Go"}
          </button>
        </div>
      </form>

      {/* ── Examples ─────────────────────────────────────────────────── */}
      {!result && (
        <div className="mb-8">
          <p className="text-xs text-zinc-400 mb-2">Try</p>
          <div className="space-y-1.5">
            {EXAMPLES.slice(0, 3).map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setInput(ex)}
                className="block w-full text-left text-sm text-zinc-400 hover:text-zinc-700 px-3 py-2 rounded-lg hover:bg-zinc-50 border border-transparent hover:border-zinc-200"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Status ───────────────────────────────────────────────────── */}
      {status && (
        <p className="text-sm text-zinc-400 text-center py-4 animate-pulse">{status}</p>
      )}

      {/* ── Results ──────────────────────────────────────────────────── */}
      {result && (

        <div className="mt-2">

          {/* Error */}
          {result.type === "error" && (
            <p className="text-red-600 text-sm">{result.message}</p>
          )}

          {/* Ingested signal */}
          {result.type === "ingested" && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 text-sm font-medium mb-2">Saved to your brain</p>
              <p className="text-green-900 text-sm mb-2">{result.signal.summary}</p>
              {result.signal.topics && (
                <div className="flex flex-wrap gap-1">
                  {result.signal.topics.map((t) => (
                    <span key={t} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Updated contact */}
          {result.type === "updated" && (
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg">
              <p className="text-zinc-700 text-sm">✓ {result.action}</p>
            </div>
          )}

          {/* Bulk updated contacts */}
          {result.type === "updated_bulk" && (
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg">
              <p className="text-zinc-700 text-sm font-medium mb-2">✓ {result.action}</p>
              {result.not_found.length > 0 && (
                <p className="text-xs text-amber-600 mt-1">Not found: {result.not_found.join(", ")}</p>
              )}
            </div>
          )}

          {/* Added contact */}
          {result.type === "added" && (
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg">
              <p className="text-zinc-700 text-sm font-medium">✓ {result.action ?? `Added ${result.contact.name}`}</p>
              {(result.contact.role || result.contact.company) && (
                <p className="text-zinc-500 text-sm">
                  {[result.contact.role, result.contact.company].filter(Boolean).join(" at ")}
                </p>
              )}
            </div>
          )}

          {/* Bulk added contacts */}
          {result.type === "added_bulk" && (
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg">
              <p className="text-zinc-700 text-sm font-medium mb-3">✓ {result.action}</p>
              <div className="space-y-1">
                {result.contacts.map((c, i) => (
                  <div key={c.id ?? i} className="flex items-baseline gap-2">
                    <span className="text-sm text-zinc-800">{c.name}</span>
                    {(c.role || c.company) && (
                      <span className="text-xs text-zinc-400">{[c.role, c.company].filter(Boolean).join(" at ")}</span>
                    )}
                    {c.email && <span className="text-xs text-zinc-400">{c.email}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clarify — multiple contacts matched */}
          {result.type === "clarify" && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-amber-800 text-sm font-medium mb-3">{result.message}</p>
              <div className="space-y-2">
                {result.candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleClarifySelect(c.id)}
                    className="block w-full text-left px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm hover:border-amber-400"
                  >
                    <span className="font-medium">{c.name}</span>
                    {(c.company || c.city) && (
                      <span className="text-zinc-400 ml-2">
                        {[c.company, c.city].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Contact query results */}
          {result.type === "contacts" && result.results.length === 0 && (
            <p className="text-zinc-500 text-sm">No relevant contacts found.</p>
          )}
          {result.type === "contacts" && result.results.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400 mb-3">{result.results.length} contacts</p>
              {result.results.map((c, i) => (
                <div key={c.id || i} className={`border rounded-lg p-4 ${c.follow_up ? "border-amber-200 bg-amber-50/30" : "border-zinc-200"}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{c.name}</h3>
                        {c.follow_up && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">follow up</span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-600">
                        {[c.role, c.company].filter(Boolean).join(" at ")}
                      </p>
                      {(c.city || c.country) && (
                        <p className="text-sm text-zinc-400">
                          {[c.city, c.country].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${
                        c.relationship_strength === "strong" ? "bg-green-100 text-green-700"
                        : c.relationship_strength === "medium" ? "bg-yellow-100 text-yellow-700"
                        : "bg-zinc-100 text-zinc-500"
                      }`}>
                        {c.relationship_strength || "—"}
                      </span>
                      <a
                        href={`/contacts?edit=${c.id}`}
                        className="text-xs text-zinc-400 hover:text-zinc-700 border border-zinc-200 hover:border-zinc-400 px-2 py-1 rounded"
                      >
                        Edit
                      </a>
                    </div>
                  </div>
                  {c.follow_up_note && (
                    <p className="text-xs text-amber-700 mt-1.5 italic">↳ {c.follow_up_note}</p>
                  )}
                  {c.how_you_know_them && (
                    <p className="text-sm text-zinc-500 mt-2">{c.how_you_know_them}</p>
                  )}
                  {c.topics && c.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {c.topics.map((t) => (
                        <span key={t} className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  )}
                  {c.relevance && (
                    <p className="text-sm text-zinc-700 mt-2 bg-zinc-50 px-3 py-2 rounded">{c.relevance}</p>
                  )}
                  {c.last_meaningful_contact && (
                    <p className="text-xs text-zinc-400 mt-2">Last contact: {c.last_meaningful_contact}</p>
                  )}
                  {c.notes && (
                    <p className="text-sm text-zinc-400 mt-1 italic">{c.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Signal query results */}
          {result.type === "signals" && result.results.length === 0 && (
            <p className="text-zinc-500 text-sm">Nothing saved on that topic yet.</p>
          )}
          {result.type === "signals" && result.results.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400 mb-3">{result.results.length} items from your brain</p>
              {result.results.map((s) => (
                <div key={s.id} className="border border-zinc-200 rounded-lg p-4">
                  <p className="text-sm text-zinc-900 mb-2">{s.summary}</p>
                  {s.topics && s.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {s.topics.map((t) => (
                        <span key={t} className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  )}
                  {s.relevance && (
                    <p className="text-sm text-zinc-700 bg-zinc-50 px-3 py-2 rounded mt-2">{s.relevance}</p>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-xs text-zinc-400">
                      {s.source_title && `${s.source_title} · `}
                      {new Date(s.captured_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                    {s.source_url && (
                      <a href={s.source_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-zinc-400 hover:text-zinc-700 underline">
                        Source ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
