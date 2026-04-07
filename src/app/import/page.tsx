"use client";

import { useState } from "react";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">(
    "idle"
  );
  const [result, setResult] = useState<{ count?: number; error?: string }>({});

  async function handleUpload() {
    if (!file) return;

    setStatus("uploading");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (res.ok) {
        setStatus("done");
        setResult({ count: data.count });
      } else {
        setStatus("error");
        setResult({ error: data.error || "Import failed" });
      }
    } catch (err) {
      setStatus("error");
      setResult({ error: String(err) });
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-semibold mb-2">Import Contacts</h1>
      <p className="text-zinc-500 mb-8">
        Upload a CSV file with your contacts. Expected columns: name, company,
        role, city, country, relationship_strength, how_you_know_them, topics,
        last_meaningful_contact, notes.
      </p>

      <div className="border border-zinc-200 rounded-lg p-8">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-zinc-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200"
        />

        {file && (
          <div className="mt-4">
            <p className="text-sm text-zinc-500 mb-3">
              Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
            <button
              onClick={handleUpload}
              disabled={status === "uploading"}
              className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-700 disabled:opacity-50"
            >
              {status === "uploading" ? "Importing..." : "Import Contacts"}
            </button>
          </div>
        )}

        {status === "done" && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
            <p className="text-green-800 text-sm font-medium">
              Successfully imported {result.count} contacts.
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-800 text-sm">{result.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
