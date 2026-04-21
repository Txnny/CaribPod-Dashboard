/**
 * fetch-topics.mjs — token-optimized
 * Archives yesterday's topics, fetches 8 fresh Caribbean podcast topics.
 * Requires: PERPLEXITY_API_KEY
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.join(__dirname, 'index.html');

const API_KEY = process.env.PERPLEXITY_API_KEY;
if (!API_KEY) { console.error('Missing PERPLEXITY_API_KEY'); process.exit(1); }

const now      = new Date();
const TODAY    = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const YEST     = new Date(now - 864e5);
const YEST_STR = YEST.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const YEST_ISO = YEST.toISOString().slice(0, 10);

// ── Helpers ───────────────────────────────────────────────────────────────────
function extract(html, marker) {
  const m = html.match(new RegExp(`\\/\\/ AUTO-${marker}-START\\s*([\\s\\S]*?)\\/\\/ AUTO-${marker}-END`));
  if (!m) return null;
  const arr = m[1].match(/const (?:TOPICS|ARCHIVE)\s*=\s*(\[[\s\S]*?\]);/);
  if (!arr) return null;
  try { return new Function(`return ${arr[1]}`)(); } catch { return null; }
}

function patch(html, marker, varName, data, limit = Infinity) {
  const trimmed = limit < Infinity ? data.slice(0, limit) : data;
  const block = `// AUTO-${marker}-START\nconst ${varName} = ${JSON.stringify(trimmed, null, 2)};\n// AUTO-${marker}-END`;
  return html.replace(new RegExp(`\\/\\/ AUTO-${marker}-START[\\s\\S]*?\\/\\/ AUTO-${marker}-END`), block);
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchTopics() {
  const prompt = `Caribbean podcast "Island Frequency" — two hosts age 30 & 65. Today: ${TODAY}.

Find 8 Caribbean news topics from the past 7 days. Return ONLY a minified JSON array of 8 objects:
[{"id":1,"featured":true,"category":"dev","categoryLabel":"Development","hot":true,"title":"max 85 chars","summary":"2-3 sentences","points":[{"age":"30","type":"young","text":"..."},{"age":"65","type":"elder","text":"..."}],"source":"outlet","sourceUrl":"url","duration":"7-9 min"}]

Categories: dev|tech|music|econ|culture. Only 1 featured:true. No markdown.`;

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2500,
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let raw = data.choices[0].message.content.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  const topics = JSON.parse(raw);
  if (!Array.isArray(topics) || !topics.length) throw new Error('Invalid topics array');
  return topics;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nIsland Frequency — Daily Refresh — ${TODAY}\n`);
  let src = fs.readFileSync(INDEX_FILE, 'utf8');

  const currentTopics  = extract(src, 'UPDATE')  || [];
  const currentArchive = extract(src, 'ARCHIVE') || [];

  // Archive yesterday's topics
  const newArchive = currentTopics.length
    ? [{ date: YEST_STR, isoDate: YEST_ISO, topics: currentTopics.map(({ title, category, summary }) => ({ title, category, summary })) }, ...currentArchive]
    : currentArchive;

  console.log('Fetching fresh topics from Perplexity...');
  let freshTopics;
  try {
    freshTopics = await fetchTopics();
    console.log(`✓ ${freshTopics.length} topics received:`);
    freshTopics.forEach((t, i) => console.log(`  ${i + 1}. [${t.category}] ${t.title}`));
  } catch (err) {
    console.error('Fetch failed:', err.message, '— keeping existing topics.');
    freshTopics = currentTopics;
  }

  src = patch(src, 'UPDATE',  'TOPICS',  freshTopics);
  src = patch(src, 'ARCHIVE', 'ARCHIVE', newArchive, 30);

  fs.writeFileSync(INDEX_FILE, src, 'utf8');
  console.log(`\n✅ index.html updated — ${freshTopics.length} topics, ${newArchive.length} archived sessions.`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
