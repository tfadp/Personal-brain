// Embedding helpers for contacts.
// Uses OpenAI's text-embedding-3-small model (1536 dims).
// The vector is stored in contacts.contact_embedding.

import OpenAI from "openai";
import { Contact } from "@/lib/types";

// Lazy init — avoids failing at Next.js build time when OPENAI_API_KEY
// isn't loaded yet (build doesn't need to call these functions)
let _openai: OpenAI | null = null;
function get_openai(): OpenAI {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

/**
 * Build the text that represents a contact for embedding.
 * The fields chosen here determine what "similar" means for search.
 * We include role, company, topics, notes, and how-we-know-them
 * because those capture the semantic content of the relationship.
 */
export function contact_embedding_text(contact: Partial<Contact>): string {
  const parts = [
    contact.name,
    contact.role,
    contact.company,
    contact.city,
    contact.country,
    contact.how_you_know_them,
    (contact.topics ?? []).join(", "),
    contact.notes,
  ].filter(Boolean);
  return parts.join(". ").slice(0, 8000); // OpenAI's limit is 8191 tokens; 8k chars is safely under
}

/**
 * Embed a single string. Returns the 1536-dim vector.
 */
export async function embed_text(text: string): Promise<number[]> {
  const res = await get_openai().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return res.data[0].embedding;
}

/**
 * Embed many strings at once. OpenAI accepts up to 2048 inputs per call.
 * We batch in 100s for safety.
 */
export async function embed_batch(texts: string[]): Promise<number[][]> {
  const BATCH = 100;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    const res = await get_openai().embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunk,
    });
    all.push(...res.data.map((d) => d.embedding));
  }
  return all;
}
