/**
 * One-time OAuth helper to get a Gmail refresh token for dan@juddporter.com.
 *
 * Run: npx tsx scripts/auth-gmail-dan.ts
 *
 * Opens a browser → pick dan@juddporter.com → approve Gmail read access →
 * prints the refresh token to paste into Vercel as GMAIL_REFRESH_TOKEN_DAN.
 *
 * Uses the same Google Cloud project (client_id/client_secret) as the
 * existing Gmail MCP auth — just authenticates a different account.
 */

import { google } from "googleapis";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createServer } from "http";
import { URL } from "url";

const PORT = 3457; // different port from the calendar auth script
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
];

function load_oauth_keys() {
  const path = join(homedir(), ".gmail-mcp", "gcp-oauth.keys.json");
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const inner = raw.installed || raw.web;
    return { client_id: inner.client_id as string, client_secret: inner.client_secret as string };
  } catch {
    console.error(`Could not load OAuth keys from ${path}`);
    console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars instead.");
    process.exit(1);
  }
}

async function main() {
  const keys = load_oauth_keys();
  const client_id     = process.env.GMAIL_CLIENT_ID     ?? keys.client_id;
  const client_secret = process.env.GMAIL_CLIENT_SECRET ?? keys.client_secret;

  const oauth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

  const auth_url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    login_hint: "dan@juddporter.com",
  });

  console.log("\n🔐 Gmail OAuth for dan@juddporter.com\n");
  console.log("1. Open this URL in your browser:\n");
  console.log(`   ${auth_url}\n`);
  console.log("2. Sign in with dan@juddporter.com (not the gmail account).");
  console.log("3. Approve Gmail read access.");
  console.log("4. You'll be redirected back — this script catches it.\n");
  console.log("Waiting for callback...\n");

  const code: string = await new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404); res.end("not found"); return;
      }
      const parsed = new URL(req.url, `http://localhost:${PORT}`);
      const err = parsed.searchParams.get("error");
      if (err) {
        res.writeHead(400); res.end(`OAuth error: ${err}`);
        reject(new Error(err)); server.close(); return;
      }
      const c = parsed.searchParams.get("code");
      if (!c) {
        res.writeHead(400); res.end("missing code");
        reject(new Error("missing code")); server.close(); return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Done</h1><p>You can close this tab and return to your terminal.</p>");
      server.close();
      resolve(c);
    });
    server.listen(PORT);
  });

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error("\nNo refresh_token returned. Try revoking access at");
    console.error("https://myaccount.google.com/permissions and re-running.\n");
    process.exit(1);
  }

  console.log("\nSuccess!\n");
  console.log("Add this to Vercel → Settings → Environment Variables:\n");
  console.log(`GMAIL_REFRESH_TOKEN_DAN=${tokens.refresh_token}\n`);
  console.log("Then redeploy. The nightly cron will start reading both accounts.\n");
}

main().catch((err) => {
  console.error("Auth failed:", err);
  process.exit(1);
});
