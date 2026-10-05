# Notes for Claude

This repo is the owner's personal AI-events tracker. A static page (`index.html`, `app.js`, `style.css`) shows `data/events.json` (hand-picked) and `data/discovered.json`. The second file is written daily by `scripts/collect.mjs` via GitHub Actions; never hand-edit it.

## When the owner sends a screenshot, link, or pasted text and asks to add events

1. Read every event in it. If you genuinely can't read a field, ask about it instead of guessing.
2. Append to the `events` array in `data/events.json`, one object per event:
   ```json
   {
     "title": "London LLM Builders Meetup",
     "type": "meetup",
     "platform": "Luma",
     "start": "2026-10-07T18:30:00",
     "end": "2026-10-07T21:00:00",
     "deadline": "2026-10-20",
     "location": "Shoreditch, London",
     "online": false,
     "url": "https://lu.ma/...",
     "notes": "price, RSVP status, anything useful",
     "tags": []
   }
   ```
   - `type`: meetup | conference | hackathon | webinar | workshop | other
   - `platform`: the app or site it came from
   - `start` / `end`: local time without `Z`, or `"YYYY-MM-DD"` for all-day / multi-day events. `end` is optional.
   - `deadline`: hackathon submission deadline (optional)
3. Skip duplicates (same title and same start date as an existing entry).
4. If the year isn't shown, pick the next upcoming occurrence.
5. Validate the JSON (`node -e "JSON.parse(require('fs').readFileSync('data/events.json'))"`), commit with a short message such as "Add 3 events from Luma screenshot", and push.
6. Reply with a short list of what was added, with dates in words ("Wednesday evening, Shoreditch").

## Adding a calendar feed

Add `{ "name": "...", "platform": "...", "url": "https://....ics", "filter": true }` to `ics` in `sources.json`. Run `node --test test/*.test.mjs` before pushing changes to the collector.

## Owner preferences

The owner has ADHD, autism, dyscalculia and aphantasia. Use plain words and relative dates ("this Saturday"), keep output calm and uncluttered, and say so honestly when unsure.
