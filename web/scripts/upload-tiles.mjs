// Upload a PMTiles file to a public Supabase Storage bucket and print its URL.
// Run from web/ (uses the service-role key in .env.local):
//
//   node scripts/upload-tiles.mjs "C:\mvum\mvum.pmtiles"
//
// Creates the public "tiles" bucket if needed, uploads as tiles/mvum.pmtiles
// (overwriting), and prints the public URL.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const txt = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const BUCKET = "tiles";
const OBJECT = "mvum.pmtiles";
const filePath = process.argv[2] || "C:\\mvum\\mvum.pmtiles";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const buf = readFileSync(filePath);
console.log(`Uploading ${(buf.length / 1e6).toFixed(1)} MB from ${filePath} …`);

const { error: bErr } = await db.storage.createBucket(BUCKET, { public: true });
if (bErr && !/exist/i.test(bErr.message)) console.error("createBucket warning:", bErr.message);

const { error: uErr } = await db.storage
  .from(BUCKET)
  .upload(OBJECT, buf, { upsert: true, contentType: "application/octet-stream" });
if (uErr) {
  console.error("Upload failed:", uErr.message);
  console.error("If this is a size error (413), raise Project Settings → Storage → Upload file size limit to 100MB+.");
  process.exit(1);
}

const { data: pub } = db.storage.from(BUCKET).getPublicUrl(OBJECT);
console.log("Done. Public URL:\n" + pub.publicUrl);
