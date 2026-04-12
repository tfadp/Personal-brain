/**
 * One-time OAuth helper to get a Google Calendar refresh token.
 *
 * Run this once on your laptop:
 *   npx tsx scripts/auth-google-calendar.ts
 *
 * It prints a URL → you open it, pick your Google account, approve
 * Calendar access, get redirected to a localhost:3456 page, which
 * captures the code and exchanges it for a refresh token. The token
 * is printed at the end — paste it into Vercel as GCAL_REFRESH_TOKEN.
 *
 * Reads client_id/client_secret from ~/.gmail-mcp/gcp-oauth.keys.json
 * (the same Google Cloud project you already set up for Gmail MCP).
 */

import { google } from "googleapis";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createServer } from "http";
import { URL } from "url";

const PORT = 3456;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

function load_oauth_keys() {
  const path = join(homedir(), ".gmail-mcp", "gcp-oauth.keys.json");
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const inner = raw.installed || raw.web;
    if (!inner?.client_id || !inner?.client_secret) {
      throw new Error("missing client_id/client_secret in keys file");
    }
    return { client_id: inner.client_id as string, client_secret: inner.client_secret as string };
  } catch (err) {
    console.error(`\n❌ Could not load OAuth keys from ${path}`);
    console.error(`   ${String(err)}\n`);
    console.error("This script reads the same credentials you used for Gmail MCP.");
    console.error("If you don't have that file, set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars instead.\n");
    process.exit(1);
  }
}

async function main() {
  const client_id     = process.env.GMAIL_CLIENT_ID     ?? load_oauth_keys().client_id;
  const client_secret = process.env.GMAIL_CLIENT_SECRET ?? load_oauth_keys().client_secret;

  const oauth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

  const auth_url = oauth2.generateAuthUrl({
    access_type: "offline",     // required to get a refresh token
    prompt: "consent",          // force re-consent so a new refresh token is issued
    scope: SCOPES,
  });

  console.log("\n🔐 Google Calendar OAuth\n");
  console.log("1. Open this URL in your browser:\n");
  console.log(`   ${auth_url}\n`);
  console.log("2. Pick the Google account whose calendar you want to sync.");
  console.log("3. Approve Calendar access.");
  console.log("4. You'll be redirected back to localhost — this script will catch it.\n");
  console.log("Waiting for callback...\n");

  // Tiny local server to catch the redirect
  const code: string = await new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith("/callback")) {
          res.writeHead(404); res.end("not found"); return;
        }
        const parsed = new URL(req.url, `http://localhost:${PORT}`);
        const err = parsed.searchParams.get("error");
        if (err) {
          res.writeHead(400); res.end(`OAuth error: ${err}`);
          reject(new Error(`OAuth error: ${err}`));
          server.close();
          return;
        }
        const c = parsed.searchParams.get("code");
        if (!c) {
          res.writeHead(400); res.end("missing code");
          reject(new Error("missing code"));
          server.close();
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>✅ Done</h1><p>You can close this tab and return to your terminal.</p>");
        server.close();
        resolve(c);
      } catch (e) {
        reject(e);
        server.close();
      }
    });
    server.listen(PORT);
  });

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error("\n❌ No refresh_token returned. This usually means Google already had a valid token for this scope.");
    console.error("   Try revoking access at https://myaccount.google.com/permissions and re-running.\n");
    process.exit(1);
  }

  console.log("\n✅ Success!\n");
  console.log("Add this to Vercel → Settings → Environment Variables:\n");
  console.log(`GCAL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log("Then redeploy. The nightly cron will start using it automatically.\n");
}

main().catch((err) => {
  console.error("\n❌ Auth failed:", err);
  process.exit(1);
});
