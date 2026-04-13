"use client";

import { useState, useRef, useEffect } from "react";
import { Contact, Signal, Interaction } from "@/lib/types";

type ResultType =
  | { type: "contacts"; results: (Contact & { relevance?: string })[] }
  | { type: "signals"; results: (Signal & { relevance?: string })[] }
  | { type: "ingested"; signal: Signal }
  | { type: "updated"; action: string; contact: Contact }
  | { type: "updated_bulk"; updated: string[]; not_found: string[]; action: string }
  | { type: "combined"; core_thesis: string; point_of_view: string[]; implications: string[]; tensions: string[]; missing_information: string[]; takeaway: string; hot_take: string; next_move: string; signals: (Signal & { relevance?: string })[]; contacts: (Contact & { relevance?: string })[] }
  | { type: "added"; action?: string; contact: Contact }
  | { type: "added_bulk"; contacts: Contact[]; action: string }
  | { type: "logged"; action: string; contact: Contact; interaction: Interaction }
  | { type: "clarify"; message: string; candidates: Pick<Contact, "id" | "name" | "company" | "city">[] }
  | { type: "error"; message: string };

const RAMBLE_LINES = [
  "Leaves are fallin' all around",
  "It's time I was on my way",
  "Thanks to you, I'm much obliged",
  "For such a pleasant stay",
  "But now it's time for me to go",
  "The autumn moon lights my way",
  "For now, I smell the rain, and with it, pain",
  "And it's headed my way",
  "Ah, sometimes I grow so tired",
  "But I know I've got one thing I've got to do",
  "Ramble on",
  "And now's the time, the time is now",
  "Sing my song",
  "I'm goin' 'round the world, I gotta find my girl",
  "On my way",
  "I've been this way ten years to the day",
  "I'm gonna ramble on",
  "Gotta find the queen of all my dreams",
];

