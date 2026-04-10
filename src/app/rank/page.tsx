"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Contact } from "@/lib/types";

export default function RankPage() {
  const [queue, setQueue] = useState<Contact[]>([]);
  const [total_unrated, setTotalUnrated] = useState(0);
  const [rated_count, setRatedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((all: Contact[]) => {
        const unrated = all.filter((c) => c.contact_quality == null);
        setQueue(unrated);
        setTotalUnrated(unrated.length);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const current = queue[0] ?? null;

  const rate = useCallback(async (value: number) => {
    if (!current || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, contact_quality: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to save rating. Try again.");
        setSaving(false);
        return;
      }
      setRatedCount((n) => n + 1);
      setQueue((q) => q.slice(1));
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }, [current, saving]);

  const skip = useCallback(() => {
    if (!current) return;
    setQueue((q) => [...q.slice(1), q[0]]);
  }, [current]);

  // Keyboard shortcuts: 1/2/3 to rate, s or → to skip
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "1") rate(1);
      if (e.key === "2") rate(2);
      if (e.key === "3") rate(3);
      if (e.key === "s" || e.key === "ArrowRight") skip();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [rate, skip]);

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center text-zinc-400">
        Loading...
      </div>
    );
  }

  if (!current) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <div className="text-5xl mb-4">✓</div>
        <h2 className="text-xl font-semibold mb-2">All caught up</h2>
        <p className="text-zinc-500 mb-6">
          You rated {rated_count} contact{rated_count !== 1 ? "s" : ""} this session.
        </p>
        <Link href="/contacts" className="text-sm text-zinc-500 hover:text-zinc-900 underline underline-offset-2">
          Back to contacts
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-6 py-12">
      {/* Progress */}
      <div className="flex items-center justify-between mb-8 text-sm text-zinc-400">
        <span>{rated_count} rated this session</span>
        <span>{queue.length} of {total_unrated} remaining</span>
      </div>

      {/* Card */}
      <div className="border border-zinc-200 rounded-xl p-8 text-center shadow-sm">
        <h2 className="text-2xl font-semibold mb-1">{current.name}</h2>

        {(current.role || current.company) && (
          <p className="text-zinc-500 text-sm mb-1">
            {[current.role, current.company].filter(Boolean).join(" · ")}
          </p>
        )}

        {(current.city || current.country) && (
          <p className="text-zinc-400 text-sm mb-1">
            {[current.city, current.country].filter(Boolean).join(", ")}
          </p>
        )}

        {current.how_you_know_them && (
          <p className="text-zinc-400 text-xs mt-2 italic">{current.how_you_know_them}</p>
        )}

        {/* Star rating — big tap targets */}
        <div className="flex justify-center gap-4 mt-8 mb-2">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              onClick={() => rate(s)}
              disabled={saving}
              className="text-5xl leading-none transition-transform active:scale-90 disabled:opacity-40"
              title={s === 1 ? "1 — Noise" : s === 2 ? "2 — Acquaintance" : "3 — Real relationship"}
            >
              <span className="text-zinc-200 hover:text-amber-400">★</span>
            </button>
          ))}
        </div>

        <p className="text-xs text-zinc-400 mb-6">1 = noise · 2 = acquaintance · 3 = real relationship</p>

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        <button
          onClick={skip}
          disabled={saving}
          className="text-sm text-zinc-400 hover:text-zinc-600 disabled:opacity-40"
        >
          Skip for now →
        </button>
      </div>

      <p className="text-center text-xs text-zinc-300 mt-6">
        Tap a star or press <kbd className="font-mono">1</kbd> <kbd className="font-mono">2</kbd> <kbd className="font-mono">3</kbd> · <kbd className="font-mono">S</kbd> to skip
      </p>
    </div>
  );
}
