/**
 * fetch-topics.mjs
 * Daily Caribbean podcast topic refresher for Island Frequency dashboard.
 *
 * What it does each day:
 *  1. Reads index.html and extracts today's TOPICS array
 *  2. Archives it into the ARCHIVE array (prepends as newest entry)
 *  3. Calls Perplexity sonar API to generate 8 fresh podcast topics
 *  4. Replaces TOPICS in index.html with the new set
 *  5. Writes updated index.html back to disk
 *
 * Requires: PERPLEXITY_API_KEY environment variable
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.join(__dirname, 'index.html');

const API_KEY = process.env.PERPLEXITY_API_KEY;
if (!API_KEY) {
  console.error('ERROR: PERPLEXITY_API_KEY not set.');
  process.exit(1);
}

const TODAY = new Date().toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric'
});
const ISO_TODAY = new Date().toISOString().split('T')[0];

/* ── Step 1: Read index.html ─────────────────────────────────── */
let source = fs.readFileSync(INDEX_FILE, 'utf8');

/* ── Step 2: Extract current TOPICS for archiving ───────────── */
function extractTopicsArray(html) {
  // Grab everything between AUTO-UPDATE-START and AUTO-UPDATE-END
  const match = html.match(/\/\/ AUTO-UPDATE-START\s*([\s\S]*?)\/\/ AUTO-UPDATE-END/);
  if (!match) return null;
  const block = match[1].trim();
  // Extract the array literal after "const TOPICS = "
  const arrMatch = block.match(/const TOPICS\s*=\s*(\[[\s\S]*\]);/);
  if (!arrMatch) return null;
  try {
    // Use Function constructor to safely evaluate the array literal
    return new Function(`return ${arrMatch[1]}`)();
  } catch (e) {
    console.warn('Could not parse TOPICS array for archiving:', e.message);
    return null;
  }
}

function extractArchiveArray(html) {
  const match = html.match(/\/\/ AUTO-ARCHIVE-START\s*([\s\S]*?)\/\/ AUTO-ARCHIVE-END/);
  if (!match) return [];
  const block = match[1].trim();
  const arrMatch = block.match(/const ARCHIVE\s*=\s*(\[[\s\S]*\]);/);
  if (!arrMatch) return [];
  try {
    return new Function(`return ${arrMatch[1]}`)();
  } catch (e) {
    console.warn('Could not parse ARCHIVE array:', e.message);
    return [];
  }
}

const currentTopics = extractTopicsArray(source);
const currentArchive = extractArchiveArray(source);

// Build archive entry from today's topics
let newArchiveEntry = null;
if (currentTopics && currentTopics.length > 0) {
  newArchiveEntry = {
    date: (() => {
      // Infer yesterday's date from today
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    })(),
    isoDate: (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    })(),
    topics: currentTopics.map(t => ({
      title: t.title,
      category: t.category,
      summary: t.summary
    }))
  };
  console.log(`Archived ${currentTopics.length} topics from yesterday.`);
}

/* ── Step 3: Fetch fresh topics from Perplexity ─────────────── */
async function fetchFreshTopics() {
  const prompt = `You are a Caribbean podcast research producer for "Island Frequency" — a show with two hosts: one aged 30 and one aged 65, representing intergenerational Caribbean perspectives.

Today is ${TODAY}. Search for the latest Caribbean news from the past 7 days and generate exactly 8 podcast discussion topics. Cover a mix of these categories: dev (regional development/politics), tech (technology/innovation), music (music industry/culture), econ (economy/finance), culture (arts/society).

Return ONLY a valid JSON array with exactly 8 objects. Each object must have:
- id: number (1-8)
- featured: boolean (true for the single most important topic only)
- category: one of "dev"|"tech"|"music"|"econ"|"culture"
- categoryLabel: human label ("Development"|"Tech"|"Music Industry"|"Economy"|"Culture")
- hot: boolean (true if very timely/breaking)
- title: string (compelling headline, max 90 chars)
- summary: string (2-3 sentences, what it is and why it matters to Caribbean audiences)
- points: array of exactly 2 objects:
    { age: "30", type: "young", text: "perspective from a 30-year-old Caribbean host" }
    { age: "65", type: "elder", text: "perspective from a 65-year-old Caribbean host" }
- source: string (publication/outlet name)
- sourceUrl: string (actual URL if available, or best-guess URL)
- duration: string (e.g. "7–9 min")

Focus on: CARICOM news, CDB reports, Caribbean tourism, Caribbean tech startups, reggae/dancehall/soca industry, inter-island economic developments, climate and natural disasters, Caribbean diaspora issues.

Return only the raw JSON array, no markdown, no explanation.`;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    throw new Error(`Perplexity API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  let content = data.choices[0].message.content.trim();
  // Strip markdown fences
  content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();

  const topics = JSON.parse(content);
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error('API returned invalid topics array');
  }
  return topics;
}

/* ── Step 4: Build new TOPICS block ─────────────────────────── */
function topicsToJS(topics) {
  return `const TOPICS = ${JSON.stringify(topics, null, 2)};`;
}

function archiveToJS(archive) {
  // Keep only last 30 days
  const trimmed = archive.slice(0, 30);
  return `const ARCHIVE = ${JSON.stringify(trimmed, null, 2)};`;
}

/* ── Step 5: Patch and write index.html ─────────────────────── */
async function main() {
  console.log(`\nIsland Frequency — Daily Topic Refresh — ${TODAY}\n`);

  let freshTopics;
  try {
    console.log('Fetching fresh topics from Perplexity sonar...');
    freshTopics = await fetchFreshTopics();
    console.log(`✓ Received ${freshTopics.length} topics`);
    freshTopics.forEach((t, i) => console.log(`  ${i+1}. [${t.category}] ${t.title}`));
  } catch (err) {
    console.error('Failed to fetch fresh topics:', err.message);
    console.log('Keeping existing topics, still archiving yesterday\'s.');
    freshTopics = currentTopics;
  }

  // Build updated archive (prepend new entry)
  const updatedArchive = newArchiveEntry
    ? [newArchiveEntry, ...currentArchive]
    : currentArchive;

  // Replace TOPICS block
  const newTopicsBlock = `// AUTO-UPDATE-START\n${topicsToJS(freshTopics)}\n// AUTO-UPDATE-END`;
  source = source.replace(
    /\/\/ AUTO-UPDATE-START[\s\S]*?\/\/ AUTO-UPDATE-END/,
    newTopicsBlock
  );

  // Replace ARCHIVE block
  const newArchiveBlock = `// AUTO-ARCHIVE-START\n${archiveToJS(updatedArchive)}\n// AUTO-ARCHIVE-END`;
  source = source.replace(
    /\/\/ AUTO-ARCHIVE-START[\s\S]*?\/\/ AUTO-ARCHIVE-END/,
    newArchiveBlock
  );

  fs.writeFileSync(INDEX_FILE, source, 'utf8');
  console.log(`\n✅ index.html updated — ${freshTopics.length} new topics, ${updatedArchive.length} archived sessions.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
