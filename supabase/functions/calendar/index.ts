// The Life — a read-only calendar feed.
//
// One address, one person. A calendar app subscribes to it and asks for it
// every so often; we answer with the board's dated tasks in iCalendar form.
// There is no sign-in in that conversation — the token in the address is the
// key, which is why it is long, random and can be thrown away.
//
// Deploy: Supabase → Edge Functions → Deploy a new function → name it
// "calendar", paste this file, and turn **Verify JWT** OFF. With it on, the
// calendar app gets a 401 and the subscription never works.
//
// Nothing to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already
// in the environment here. The service key never leaves this function.

const BASE = Deno.env.get("SUPABASE_URL") ?? "";
const KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";

const WORDS: Record<string, Record<string, string>> = {
  en: {
    shared: "Shared",
    steps: "Steps",
    repeats: "Repeats",
    open: "Open in The Life",
    important: "Important",
    calname: "The Life",
    daily: "every day",
    weekly: "every week",
    biweekly: "every 2 weeks",
    monthly: "every month",
    quarterly: "every 3 months",
    yearly: "every year",
  },
  pl: {
    shared: "Wspólne",
    steps: "Kroki",
    repeats: "Powtarza się",
    open: "Otwórz w The Life",
    important: "Ważne",
    calname: "The Life",
    daily: "codziennie",
    weekly: "co tydzień",
    biweekly: "co 2 tygodnie",
    monthly: "co miesiąc",
    quarterly: "co 3 miesiące",
    yearly: "co rok",
  },
};

const RRULE: Record<string, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  biweekly: "FREQ=WEEKLY;INTERVAL=2",
  monthly: "FREQ=MONTHLY",
  quarterly: "FREQ=MONTHLY;INTERVAL=3",
  yearly: "FREQ=YEARLY",
};

/* ------------------------------------------------------------ iCalendar */

/* Semicolons, commas and backslashes carry meaning in this format. */
const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/* Lines are capped at 75 octets and continue with a leading space. Polish
   letters and emoji are several octets each, so we count bytes, not
   characters, and never cut one in half. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const dec = new TextDecoder();
  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(dec.decode(bytes.slice(start, end)));
    start = end;
    limit = 74;
  }
  return out.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (isoDay: string) => isoDay.replace(/-/g, "");

const nextDay = (isoDay: string) => {
  const d = new Date(isoDay + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/* ------------------------------------------------------------- the data */

async function get(path: string) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return await r.json();
}

/* So you can see in the table editor whether the phone is really asking. */
function touch(token: string) {
  fetch(`${BASE}/rest/v1/calendar_feeds?token=eq.${token}`, {
    method: "PATCH",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ last_seen: new Date().toISOString() }),
  }).catch(() => {});
}

/* --------------------------------------------------------------- serve */

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const lang = url.searchParams.get("lang") === "pl" ? "pl" : "en";
  const app = url.searchParams.get("app") ?? "";
  const w = WORDS[lang];

  /* The token is pasted into a database filter, so it is checked first. */
  if (!/^[0-9a-f]{32,64}$/.test(token)) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  try {
    const feeds = await get(`calendar_feeds?token=eq.${token}&select=board_id,user_id`);
    if (!feeds.length) return new Response("Not found", { status: 404, headers: cors });
    const board_id: string = feeds[0].board_id;
    touch(token);

    const [boards, sections, members, tasks, subtasks] = await Promise.all([
      get(`boards?id=eq.${board_id}&select=name`),
      get(`sections?board_id=eq.${board_id}&select=id,name,emoji`),
      get(`board_members?board_id=eq.${board_id}&select=user_id,display_name`),
      get(
        `tasks?board_id=eq.${board_id}&done=eq.false&due_date=not.is.null` +
          `&select=id,title,description,due_date,recurrence,recur_from_completion,important,assignee_id,section_id`,
      ),
      get(`subtasks?board_id=eq.${board_id}&select=task_id,title,done,position&order=position.asc`),
    ]);

    const sectionOf = new Map(sections.map((s: any) => [s.id, s]));
    const nameOf = new Map(members.map((m: any) => [m.user_id, m.display_name]));
    const stepsOf = new Map<string, any[]>();
    for (const s of subtasks) {
      if (!stepsOf.has(s.task_id)) stepsOf.set(s.task_id, []);
      stepsOf.get(s.task_id)!.push(s);
    }

    const now = stamp(new Date());
    const L: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//The Life//Board//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc(boards[0]?.name || w.calname)}`,
      "X-WR-TIMEZONE:Europe/Warsaw",
      /* a polite hint; every calendar app still keeps its own rhythm */
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
    ];

    for (const task of tasks) {
      const sec: any = sectionOf.get(task.section_id);
      const who = task.assignee_id ? nameOf.get(task.assignee_id) || "" : w.shared;

      const title = [sec?.emoji, task.title].filter(Boolean).join(" ");
      const summary = who ? `${title} · ${who}` : title;

      const body: string[] = [];
      if (task.description) body.push(task.description);
      const steps = stepsOf.get(task.id) || [];
      if (steps.length) {
        body.push(`${w.steps}:\n` + steps.map((s) => `${s.done ? "☑" : "☐"} ${s.title}`).join("\n"));
      }
      const facts: string[] = [];
      if (who) facts.push(who);
      if (sec?.name) facts.push(sec.name);
      if (task.recurrence) {
        facts.push(`${w.repeats} ${w[task.recurrence] || task.recurrence}`);
      }
      if (task.important) facts.push(w.important);
      if (facts.length) body.push(facts.join(" · "));
      if (app) body.push(`${w.open}: ${app}`);

      L.push("BEGIN:VEVENT");
      L.push(`UID:${task.id}@the-life`);
      L.push(`DTSTAMP:${now}`);
      L.push(`DTSTART;VALUE=DATE:${dateOnly(task.due_date)}`);
      L.push(`DTEND;VALUE=DATE:${dateOnly(nextDay(task.due_date))}`);
      L.push(`SUMMARY:${esc(summary)}`);
      if (body.length) L.push(`DESCRIPTION:${esc(body.join("\n\n"))}`);
      if (sec?.name) L.push(`CATEGORIES:${esc(sec.name)}`);
      /* A day of the house is not a meeting: it should not read as busy. */
      L.push("TRANSP:TRANSPARENT");
      L.push("SEQUENCE:0");
      L.push("STATUS:CONFIRMED");
      if (task.important) L.push("PRIORITY:1");
      /* The fixed rhythm is a rule a calendar can follow on its own.
         "Count from when it's ticked off" has no rule — that date only exists
         once it happens, so it comes back on the next refresh instead. */
      if (task.recurrence && !task.recur_from_completion && RRULE[task.recurrence]) {
        L.push(`RRULE:${RRULE[task.recurrence]}`);
      }
      /* An all-day event starts at midnight, so four hours before it is
         20:00 the evening before — in the phone's own timezone. */
      L.push("BEGIN:VALARM");
      L.push("ACTION:DISPLAY");
      L.push("TRIGGER:-PT4H");
      L.push(`DESCRIPTION:${esc(summary)}`);
      L.push("END:VALARM");
      L.push("END:VEVENT");
    }

    L.push("END:VCALENDAR");

    return new Response(L.map(fold).join("\r\n") + "\r\n", {
      headers: {
        ...cors,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="the-life.ics"',
        "Cache-Control": "public, max-age=900",
      },
    });
  } catch (e) {
    return new Response(`Calendar error: ${e}`, { status: 500, headers: cors });
  }
});