const EXAMPLES = [
  "Who do I know in sports media?",
  "Had coffee with Anamitra — talked about AI media",
  "What have I saved about creator monetization?",
  "Follow up with Sarah — said let's catch up",
];

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ResultType | null>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [pending_input, setPendingInput] = useState<string>("");
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [ramble_index, setRambleIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cycle through lyrics while loading — start from a random line immediately
  useEffect(() => {
    if (!loading) return;
    setRambleIndex(Math.floor(Math.random() * RAMBLE_LINES.length));
    const interval = setInterval(() => {
      setRambleIndex((i) => (i + 1) % RAMBLE_LINES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [loading]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Fetch interaction history when a single contact result is shown
  useEffect(() => {
    let contact_id: string | null = null;
    if (result?.type === "logged") contact_id = result.contact.id;
    else if (result?.type === "updated") contact_id = result.contact.id;
    else if (result?.type === "contacts" && result.results.length === 1) contact_id = result.results[0].id;
    if (!contact_id) { setInteractions([]); return; }
    fetch(`/api/interactions?contact_id=${contact_id}`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setInteractions(Array.isArray(d) ? d : []))
      .catch(() => setInteractions([]));
  }, [result]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setAttachedFile(file);
    if (result) setResult(null);
  }

  async function send(body: Record<string, string | undefined>) {
    setLoading(true);
    setStatus("Thinking...");
    setResult(null);
    try {
      const res = await fetch("/api/unified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
            if (data.type === "status") setStatus(data.message);
            else { setResult(data); setStatus(null); }
          } catch { /* partial chunk */ }
        }
      }
    } catch {
      setResult({ type: "error", message: "Something went wrong. Try again." });
      setStatus(null);
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() && !attachedFile) return;
    if (attachedFile) {
      const file_data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(attachedFile);
      });
      const detected_type = attachedFile.type
        || (attachedFile.name.endsWith(".md") ? "text/markdown" : "")
        || (attachedFile.name.endsWith(".txt") ? "text/plain" : "")
        || "image/jpeg";
      await send({ file_data, file_type: detected_type, file_name: attachedFile.name });
    } else {
      await send({ input });
    }
    setPendingInput(input);
    setInput("");
    setAttachedFile(null);
  }

  async function handleClarifySelect(contact_id: string) {
    if (!pending_input) return;
    await send({ input: pending_input, contact_id });
    setPendingInput("");
  }

  const has_result = !!result;

  return (
    <div className={`flex-1 flex flex-col ${has_result ? "" : "justify-center"}`}>
      <div className="w-full max-w-2xl mx-auto px-6">

        {/* ── Header — only when empty ────────────────────────────── */}
        {!has_result && !status && (
          <div className="text-center mb-8">
            <h1 className="text-2xl font-light text-zinc-900 mb-2">What&apos;s on your mind?</h1>
            <p className="text-sm text-zinc-600 font-light">
              Ask, save, update, or just think out loud.
            </p>
          </div>
        )}

        {/* ── Input ───────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className={has_result ? "pt-8 pb-4" : "pb-4"}>
          <div className="relative bg-zinc-50 rounded-2xl border border-zinc-200 focus-within:border-zinc-400 focus-within:bg-white transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); if (result) setResult(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Ask, save, or update..."
              rows={1}
              className="w-full bg-transparent px-5 pt-4 pb-12 text-[15px] text-zinc-900 placeholder:text-zinc-600 focus:outline-none resize-none leading-relaxed"
            />
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md,application/pdf,text/plain,text/markdown" onChange={handleFileChange} className="hidden" />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 text-zinc-600 hover:text-zinc-800 rounded-lg hover:bg-zinc-100 transition-colors"
                  title="Attach file (image, PDF, text)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                {attachedFile && (
                  <span className="flex items-center gap-1 text-xs text-zinc-600 bg-zinc-100 px-2 py-1 rounded-lg">
                    {attachedFile.name}
                    <button type="button" onClick={() => setAttachedFile(null)} className="text-zinc-600 hover:text-zinc-800">&times;</button>
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || (!input.trim() && !attachedFile)}
                className="px-4 py-1.5 bg-zinc-900 text-white rounded-xl text-sm font-medium hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-900 transition-colors"
              >
                {loading ? "..." : "Go"}
              </button>
            </div>
          </div>
        </form>

        {/* ── Examples — only when empty ──────────────────────────── */}
        {!has_result && !status && (
          <div className="flex flex-wrap gap-2 justify-center mt-2 mb-12">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setInput(ex)}
                className="text-xs text-zinc-600 hover:text-zinc-800 px-3 py-1.5 rounded-full border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {/* ── Status ─────────────────────────────────────────────── */}
        {status && (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm text-zinc-600 animate-pulse">{status}</p>
            {loading && (
              <p className="text-xs text-zinc-400 italic transition-opacity duration-500">
                {RAMBLE_LINES[ramble_index]}
              </p>
            )}
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────── */}
        {result && (
          <div className="pb-16">

            {/* Error */}
            {result.type === "error" && (
              <p className="text-red-500 text-sm">{result.message}</p>
            )}

            {/* Ingested signal */}
            {result.type === "ingested" && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                <p className="text-green-800 text-sm font-medium mb-1">Saved to your brain</p>
                <p className="text-green-900 text-sm">{result.signal.summary}</p>
                {result.signal.topics && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {result.signal.topics.map((t) => (
                      <span key={t} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Updated contact */}
            {result.type === "updated" && (
              <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
                <p className="text-zinc-800 text-sm">✓ {result.action}</p>
              </div>
            )}

            {/* Logged interaction */}
            {result.type === "logged" && (
              <div className="space-y-3">
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                  <p className="text-green-800 text-sm font-medium">✓ {result.action}</p>
                  {result.interaction.summary && (
                    <p className="text-green-900 text-sm mt-1">{result.interaction.summary}</p>
                  )}
                  {result.interaction.topics && result.interaction.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {result.interaction.topics.map((t) => (
                        <span key={t} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-600">
                  <span>{result.contact.name}</span>
                  {result.contact.company && <><span>·</span><span>{result.contact.company}</span></>}
                  <a href={`/contacts?edit=${result.contact.id}`} className="text-zinc-600 hover:text-zinc-800 underline ml-auto">View contact</a>
                </div>
              </div>
            )}

            {/* Bulk updated contacts */}
            {result.type === "updated_bulk" && (
              <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
                <p className="text-zinc-800 text-sm font-medium mb-2">✓ {result.action}</p>
                {result.not_found.length > 0 && (
                  <p className="text-xs text-amber-600">Not found: {result.not_found.join(", ")}</p>
                )}
              </div>
            )}

            {/* Added contact */}
            {result.type === "added" && (
              <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
                <p className="text-zinc-800 text-sm font-medium">✓ {result.action ?? `Added ${result.contact.name}`}</p>
                {(result.contact.role || result.contact.company) && (
                  <p className="text-zinc-600 text-sm mt-0.5">{[result.contact.role, result.contact.company].filter(Boolean).join(" at ")}</p>
                )}
              </div>
            )}

            {/* Bulk added contacts */}
            {result.type === "added_bulk" && (
              <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
                <p className="text-zinc-800 text-sm font-medium mb-3">✓ {result.action}</p>
                <div className="space-y-1">
                  {result.contacts.map((c, i) => (
                    <div key={c.id ?? i} className="flex items-baseline gap-2">
                      <span className="text-sm text-zinc-900">{c.name}</span>
                      {(c.role || c.company) && <span className="text-xs text-zinc-600">{[c.role, c.company].filter(Boolean).join(" at ")}</span>}
                      {c.email && <span className="text-xs text-zinc-600">{c.email}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clarify */}
            {result.type === "clarify" && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-amber-800 text-sm font-medium mb-3">{result.message}</p>
                <div className="space-y-2">
                  {result.candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleClarifySelect(c.id)}
                      className="block w-full text-left px-3 py-2 bg-white border border-amber-200 rounded-xl text-sm hover:border-amber-400 transition-colors"
                    >
                      <span className="font-medium">{c.name}</span>
                      {(c.company || c.city) && (
                        <span className="text-zinc-600 ml-2">{[c.company, c.city].filter(Boolean).join(", ")}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Combined — brain output */}
            {result.type === "combined" && (
              <div className="space-y-5">
                {result.takeaway && (
                  <p className="text-base font-medium text-zinc-900 leading-snug">{result.takeaway}</p>
                )}
                {result.core_thesis && (
                  <p className="text-sm text-zinc-800 leading-relaxed">{result.core_thesis}</p>
                )}
                {result.point_of_view?.length > 0 && (
                  <ul className="space-y-2">
                    {result.point_of_view.map((p, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-zinc-800">
                        <span className="text-zinc-300 flex-shrink-0">—</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {result.hot_take && (
                  <div className="px-4 py-3 bg-zinc-900 text-white rounded-xl">
                    <p className="text-xs text-zinc-600 uppercase tracking-wide mb-1">Hot take</p>
                    <p className="text-sm leading-relaxed">{result.hot_take}</p>
                  </div>
                )}
                {result.next_move && (
                  <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-xs text-amber-600 uppercase tracking-wide mb-1">Next move</p>
                    <p className="text-sm text-amber-900 leading-relaxed">{result.next_move}</p>
                  </div>
                )}
                {result.contacts.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-600 uppercase tracking-wide">Who to talk to</p>
                    {result.contacts.map((c, i) => (
                      <div key={c.id || i} className="flex items-start gap-3 border border-zinc-200 rounded-xl p-3">
                        <span className="text-xs text-zinc-300 font-mono mt-0.5 w-4 flex-shrink-0">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{c.name}</span>
                            <span className="text-xs text-zinc-600">{[c.role, c.company].filter(Boolean).join(" at ")}</span>
                          </div>
                          {c.relevance && <p className="text-sm text-zinc-600 mt-0.5">{c.relevance}</p>}
                        </div>
                        <a href={`/contacts?edit=${c.id}`} className="text-xs text-zinc-600 hover:text-zinc-800 border border-zinc-200 hover:border-zinc-400 px-2 py-1 rounded-lg flex-shrink-0">Edit</a>
                      </div>
                    ))}
                  </div>
                )}
                {(result.implications?.length > 0 || result.tensions?.length > 0 || result.missing_information?.length > 0) && (
                  <details className="group">
                    <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-800 list-none flex items-center gap-1">
                      <span className="group-open:hidden">▸</span>
                      <span className="hidden group-open:inline">▾</span>
                      Implications, tensions & gaps
                    </summary>
                    <div className="mt-4 space-y-4 pl-3 border-l-2 border-zinc-100">
                      {result.implications?.length > 0 && (
                        <div>
                          <p className="text-xs text-zinc-600 uppercase tracking-wide mb-2">Implications</p>
                          <ul className="space-y-1">{result.implications.map((imp, i) => <li key={i} className="text-sm text-zinc-800 flex gap-2"><span className="text-zinc-300 flex-shrink-0">—</span>{imp}</li>)}</ul>
                        </div>
                      )}
                      {result.tensions?.length > 0 && (
                        <div>
                          <p className="text-xs text-zinc-600 uppercase tracking-wide mb-2">Tensions</p>
                          <ul className="space-y-1">{result.tensions.map((t, i) => <li key={i} className="text-sm text-zinc-800 flex gap-2"><span className="text-zinc-300 flex-shrink-0">—</span>{t}</li>)}</ul>
                        </div>
                      )}
                      {result.missing_information?.length > 0 && (
                        <div>
                          <p className="text-xs text-zinc-600 uppercase tracking-wide mb-2">Missing information</p>
                          <ul className="space-y-1">{result.missing_information.map((m, i) => <li key={i} className="text-sm text-zinc-800 flex gap-2"><span className="text-zinc-300 flex-shrink-0">—</span>{m}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  </details>
                )}
                {result.signals.length > 0 && (
                  <details className="group">
                    <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-800 list-none flex items-center gap-1">
                      <span className="group-open:hidden">▸</span>
                      <span className="hidden group-open:inline">▾</span>
                      {result.signals.length} source{result.signals.length > 1 ? "s" : ""}
                    </summary>
                    <div className="mt-3 space-y-2 pl-3 border-l border-zinc-200">
                      {result.signals.map((s) => (
                        <div key={s.id}>
                          <p className="text-xs text-zinc-600">{s.summary}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {s.source_title && <span className="text-xs text-zinc-600">{s.source_title}</span>}
                            {s.source_url && <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-600 hover:text-zinc-800 underline">↗</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Contact results */}
            {result.type === "contacts" && result.results.length === 0 && (
              <p className="text-zinc-600 text-sm">No relevant contacts found.</p>
            )}
            {result.type === "contacts" && result.results.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-600 mb-3">{result.results.length} contacts</p>
                {result.results.map((c, i) => (
                  <div key={c.id || i} className={`border rounded-xl p-4 ${c.follow_up ? "border-amber-200 bg-amber-50/30" : "border-zinc-200"}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium">{c.name}</h3>
                          {c.follow_up && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">follow up</span>
                          )}
                        </div>
                        <p className="text-sm text-zinc-600">
                          {[c.role, c.company].filter(Boolean).join(" at ")}
                        </p>
                        {(c.city || c.country) && (
                          <p className="text-xs text-zinc-600 mt-0.5">
                            {[c.city, c.country].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          c.relationship_strength === "strong" ? "bg-green-100 text-green-700"
                          : c.relationship_strength === "medium" ? "bg-yellow-100 text-yellow-700"
                          : "bg-zinc-100 text-zinc-600"
                        }`}>
                          {c.relationship_strength || "—"}
                        </span>
                        <a href={`/contacts?edit=${c.id}`} className="text-xs text-zinc-600 hover:text-zinc-800 border border-zinc-200 hover:border-zinc-400 px-2 py-1 rounded-lg">Edit</a>
                      </div>
                    </div>
                    {c.follow_up_note && (
                      <p className="text-xs text-amber-700 mt-1.5 italic">↳ {c.follow_up_note}</p>
                    )}
                    {c.how_you_know_them && (
                      <p className="text-sm text-zinc-600 mt-2">{c.how_you_know_them}</p>
                    )}
                    {c.topics && c.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.topics.map((t) => (
                          <span key={t} className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{t}</span>
                        ))}
                      </div>
                    )}
                    {c.relevance && (
                      <p className="text-sm text-zinc-800 mt-2 bg-zinc-50 px-3 py-2 rounded-lg">{c.relevance}</p>
                    )}
                    {c.last_meaningful_contact && (
                      <p className="text-xs text-zinc-600 mt-2">Last contact: {c.last_meaningful_contact}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Signal results */}
            {result.type === "signals" && result.results.length === 0 && (
              <p className="text-zinc-600 text-sm">Nothing saved on that topic yet.</p>
            )}
            {result.type === "signals" && result.results.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-600 mb-3">{result.results.length} items from your brain</p>
                {result.results.map((s) => (
                  <div key={s.id} className="border border-zinc-200 rounded-xl p-4">
                    <p className="text-sm text-zinc-900 mb-2">{s.summary}</p>
                    {s.topics && s.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {s.topics.map((t) => (
                          <span key={t} className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{t}</span>
                        ))}
                      </div>
                    )}
                    {s.relevance && (
                      <p className="text-sm text-zinc-800 bg-zinc-50 px-3 py-2 rounded-lg mt-2">{s.relevance}</p>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-xs text-zinc-600">
                        {s.source_title && `${s.source_title} · `}
                        {new Date(s.captured_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      {s.source_url && (
                        <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-600 hover:text-zinc-800 underline">Source ↗</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Interaction history */}
            {interactions.length > 0 && (
              <details className="mt-4 group" open={result?.type === "logged"}>
                <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-800 list-none flex items-center gap-1">
                  <span className="group-open:hidden">▸</span>
                  <span className="hidden group-open:inline">▾</span>
                  {interactions.length} interaction{interactions.length > 1 ? "s" : ""} logged
                </summary>
                <div className="mt-3 space-y-2 pl-3 border-l border-zinc-200">
                  {interactions.map((ix) => (
                    <div key={ix.id} className="text-sm">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-zinc-600 flex-shrink-0">{ix.date}</span>
                        <span className="text-zinc-800">{ix.summary ?? ix.raw_content}</span>
                      </div>
                      {ix.topics && ix.topics.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1 ml-16">
                          {ix.topics.map((t) => (
                            <span key={t} className="text-xs bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded-full">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
