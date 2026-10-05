// The robot: finds AI events on the internet and writes them to data/discovered.json.
// Runs every day on GitHub Actions (see .github/workflows/collect.yml).
// No dependencies — plain Node 20+.
//
// Sources are configured in sources.json:
//   - devpost: Devpost's public hackathon search (unofficial JSON API, no key needed)
//   - ics:     any calendar feed URL (Luma calendars, Meetup groups, Google Calendars...)

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HORIZON_DAYS = 240; // ignore events further away than ~8 months
const UA = "ai-events-hub/1.0 (+https://github.com)";

// ---------- helpers ----------

export function slug(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function makeKeywordMatcher(keywords) {
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
  return (text) => re.test(text || "");
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");

// Devpost gives dates as text, e.g. "Sep 20 - Oct 15, 2026", "Oct 01 - 31, 2026",
// "Dec 15, 2025 - Jan 10, 2026" or "Oct 12, 2026". Returns { start, end } as YYYY-MM-DD, or null.
export function parseDevpostDates(text) {
  if (!text) return null;
  const parts = String(text).replace(/–|—/g, "-").split(/\s+-\s+/).map((p) => p.trim());
  const piece = /^([A-Za-z]{3,4})?\s*(\d{1,2})(?:,\s*(\d{4}))?$/;
  const right = parts[parts.length - 1].match(piece);
  const left = parts[0].match(piece);
  if (!left || !right) return null;
  const endYear = Number(right[3]);
  if (!endYear) return null;
  const startMonth = MONTHS[(left[1] || "").toLowerCase()];
  const endMonth = right[1] ? MONTHS[right[1].toLowerCase()] : startMonth;
  if (!startMonth || !endMonth) return null;
  let startYear = left[3] ? Number(left[3]) : endYear;
  if (!left[3] && startMonth > endMonth) startYear = endYear - 1; // "Dec 15 - Jan 10, 2026"
  return {
    start: `${startYear}-${pad(startMonth)}-${pad(left[2])}`,
    end: `${endYear}-${pad(endMonth)}-${pad(right[2])}`,
  };
}

// ---------- iCalendar (.ics) ----------

function unescapeIcs(s) {
  return s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

// "20261012T180000Z" -> "2026-10-12T18:00:00Z"; "20261012" -> "2026-10-12"
export function icsDate(value) {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return m[4] ? `${date}T${m[4]}:${m[5]}:${m[6]}${m[7] || ""}` : date;
}

export function parseIcs(text) {
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const name = line.slice(0, idx).split(";")[0].toUpperCase();
      const value = line.slice(idx + 1);
      if (name === "DTSTART" || name === "DTEND") cur[name] = icsDate(value);
      else if (["SUMMARY", "LOCATION", "URL", "DESCRIPTION", "UID"].includes(name)) cur[name] = unescapeIcs(value);
    }
  }
  return events;
}

// ---------- sources ----------

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.text();
}

export function devpostToEvent(h) {
  const dates = parseDevpostDates(h.submission_period_dates);
  const themes = (h.themes || []).map((t) => t.name).filter(Boolean);
  const location = h.displayed_location?.location || "";
  const prize = String(h.prize_amount || "").replace(/<[^>]+>/g, "").trim();
  return {
    id: `devpost-${h.id ?? slug(h.title)}`,
    title: h.title,
    type: "hackathon",
    platform: "Devpost",
    start: dates?.start || null,
    end: dates?.end || null,
    deadline: dates?.end || null,
    when_text: h.submission_period_dates || "",
    location,
    online: /online/i.test(location),
    url: h.url,
    organizer: h.organization_name || "",
    prize: prize && prize !== "$0" ? prize : "",
    tags: themes,
    source: "devpost",
  };
}

async function collectDevpost(cfg) {
  const found = new Map();
  for (const search of cfg.searches || ["AI"]) {
    for (let page = 1; page <= (cfg.pages || 2); page++) {
      const url = `https://devpost.com/api/hackathons?search=${encodeURIComponent(search)}&status[]=upcoming&status[]=open&page=${page}`;
      const json = JSON.parse(await fetchText(url));
      const list = json.hackathons || [];
      for (const h of list) found.set(h.id ?? h.url, devpostToEvent(h));
      if (list.length === 0) break;
    }
  }
  return [...found.values()];
}

