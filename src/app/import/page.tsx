"use client";

import { useState } from "react";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{
    count?: number;
    error?: string;
    column_mapping?: Record<string, string>;
    linkedin_detected?: boolean;
  }>({});

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
        setResult({ count: data.count, column_mapping: data.column_mapping, linkedin_detected: data.linkedin_detected });
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
        Upload any CSV — Cortex will figure out your column names automatically.
      </p>

      <div className="border border-zinc-200 rounded-lg p-8">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setStatus("idle");
            setResult({});
          }}
          className="block w-full text-sm text-zinc-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200"
        />

        {file && (
          <p className="text-sm text-zinc-500 mt-3">
            Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || status === "uploading"}
          className="mt-4 px-4 py-2 bg-zinc-900 text-white text-sm rounded-md hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "uploading" ? "Mapping columns & importing..." : "Import Contacts"}
        </button>

        {status === "done" && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
            <p className="text-green-800 text-sm font-medium mb-2">
              Successfully imported {result.count} contacts.
              {result.linkedin_detected && (
                <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  LinkedIn detected — all set to light / unreviewed
                </span>
              )}
            </p>
            {result.column_mapping && Object.keys(result.column_mapping).length > 0 && (
              <div>
                <p className="text-green-700 text-xs font-medium mb-1">Columns mapped as:</p>
                <div className="space-y-0.5">
                  {Object.entries(result.column_mapping).map(([schema, csv]) => (
                    <p key={schema} className="text-green-700 text-xs">
                      <span className="font-mono">{csv}</span>
                      <span className="mx-1">→</span>
                      <span className="font-mono">{schema}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
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
