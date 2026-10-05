import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDevpostDates, parseIcs, icsToEvent, devpostToEvent, makeKeywordMatcher, isInWindow, guessType,
} from "../scripts/collect.mjs";

test("devpost date ranges", () => {
  assert.deepEqual(parseDevpostDates("Sep 20 - Oct 15, 2026"), { start: "2026-09-20", end: "2026-10-15" });
  assert.deepEqual(parseDevpostDates("Oct 01 - 31, 2026"), { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(parseDevpostDates("Dec 15, 2025 - Jan 10, 2026"), { start: "2025-12-15", end: "2026-01-10" });
  assert.deepEqual(parseDevpostDates("Dec 15 - Jan 10, 2026"), { start: "2025-12-15", end: "2026-01-10" });
  assert.deepEqual(parseDevpostDates("Oct 12, 2026"), { start: "2026-10-12", end: "2026-10-12" });
  assert.equal(parseDevpostDates("whenever"), null);
  assert.equal(parseDevpostDates(""), null);
});

test("devpost hackathon becomes an event", () => {
  const ev = devpostToEvent({
    id: 42, title: "Agents Jam", url: "https://agents.devpost.com/",
    submission_period_dates: "Oct 01 - 31, 2026",
    displayed_location: { location: "Online" },
    prize_amount: "$<span data-currency-value>10,000</span>",
    themes: [{ name: "Machine Learning/AI" }], organization_name: "Acme",
  });
  assert.equal(ev.id, "devpost-42");
  assert.equal(ev.deadline, "2026-10-31");
  assert.equal(ev.online, true);
  assert.equal(ev.prize, "$10,000");
  assert.deepEqual(ev.tags, ["Machine Learning/AI"]);
});

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:abc123@lu.ma",
  "DTSTART:20261012T180000Z",
  "DTEND:20261012T210000Z",
  "SUMMARY:LLM Builders Meetup\\, London",
  "LOCATION:Shoreditch",
  "DESCRIPTION:Talks on agents. RSVP: https://lu.ma/llm-builders",
  "  now",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:def",
  "DTSTART;VALUE=DATE:20261101",
  "SUMMARY:Knitting circle",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("ics parsing, folding, escapes", () => {
  const evs = parseIcs(ICS);
  assert.equal(evs.length, 2);
  assert.equal(evs[0].SUMMARY, "LLM Builders Meetup, London");
  assert.equal(evs[0].DTSTART, "2026-10-12T18:00:00Z");
  assert.match(evs[0].DESCRIPTION, /llm-builders now$/);
  assert.equal(evs[1].DTSTART, "2026-11-01");
});

test("ics event mapping + AI filter", () => {
  const isAi = makeKeywordMatcher(["ai", "llm", "agents"]);
  const evs = parseIcs(ICS).map((e) => icsToEvent(e, { name: "London AI", platform: "Luma" }));
  assert.equal(evs[0].url, "https://lu.ma/llm-builders");
  assert.equal(evs[0].type, "meetup");
  assert.equal(evs[0].platform, "Luma");
  assert.deepEqual(evs.filter((e) => isAi(`${e.title} ${e.notes}`)).map((e) => e.title), ["LLM Builders Meetup, London"]);
});

test("keyword matcher uses whole words", () => {
  const isAi = makeKeywordMatcher(["ai", "machine learning"]);
  assert.ok(isAi("Intro to AI"));
  assert.ok(isAi("Machine   Learning night"));
  assert.ok(!isAi("Maintain your garden"));
});

test("window keeps upcoming, drops old", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  assert.ok(isInWindow({ start: "2026-10-12" }, now));
  assert.ok(!isInWindow({ start: "2026-09-01", end: "2026-09-02" }, now));
  assert.ok(isInWindow({ start: "2026-09-01", deadline: "2026-10-20" }, now));
  assert.ok(isInWindow({ start: null }, now));
});

test("type guessing", () => {
  assert.equal(guessType("Weekend Hackathon"), "hackathon");
  assert.equal(guessType("AI Summit 2026"), "conference");
  assert.equal(guessType("Prompting workshop"), "workshop");
});
