/**
 * One-time backfill: generate embeddings for every contact.
 *
 * Run: npm run embed:contacts
 *
 * Reads directly from the Cortex API (/api/contacts) so it works against
 * either local dev or production. Embeds in batches of 100 to stay under
 * OpenAI's request limits. Writes back via the contacts PATCH endpoint.
 *
 * Safe to re-run: skips contacts that already have an embedding by default.
 * Pass --force to re-embed everyone (e.g. after changing the model or text builder).
 *
 * Requires:
 *   OPENAI_API_KEY in your environment (or .env.local when running against localhost)
 *   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY OR anon key with the usual write access
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { contact_embedding_text, embed_batch } from "../src/lib/embeddings";
import type { Contact } from "../src/lib/types";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const BATCH_SIZE = 50;

function get_supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and a key.");
    process.exit(1);
  }
  return createClient(url, key);
}

async function fetch_all_contacts(): Promise<Contact[]> {
  const sb = get_supabase();
  const PAGE = 1000;
  let all: Contact[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await sb
      .from("contacts")
      .select("*")
      .order("name")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all = all.concat(data as Contact[]);
    if (data.length < PAGE) break;
  }
  return all;
}

async function main() {
  console.log("\n📐 Cortex contact embedding backfill\n");

  const sb = get_supabase();
  const contacts = await fetch_all_contacts();
  console.log(`Fetched ${contacts.length} contacts.`);

  // Filter to contacts that need embedding
  type MaybeEmbedded = Contact & { contact_embedding?: number[] | null };
  const needs_embedding = (contacts as MaybeEmbedded[]).filter((c) =>
    FORCE || !c.contact_embedding
  );
  console.log(`${needs_embedding.length} need embedding${FORCE ? " (forced)" : ""}.\n`);

  if (needs_embedding.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < needs_embedding.length; i += BATCH_SIZE) {
    const batch = needs_embedding.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => contact_embedding_text(c));

    try {
      const vectors = await embed_batch(texts);

      // Write each vector back. Supabase can't bulk-update with different values,
      // so we do one update per contact (still fast — the embedding generation
      // was the slow part).
      await Promise.all(
        batch.map((c, idx) =>
          sb
            .from("contacts")
            .update({ contact_embedding: vectors[idx] })
            .eq("id", c.id)
        )
      );

      processed += batch.length;
      console.log(`  [${processed}/${needs_embedding.length}] embedded`);
    } catch (err) {
      failed += batch.length;
      console.error(`  batch ${i}-${i + batch.length} failed:`, err);
    }
  }

  console.log(`\n✅ Embedded: ${processed}`);
  if (failed > 0) console.log(`❌ Failed:   ${failed}`);
  console.log();
}

main().catch((err) => {
  console.error("\n❌ Backfill failed:", err);
  process.exit(1);
});
