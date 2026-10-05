# 🗓️ AI Events Hub

One calm place for every AI meetup, conference, workshop and hackathon, whichever app or website it came from.

## The three ways events get in

| How | What you do | Where it's saved |
|---|---|---|
| **📸 Screenshot / link → Claude** (easiest) | Send Claude a screenshot or link and say *"add this to my events"* | `data/events.json` (forever, every device) |
| **🤖 The robot** | Nothing. Every morning it searches for AI hackathons and checks any calendar feeds you've added | `data/discovered.json` → shows up in **New finds** |
| **✍️ By hand on the page** | "➕ Add an event by hand" at the bottom | This browser only (use "Copy my device-only events" and paste to Claude to keep them for good) |

## Using the page

- **Coming up**: everything ahead of you, grouped as *Today / Tomorrow / This week / Next week / by month*.
- **New finds**: the robot's discoveries you haven't sorted yet. Tap ⭐ Interested, ✅ Going, or 🙈 Not for me to sort them.
- **My plans**: just your ⭐ and ✅ events.
- **📅 Calendar** adds an event to Google Calendar in one tap.
- Hackathons show their **submission deadline**, which turns red with ⚠️ when it's 3 days away or less.

Your ⭐/✅/🙈 choices are saved in the browser you tapped them in (they don't sync between phone and laptop yet).

## Where the robot looks (`sources.json`)

- **Devpost**: searches AI / machine learning / LLM / agents hackathons. This uses Devpost's public but unofficial search, so it could change without warning. If it breaks, the page header shows `Devpost ✗`.
- **Calendar feeds (iCal)** work with lots of platforms:
  - **Luma**: open a calendar → *Subscribe* → copy the iCal link
  - **Meetup**: `https://www.meetup.com/GROUP-NAME/events/ical/`
  - **Google Calendar**, Eventbrite organizer feeds, and anything else that gives you an `.ics` link.

  Paste the link into the `ics` list in `sources.json` (or give it to Claude to add). Only AI-related events are kept, based on the `keywords` list. Set `"filter": false` on a feed to keep everything from it.

The robot runs daily at 06:17 UTC. To run it right now: **Actions** tab → *Find new AI events* → **Run workflow**.

## Putting the page online (one-time)

**Settings → Pages → Build and deployment → Source: "Deploy from a branch" → Branch: `main` / `(root)` → Save.**
A minute later it's live at `https://<your-username>.github.io/ai-events-hub/`.

## For tinkerers

No build step, no dependencies. `node scripts/collect.mjs` runs the robot, `node --test test/*.test.mjs` runs the tests, `npx serve .` previews the page.
