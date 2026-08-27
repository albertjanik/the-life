# The Life

A shared web app for running your whole life and your household — together.
Learning, the house, the car, money, dreams and future travel in one place, with tasks
(including repeating ones), notes, habits and a single timeline of what's coming up.

Two people, two accounts, one board: whatever one of you adds shows up on the other's
screen right away.

![Overview](docs/overview.png)

## How sharing works

1. Each person creates their own account (email + password).
2. One of you creates a board — it comes with eleven ready sections.
3. That board has an invite code, e.g. `HOME-4K2P`. The other person picks **Join with a
   code** and enters it.
4. From then on you both read and write the same board, live. Every task, note and habit
   is assigned to one of you or marked **Shared**, and every view can be filtered by person.

Nobody outside the board can read a single row: access is enforced in the database itself
(Postgres row level security), not in the browser.

## Setup — about five minutes, no terminal

**1. Create the database.** Sign up at [supabase.com](https://supabase.com) and create a
free project. Any region near you is fine; keep the database password somewhere safe.

**2. Create the tables.** In the project, open **SQL Editor → New query**, paste the whole
contents of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**. It creates the
tables, the access rules and the `create_board` / `join_board` functions, and it is safe to
run again later.

**3. Turn off email confirmation** (optional, but easier for two people).
**Authentication → Sign In / Providers → Email** → switch **Confirm email** off. With it on,
each of you has to click a link in an email before the first sign-in.

**4. Copy your keys.** **Project Settings → API**: copy the **Project URL** and the
**anon public** key, and paste both into [`config.js`](config.js).

**5. Open the app.** Double-click `index.html`, or push the repository and serve it from
GitHub Pages (**Settings → Pages → Source: GitHub Actions** — the workflow is already in
`.github/workflows/pages.yml`). Then send the address to the other person.

> The anon key is meant to be public — it identifies the project, it does not grant access.
> What a signed-in person may read or write is decided by the row level security policies in
> `schema.sql`. Never put the **service_role** key in this repository.

<p align="center">
  <img src="docs/calendar.png" width="49%" alt="Calendar view">
  <img src="docs/dark.png" width="49%" alt="Dark theme">
</p>

## What's in it

| Screen | What it does |
| --- | --- |
| Sign in | Real accounts: email and password, session kept across devices |
| Boards | Your boards, create a new one, or join one with an invite code |
| Overview | Overdue / due today / this week / habits, what's next, and the section grid |
| Upcoming | Every task on one timeline: Overdue → Today → Tomorrow → This week → Next week → Later |
| Calendar | Month view; the colour bar is the section, a red outline means the date has passed |
| Habits | 14-day grid, click any day (past days included), streaks, habits belong to sections |
| Section | Tasks, notes, habits and history for that part of life |
| Sharing | Invite code (the owner can roll it), who is on the board, and their roles |

### Life sections

Learning · Dreams · Travel · Household · Car · Finances ·
Health & Fitness · Work & Career · Family & Friends · Shopping & Pantry · Documents & Renewals

Sections are data, not code — rename them in the `sections` table, or add your own with
**New section** in the sidebar.

### Repeating tasks

A task can repeat: `daily`, `weekly`, `every 2 weeks`, `monthly`, `quarterly`, `yearly`.
Ticking a repeating task does not close it — it jumps to its next date, catching up on any
occurrences that were missed.

The interface is in English; everything you type — tasks, notes, sections, habits — is free
text, so keeping the content in Polish (or any other language) works fine.

## How it is built

| | |
| --- | --- |
| `index.html` | page shell |
| `styles.css` | all styling; light and dark themes driven by CSS custom properties |
| `app.js` | the whole app: auth, data, realtime, rendering (vanilla JS, no framework) |
| `config.js` | your project URL and anon key |
| `vendor/supabase.js` | supabase-js v2, vendored so the app has no CDN dependency |
| `supabase/schema.sql` | tables, row level security policies, RPC functions, realtime |

No build step and no package manager: what is in the repository is what runs.

## Roadmap

- [ ] Notifications (push / email) for upcoming and overdue dates
- [ ] Subtasks, attachments and comments on tasks
- [ ] Editing sections and tasks in place (rename, move, reschedule by drag)
- [ ] Per-section privacy — a section only one of you can see
- [ ] iCal export so dates land in a normal calendar
- [ ] PWA with offline mode

## Licence

MIT — see [LICENSE](LICENSE).
