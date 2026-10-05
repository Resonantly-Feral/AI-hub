// AI Events Hub — plain JavaScript, no build step.
// Data: data/events.json (hand-picked) + data/discovered.json (robot) + device-only events (localStorage).

const KEYS = { status: "aeh.status.v1", local: "aeh.local.v1", view: "aeh.view.v1" };
const DAY = 86400000;
const TYPE_LABEL = { meetup: "Meetup", conference: "Conference", hackathon: "Hackathon", webinar: "Webinar", workshop: "Workshop", other: "Event" };

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: choices just won't persist */ }
  },
};

const state = {
  events: [],
  discoveredMeta: null,
  status: store.get(KEYS.status, {}),
  local: store.get(KEYS.local, []),
  view: store.get(KEYS.view, "upcoming"),
};

// ---------- dates ----------

// "2026-10-12" = all-day (local). "2026-10-12T18:00:00" = local time. With Z/offset = exact moment.
function parseWhen(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return { date: new Date(y, m - 1, d), allDay: true };
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : { date: d, allDay: false };
}

function endMoment(ev) {
  const w = parseWhen(ev.end) || parseWhen(ev.deadline) || parseWhen(ev.start);
  if (!w) return null;
  return w.allDay ? new Date(w.date.getTime() + DAY - 1) : w.date;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

function fmtDay(d) {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function relWords(d, now = new Date()) {
  const n = daysBetween(now, d);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 1 && n < 7) return `this ${d.toLocaleDateString(undefined, { weekday: "long" })}`;
  if (n >= 7 && n < 14) return "next week";
  if (n >= 14 && n < 28) return `in ${Math.round(n / 7)} weeks`;
  if (n >= 28 && n < 60) return "in about a month";
  if (n >= 60) return `in ${Math.round(n / 30)} months`;
  if (n > -7) return "a few days ago";
  return `${Math.round(-n / 7)} weeks ago`;
}

function whenLine(ev, now) {
  const s = parseWhen(ev.start);
  const e = parseWhen(ev.end);
  if (!s) return { text: ev.when_text || "Date unknown", rel: "" };
  const isMultiDay = e && daysBetween(s.date, e.date) >= 1;
  let text = fmtDay(s.date);
  if (!s.allDay) text += ` · ${fmtTime(s.date)}`;
  if (isMultiDay) text += ` → ${fmtDay(e.date)}`;
  else if (e && !e.allDay && !s.allDay) text += `–${fmtTime(e.date)}`;
  let rel = relWords(s.date, now);
  if (s.date <= now && endMoment(ev) >= now) rel = ev.type === "hackathon" ? "open now" : "happening now";
  return { text, rel };
}

function groupFor(ev, now) {
  const s = parseWhen(ev.start);
  if (!s) return "Date unknown";
  if (s.date <= now) return "Open / happening now";
  const n = daysBetween(now, s.date);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  // "This week" = until Sunday
  const daysToSunday = (7 - now.getDay()) % 7;
  if (n <= daysToSunday) return "This week";
  if (n <= daysToSunday + 7) return "Next week";
  return s.date.toLocaleDateString(undefined, { month: "long", ...(s.date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

// ---------- data ----------

async function loadJson(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (err) {
    console.warn("Could not load", url, err);
    return null;
  }
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dupKey = (ev) => `${norm(ev.title)}|${String(ev.start || "").slice(0, 10)}`;

function idFor(ev, prefix) {
  return ev.id || `${prefix}-${norm(ev.title).replace(/ /g, "-").slice(0, 50)}-${String(ev.start || "").slice(0, 10)}`;
}

function mergeEvents(manual, discovered, local) {
  const out = [];
  const seen = new Set();
  const add = (ev, origin) => {
    const key = dupKey(ev);
    if (seen.has(key)) return; // hand-picked beats robot when both have the same event
    seen.add(key);
    out.push({ type: "other", tags: [], ...ev, id: idFor(ev, origin), origin });
  };
  manual.forEach((ev) => add(ev, "manual"));
  local.forEach((ev) => add(ev, "local"));
  discovered.forEach((ev) => add(ev, "robot"));
  return out;
}

async function load() {
  const [manual, discovered] = await Promise.all([loadJson("data/events.json"), loadJson("data/discovered.json")]);
  state.discoveredMeta = discovered;
  state.events = mergeEvents(manual?.events || [], discovered?.events || [], state.local);
  renderRobotStatus();
  fillPlatforms();
  render();
}

// ---------- rendering ----------

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

function renderRobotStatus() {
  const meta = state.discoveredMeta;
  const el = $("#robot-status");
  if (!meta || !meta.checked) {
    el.textContent = "The robot hasn't run yet. It runs every morning (or press “Run workflow” on the repo's Actions tab).";
    return;
  }
  const checked = new Date(meta.checked);
  const hours = Math.round((Date.now() - checked) / 3600000);
  const ago = hours < 1 ? "less than an hour ago" : hours < 24 ? `${hours}h ago` : relWords(checked);
  const parts = (meta.sources || []).map((s) => (s.ok ? `${esc(s.name)} ✓` : `<span class="bad" title="${esc(s.error)}">${esc(s.name)} ✗</span>`));
  el.innerHTML = `Robot checked ${esc(ago)}${parts.length ? " · " + parts.join(" · ") : ""}`;
}

function fillPlatforms() {
  const platforms = [...new Set(state.events.map((e) => e.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sel = $("#f-platform");
  const current = sel.value;
  sel.innerHTML = `<option value="">All platforms</option>` + platforms.map((p) => `<option>${esc(p)}</option>`).join("");
  sel.value = platforms.includes(current) ? current : "";
  $("#platform-list").innerHTML = platforms.map((p) => `<option value="${esc(p)}">`).join("");
}

function matchesFilters(ev) {
  const q = norm($("#q").value);
  const type = $("#f-type").value;
  const platform = $("#f-platform").value;
  if (type && ev.type !== type) return false;
  if (platform && ev.platform !== platform) return false;
  if ($("#f-online").checked && !ev.online) return false;
  if (q) {
    const hay = norm([ev.title, ev.location, ev.notes, ev.platform, ev.organizer, ...(ev.tags || [])].join(" "));
    if (!q.split(" ").every((w) => hay.includes(w))) return false;
  }
  return true;
}

function viewEvents(view, now) {
  const isPast = (ev) => { const e = endMoment(ev); return e ? e < now : false; };
  const st = (ev) => state.status[ev.id];
  const byStart = (a, b) => (parseWhen(a.start)?.date ?? Infinity) - (parseWhen(b.start)?.date ?? Infinity);
  switch (view) {
    case "new": return state.events.filter((ev) => ev.origin === "robot" && !st(ev) && !isPast(ev)).sort(byStart);
    case "plans": return state.events.filter((ev) => ["going", "interested"].includes(st(ev)) && !isPast(ev)).sort(byStart);
    case "past": return state.events.filter(isPast).sort((a, b) => byStart(b, a));
    default: return state.events.filter((ev) => !isPast(ev) && st(ev) !== "skip").sort(byStart);
  }
}

function calendarLink(ev) {
  const s = parseWhen(ev.start);
  if (!s) return "";
  const z = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const e = parseWhen(ev.end);
  const dates = s.allDay
    ? `${ymd(s.date)}/${ymd(new Date((e?.date || s.date).getTime() + DAY))}`
    : `${z(s.date)}/${z(e && !e.allDay ? e.date : new Date(s.date.getTime() + 2 * 3600000))}`;
  const params = new URLSearchParams({
    action: "TEMPLATE", text: ev.title, dates,
    details: [safeUrl(ev.url), ev.notes].filter(Boolean).join("\n\n"),
    location: ev.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function card(ev, now) {
  const { text, rel } = whenLine(ev, now);
  const st = state.status[ev.id];
  const color = `var(--t-${TYPE_LABEL[ev.type] ? ev.type : "other"})`;
  const url = safeUrl(ev.url);
  const dl = parseWhen(ev.deadline);
  const dlDays = dl ? daysBetween(now, dl.date) : null;
  const deadline = dl && ev.type === "hackathon" && dlDays >= 0
    ? `<p class="meta ${dlDays <= 3 ? "urgent" : ""}">${dlDays <= 3 ? "⚠️ " : ""}Submit by ${esc(fmtDay(dl.date))} (${esc(relWords(dl.date, now))})</p>` : "";
  const btn = (value, label) =>
    `<button type="button" class="st-${value}" data-id="${esc(ev.id)}" data-status="${value}" aria-pressed="${st === value}">${label}</button>`;
  const cal = calendarLink(ev);

  return `
  <article class="card ${st === "going" ? "going" : ""}" style="--type-color:${color}">
    <div class="chips">
      <span class="chip type">${esc(TYPE_LABEL[ev.type] || "Event")}</span>
      ${ev.platform ? `<span class="chip">${esc(ev.platform)}</span>` : ""}
      ${ev.online ? `<span class="chip">Online</span>` : ""}
      ${ev.origin === "robot" && !st ? `<span class="chip new">New find</span>` : ""}
      ${ev.origin === "local" ? `<span class="chip local">This device only</span>` : ""}
    </div>
    <h3>${esc(ev.title)}</h3>
    <p class="when">${esc(text)} ${rel ? `<span class="rel">· ${esc(rel)}</span>` : ""}</p>
    ${deadline}
    ${ev.location ? `<p class="meta">📍 ${esc(ev.location)}</p>` : ""}
    ${ev.organizer ? `<p class="meta">By ${esc(ev.organizer)}</p>` : ""}
    ${ev.prize ? `<p class="meta">🏆 ${esc(ev.prize)} in prizes</p>` : ""}
    ${ev.notes ? `<p class="notes">${esc(ev.notes.length > 220 ? ev.notes.slice(0, 220) + "…" : ev.notes)}</p>` : ""}
    <div class="actions">
      ${btn("interested", "⭐ Interested")}
      ${btn("going", "✅ Going")}
      ${btn("skip", "🙈 Not for me")}
      ${url ? `<a class="open" href="${esc(url)}" target="_blank" rel="noopener">Open ↗</a>` : ""}
      ${cal ? `<a href="${esc(cal)}" target="_blank" rel="noopener">📅 Calendar</a>` : ""}
      ${ev.origin === "local" ? `<button type="button" data-remove="${esc(ev.id)}">Remove</button>` : ""}
    </div>
  </article>`;
}

const EMPTY = {
  upcoming: "Nothing coming up yet. Send Claude a screenshot of an event and say “add this to my events”.",
  new: "No new robot finds right now. You've sorted everything! 🎉",
  plans: "Nothing marked yet. Tap ⭐ or ✅ on an event to put it here.",
  past: "No past events yet.",
};

function render() {
  const now = new Date();
  for (const v of ["upcoming", "new", "plans"]) {
    const n = viewEvents(v, now).length;
    $(`#c-${v}`).textContent = n ? String(n) : "";
  }
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));

  const items = viewEvents(state.view, now).filter(matchesFilters);
  if (!items.length) {
    const filtered = viewEvents(state.view, now).length > 0;
    $("#list").innerHTML = `<p class="empty">${filtered ? "Nothing matches these filters." : esc(EMPTY[state.view])}</p>`;
    return;
  }
  let html = "";
  let lastGroup = null;
  for (const ev of items) {
    const g = state.view === "past" ? "Past" : groupFor(ev, now);
    if (g !== lastGroup && state.view !== "past") { html += `<h2 class="group-title">${esc(g)}</h2>`; lastGroup = g; }
    html += card(ev, now);
  }
  $("#list").innerHTML = html;
}

// ---------- interactions ----------

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  state.view = b.dataset.view;
  store.set(KEYS.view, state.view);
  render();
});

["#q", "#f-type", "#f-platform", "#f-online"].forEach((sel) => $(sel).addEventListener("input", render));

$("#list").addEventListener("click", (e) => {
  const sb = e.target.closest("button[data-status]");
  if (sb) {
    const { id, status } = sb.dataset;
    if (state.status[id] === status) delete state.status[id]; else state.status[id] = status;
    store.set(KEYS.status, state.status);
    render();
    return;
  }
  const rb = e.target.closest("button[data-remove]");
  if (rb && confirm("Remove this event from this device?")) {
    state.local = state.local.filter((ev) => ev.id !== rb.dataset.remove);
    store.set(KEYS.local, state.local);
    load();
  }
});

$("#add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const toIso = (v) => (v ? `${v}:00`.slice(0, 19) : null); // datetime-local → local time string
  const ev = {
    id: `local-${Date.now()}`,
    title: f.title.trim(),
    type: f.type,
    platform: f.platform.trim(),
    start: toIso(f.start),
    end: toIso(f.end),
    location: f.location.trim(),
    online: /online|zoom|virtual/i.test(f.location),
    url: f.url.trim(),
    notes: f.notes.trim(),
    tags: [],
  };
  state.local.push(ev);
  store.set(KEYS.local, state.local);
  e.target.reset();
  state.view = "upcoming";
  load();
});

$("#export-btn").addEventListener("click", async () => {
  const msg = $("#export-msg");
  if (!state.local.length) { msg.textContent = "No device-only events to copy."; return; }
  const text = JSON.stringify(state.local.map(({ id, ...rest }) => rest), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    msg.textContent = `Copied ${state.local.length} event(s). Paste them to Claude to save them for good.`;
  } catch {
    prompt("Copy this:", text);
  }
});

load();