export function icsToEvent(e, feed) {
  const url = e.URL || (e.DESCRIPTION || "").match(/https?:\/\/[^\s<>"]+/)?.[0] || feed.link || "";
  const text = `${e.SUMMARY || ""} ${e.DESCRIPTION || ""}`;
  return {
    id: `ics-${slug(feed.name)}-${slug(e.UID || `${e.SUMMARY}-${e.DTSTART}`)}`,
    title: e.SUMMARY || "(untitled event)",
    type: feed.type || guessType(text),
    platform: feed.platform || feed.name,
    start: e.DTSTART || null,
    end: e.DTEND || null,
    location: e.LOCATION || "",
    online: /zoom|google meet|meet\.google|online|virtual|livestream|teams\.microsoft/i.test(`${e.LOCATION || ""} ${text}`),
    url,
    notes: (e.DESCRIPTION || "").slice(0, 400),
    tags: [],
    source: `ics:${feed.name}`,
  };
}

export function guessType(text) {
  if (/hackathon|hack night|buildathon|game jam/i.test(text)) return "hackathon";
  if (/conference|summit|\bexpo\b|\bcon\b/i.test(text)) return "conference";
  if (/webinar|livestream|online talk/i.test(text)) return "webinar";
  if (/workshop|bootcamp|hands-on|masterclass/i.test(text)) return "workshop";
  if (/meetup|meet-up|social|drinks|networking|happy hour/i.test(text)) return "meetup";
  return "other";
}

async function collectIcs(feed, isAi) {
  const events = parseIcs(await fetchText(feed.url)).map((e) => icsToEvent(e, feed));
  return feed.filter === false ? events : events.filter((ev) => isAi(`${ev.title} ${ev.notes}`));
}

// ---------- main ----------

export function isInWindow(ev, now = new Date()) {
  const ref = ev.end || ev.deadline || ev.start;
  if (!ref) return true; // keep undated items; the page shows them as "date unknown"
  const t = new Date(ref.length === 10 ? `${ref}T23:59:59` : ref).getTime();
  if (Number.isNaN(t)) return true;
  const day = 86400000;
  return t >= now.getTime() - day && new Date(ev.start || ref).getTime() <= now.getTime() + HORIZON_DAYS * day;
}

async function main() {
  const config = JSON.parse(await readFile(path.join(ROOT, "sources.json"), "utf8"));
  const isAi = makeKeywordMatcher(config.keywords || ["ai"]);
  const report = [];
  const all = [];

  const run = async (name, fn) => {
    try {
      const events = await fn();
      all.push(...events);
      report.push({ name, ok: true, count: events.length });
      console.log(`✓ ${name}: ${events.length}`);
    } catch (err) {
      report.push({ name, ok: false, count: 0, error: String(err.message || err).slice(0, 200) });
      console.log(`✗ ${name}: ${err.message || err}`);
    }
  };

  if (config.devpost?.enabled !== false) await run("Devpost", () => collectDevpost(config.devpost || {}));
  for (const feed of config.ics || []) {
    if (!feed.url) continue;
    await run(feed.name, () => collectIcs(feed, isAi));
  }

  const seen = new Set();
  const events = all
    .filter((ev) => isInWindow(ev))
    .filter((ev) => (seen.has(ev.id) ? false : seen.add(ev.id)))
    .sort((a, b) => String(a.start || "9999").localeCompare(String(b.start || "9999")));

  const outPath = path.join(ROOT, "data", "discovered.json");
  // If every source failed, keep yesterday's list instead of wiping it.
  if (events.length === 0 && report.length && report.every((r) => !r.ok)) {
    const prev = JSON.parse(await readFile(outPath, "utf8").catch(() => '{"events":[]}'));
    await writeFile(outPath, JSON.stringify({ ...prev, checked: new Date().toISOString(), sources: report }, null, 2) + "\n");
    console.log("All sources failed — kept previous events.");
    return;
  }
  const out = { updated: new Date().toISOString(), checked: new Date().toISOString(), sources: report, events };
  await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${events.length} events.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
