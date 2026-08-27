/* The Life — shared life & household board.
   Front end only: accounts, storage and realtime come from Supabase. */

const { createClient } = window.supabase;   // vendor/supabase.js (supabase-js v2)

const CFG = window.THE_LIFE_CONFIG || {};
const root = document.getElementById("root");

/* ------------------------------------------------------------- utilities */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; };

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("on"), 2600);
}

const DAY = 86400000;
const today = new Date(); today.setHours(0, 0, 0, 0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDate = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const off = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const diff = (s) => Math.round((parseDate(s) - today) / DAY);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const plural = (n, w) => (n === 1 ? w : w + "s");

function human(s) {
  const n = diff(s), d = parseDate(s);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "1 day overdue";
  if (n < 0) return `${Math.abs(n)} days overdue`;
  if (n < 7) return DOW[d.getDay()];
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

const REC = { daily: "daily", weekly: "weekly", biweekly: "every 2 weeks", monthly: "monthly", quarterly: "quarterly", yearly: "yearly" };

function nextDate(s, rec) {
  const d = parseDate(s);
  const step = () => {
    if (rec === "daily") d.setDate(d.getDate() + 1);
    else if (rec === "weekly") d.setDate(d.getDate() + 7);
    else if (rec === "biweekly") d.setDate(d.getDate() + 14);
    else if (rec === "monthly") d.setMonth(d.getMonth() + 1);
    else if (rec === "quarterly") d.setMonth(d.getMonth() + 3);
    else if (rec === "yearly") d.setFullYear(d.getFullYear() + 1);
  };
  step();
  let guard = 0;
  while (d < today && rec !== "yearly" && guard++ < 400) step();
  return iso(d);
}

/* ------------------------------------------------------------- setup gate */

if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
  root.innerHTML = `<div class="setup">
    <div class="brand" style="margin-bottom:14px"><div class="brand-mark">TL</div><div class="brand-name">The Life</div></div>
    <h1>Almost there — connect a database</h1>
    <p style="color:var(--ink-2)">The app needs a free Supabase project to keep accounts and shared data. It takes about five minutes, all in the browser.</p>
    <ol>
      <li>Create a project at <strong>supabase.com</strong>.</li>
      <li>Open <strong>SQL Editor → New query</strong>, paste everything from <code>supabase/schema.sql</code> and press <strong>Run</strong>.</li>
      <li>Open <strong>Project Settings → API</strong> and copy the <strong>Project URL</strong> and the <strong>anon public</strong> key.</li>
      <li>Paste both into <code>config.js</code> and reload this page.</li>
    </ol>
    <p class="hint">Full walkthrough: see the README in the repository.</p>
  </div>`;
  throw new Error("The Life: config.js is not filled in yet.");
}

const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ------------------------------------------------------------- state */

const state = {
  user: null,
  boards: [],
  board: null,
  members: [],
  sections: [],
  tasks: [],
  notes: [],
  habits: [],
  days: new Set(),        // "habitId|YYYY-MM-DD"
  view: { type: "overview" },
  who: "all",             // "all" | user_id | "shared"
  tab: "tasks",
  calMonth: new Date(today.getFullYear(), today.getMonth(), 1),
  live: false,
  authTab: "in"
};

const secById = (id) => state.sections.find((s) => s.id === id) || { name: "—", hue: 163, code: "??", description: "" };
const memberById = (id) => state.members.find((m) => m.user_id === id);
const me = () => memberById(state.user?.id);

function initials(name) {
  const parts = String(name || "?").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

/* ------------------------------------------------------------- auth screens */

function renderAuth(msg, err) {
  root.className = "auth";
  root.innerHTML = `
    <div class="auth-art">
      <div class="brand"><div class="brand-mark">TL</div><div class="brand-name">The Life</div></div>
      <div class="auth-lede">
        <h1>Your whole life, on one board.</h1>
        <p>Learning, the house, the car, money, dreams and future trips — kept together with the person you share your life with. Every task, with dates and repeats, lands on a single timeline.</p>
      </div>
      <div class="art-grid">
        <div class="art-cell" style="--h:210"><div class="k">Car</div><div class="v">Inspection</div><div class="s">a date neither of you forgets</div></div>
        <div class="art-cell" style="--h:38"><div class="k">Finances</div><div class="v">Bills</div><div class="s">repeating, on their own</div></div>
        <div class="art-cell" style="--h:230"><div class="k">Learning</div><div class="v">Exams</div><div class="s">progress you can see</div></div>
        <div class="art-cell" style="--h:196"><div class="k">Travel</div><div class="v">Someday</div><div class="s">plans that stay alive</div></div>
      </div>
    </div>
    <div class="auth-form">
      <div class="tabs tabs-auth">
        <button class="tab ${state.authTab === "in" ? "on" : ""}" data-act="auth-tab" data-tab="in">Sign in</button>
        <button class="tab ${state.authTab === "up" ? "on" : ""}" data-act="auth-tab" data-tab="up">Create account</button>
      </div>
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      ${msg ? `<div class="ok-msg">${esc(msg)}</div>` : ""}
      ${state.authTab === "up" ? `<div class="field"><label for="a-name">Your name</label><input id="a-name" type="text" placeholder="How your partner will see you" autocomplete="name"></div>` : ""}
      <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email"></div>
      <div class="field"><label for="a-pass">Password</label><input id="a-pass" type="password" autocomplete="${state.authTab === "up" ? "new-password" : "current-password"}"></div>
      <button class="btn btn-primary" data-act="${state.authTab === "up" ? "sign-up" : "sign-in"}">${state.authTab === "up" ? "Create account" : "Sign in"}</button>
      <p class="hint">${state.authTab === "up"
        ? "Both of you create your own account. One of you makes the board, the other joins it with an invite code."
        : "Signed in on any device, you land on the same board."}</p>
    </div>`;
  ($("a-name") || $("a-email"))?.focus();
}

async function signIn() {
  const email = $("a-email").value.trim(), password = $("a-pass").value;
  if (!email || !password) return renderAuth(null, "Enter your email and password.");
  root.classList.add("busy");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  root.classList.remove("busy");
  if (error) return renderAuth(null, error.message);
}

async function signUp() {
  const email = $("a-email").value.trim(), password = $("a-pass").value;
  const display_name = ($("a-name")?.value || "").trim();
  if (!email || !password) return renderAuth(null, "Enter your email and password.");
  if (password.length < 6) return renderAuth(null, "Password needs at least 6 characters.");
  root.classList.add("busy");
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name } } });
  root.classList.remove("busy");
  if (error) return renderAuth(null, error.message);
  if (!data.session) {
    state.authTab = "in";
    return renderAuth("Account created. Confirm the email we sent, then sign in.");
  }
}

/* ------------------------------------------------------------- board picker */

async function loadBoards() {
  const { data, error } = await sb
    .from("board_members")
    .select("role, board:boards(id, name, invite_code, created_at)")
    .eq("user_id", state.user.id)
    .order("joined_at", { ascending: true });
  if (error) { toast(error.message); return []; }
  return (data || []).filter((r) => r.board).map((r) => ({ ...r.board, role: r.role }));
}

async function renderBoardPicker(err) {
  root.className = "auth";
  state.boards = await loadBoards();
  const name = state.user?.user_metadata?.display_name || state.user?.email || "";
  root.innerHTML = `
    <div class="auth-art">
      <div class="brand"><div class="brand-mark">TL</div><div class="brand-name">The Life</div></div>
      <div class="auth-lede">
        <h1>One board, two people.</h1>
        <p>A board belongs to the household, not to one person. Create one and send the invite code — whoever enters it sees the same sections, tasks and habits, live.</p>
      </div>
      <div class="art-grid" style="grid-template-columns:1fr">
        <div class="art-cell" style="--h:163"><div class="k">Owner</div><div class="v">Full access</div><div class="s">creates the board, shares the code</div></div>
        <div class="art-cell" style="--h:288"><div class="k">Member</div><div class="v">Full access</div><div class="s">joins with the code, edits everything</div></div>
      </div>
    </div>
    <div class="auth-form">
      <div class="row" style="justify-content:space-between">
        <div><h1 style="font-size:26px">Your boards</h1>
        <p class="hint" style="margin:4px 0 0">Signed in as <strong>${esc(state.user?.email || "")}</strong></p></div>
        <button class="btn btn-ghost btn-sm" data-act="sign-out">Sign out</button>
      </div>
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      ${state.boards.length
        ? `<div class="panel-pick">${state.boards.map((b) => `
            <button class="board-row" data-act="open-board" data-id="${b.id}">
              <span class="chip chip-lg" style="--h:163">${esc(initials(b.name))}</span>
              <span><span class="nm">${esc(b.name)}</span><br><span class="sub mono">${esc(b.invite_code)} · ${esc(b.role)}</span></span>
            </button>`).join("")}</div>`
        : `<div class="empty">No boards yet. Create one, or join with a code your partner sent you.</div>`}
      <div class="divider">create or join</div>
      <div class="panel-pick">
        <div class="pick-card">
          <h3>Create a board</h3>
          <p>Comes with eleven ready sections — rename or ignore whichever you like.</p>
          <div class="row" style="margin-top:6px">
            <input type="text" id="new-board" placeholder="e.g. ${esc(name.split("@")[0] || "Our")} &amp; me" style="flex:1">
            <button class="btn btn-primary btn-sm" data-act="create-board">Create</button>
          </div>
        </div>
        <div class="pick-card">
          <h3>Join with a code</h3>
          <p>Enter the invite code from the other person's board.</p>
          <div class="row" style="margin-top:6px">
            <input type="text" id="join-code" class="mono" placeholder="HOME-4K2P" style="flex:1">
            <button class="btn btn-ghost btn-sm" data-act="join-board">Join</button>
          </div>
        </div>
      </div>
    </div>`;
}

async function createBoard() {
  const name = $("new-board").value.trim() || "Our board";
  root.classList.add("busy");
  const { data, error } = await sb.rpc("create_board", { p_name: name, p_display_name: displayName() });
  root.classList.remove("busy");
  if (error) return renderBoardPicker(error.message);
  await openBoard(data);
}

async function joinBoard() {
  const code = $("join-code").value.trim();
  if (!code) return renderBoardPicker("Enter the invite code first.");
  root.classList.add("busy");
  const { data, error } = await sb.rpc("join_board", { p_code: code, p_display_name: displayName() });
  root.classList.remove("busy");
  if (error) return renderBoardPicker(error.message.includes("not found") ? "No board with that code." : error.message);
  toast("Joined the board.");
  await openBoard(data);
}

const displayName = () =>
  state.user?.user_metadata?.display_name || (state.user?.email || "").split("@")[0] || "Me";

/* ------------------------------------------------------------- data loading */

let channel = null;

async function openBoard(id) {
  root.className = "center-screen";
  root.innerHTML = `<span class="spin" aria-label="Loading"></span>`;
  localStorage.setItem("thelife-board", id);
  const { data: board, error } = await sb.from("boards").select("*").eq("id", id).single();
  if (error) { localStorage.removeItem("thelife-board"); return renderBoardPicker(error.message); }
  state.board = board;
  state.view = { type: "overview" };
  await refreshAll();
  subscribe(id);
  renderApp();
}

async function refreshAll() {
  const id = state.board.id;
  const [members, profiles, sections, tasks, notes, habits, days] = await Promise.all([
    sb.from("board_members").select("*").eq("board_id", id),
    sb.from("profiles").select("id, email, display_name"),
    sb.from("sections").select("*").eq("board_id", id).order("position"),
    sb.from("tasks").select("*").eq("board_id", id),
    sb.from("notes").select("*").eq("board_id", id).order("created_at", { ascending: false }),
    sb.from("habits").select("*").eq("board_id", id).order("created_at"),
    sb.from("habit_days").select("habit_id, day").eq("board_id", id).gte("day", off(-70))
  ]);
  const profs = profiles.data || [];
  state.members = (members.data || []).map((m) => {
    const p = profs.find((x) => x.id === m.user_id);
    return { ...m, display_name: m.display_name || p?.display_name || p?.email || "Member", email: p?.email || "" };
  });
  state.sections = sections.data || [];
  state.tasks = tasks.data || [];
  state.notes = notes.data || [];
  state.habits = habits.data || [];
  state.days = new Set((days.data || []).map((d) => `${d.habit_id}|${d.day}`));
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => { await refreshAll(); renderApp(); }, 250);
}

function subscribe(boardId) {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel(`board:${boardId}`);
  ["sections", "tasks", "notes", "habits", "habit_days", "board_members"].forEach((table) => {
    channel.on("postgres_changes",
      { event: "*", schema: "public", table, filter: `board_id=eq.${boardId}` }, scheduleRefresh);
  });
  channel.on("postgres_changes",
    { event: "*", schema: "public", table: "boards", filter: `id=eq.${boardId}` }, scheduleRefresh);
  channel.subscribe((status) => {
    state.live = status === "SUBSCRIBED";
    const led = document.querySelector(".sync");
    if (led) { led.classList.toggle("off", !state.live); led.lastChild.textContent = state.live ? " live" : " offline"; }
  });
}

/* ------------------------------------------------------------- mutations */

async function run(promise, okMsg) {
  const { error } = await promise;
  if (error) { toast(error.message); await refreshAll(); }
  else if (okMsg) toast(okMsg);
  renderApp();
}

const boardId = () => state.board.id;

async function addTask({ title, section_id, due_date, recurrence, assignee_id, important }) {
  if (!title.trim()) return toast("Type what needs doing first.");
  const row = {
    board_id: boardId(), section_id, title: title.trim(), due_date: due_date || off(0),
    recurrence: recurrence || null, assignee_id: assignee_id || null,
    important: !!important, created_by: state.user.id
  };
  state.tasks.push({ ...row, id: "tmp" + Math.random(), done: false });
  renderApp();
  await run(sb.from("tasks").insert(row), `Added to “${secById(section_id).name}”.`);
  await refreshAll(); renderApp();
}

async function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.recurrence && !t.done) {
    const nd = nextDate(t.due_date, t.recurrence);
    t.due_date = nd; renderApp();
    await run(sb.from("tasks").update({ due_date: nd }).eq("id", id), `Done. Next time: ${human(nd)}.`);
  } else {
    const done = !t.done;
    t.done = done; renderApp();
    await run(sb.from("tasks").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", id));
  }
}

async function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id); renderApp();
  await run(sb.from("tasks").delete().eq("id", id), "Task deleted.");
}

async function addNote(section_id) {
  const title = $("nt-title").value.trim(), body = $("nt-body").value.trim();
  if (!title) return toast("A note needs a title.");
  await run(sb.from("notes").insert({ board_id: boardId(), section_id, title, body, created_by: state.user.id }), "Note saved.");
  await refreshAll(); renderApp();
}

async function deleteNote(id) {
  state.notes = state.notes.filter((n) => n.id !== id); renderApp();
  await run(sb.from("notes").delete().eq("id", id), "Note deleted.");
}

async function addHabit() {
  const name = $("hb-name").value.trim();
  if (!name) return toast("Give the habit a name.");
  const section_id = $("hb-sec").value;
  const assignee_id = $("hb-who").value === "shared" ? null : $("hb-who").value;
  await run(sb.from("habits").insert({ board_id: boardId(), section_id, name, assignee_id, target: "every day" }), "Habit added.");
  await refreshAll(); renderApp();
}

async function toggleHabitDay(habit_id, day) {
  const key = `${habit_id}|${day}`;
  if (state.days.has(key)) {
    state.days.delete(key); renderApp();
    await run(sb.from("habit_days").delete().eq("habit_id", habit_id).eq("day", day));
  } else {
    state.days.add(key); renderApp();
    await run(sb.from("habit_days").insert({ habit_id, day, board_id: boardId(), user_id: state.user.id }));
  }
}

async function addSection(name) {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "section" + Date.now();
  const hue = Math.floor(Math.random() * 360);
  const code = name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "NS";
  await run(sb.from("sections").insert({
    board_id: boardId(), key, name, code, hue, description: "",
    position: (state.sections.at(-1)?.position || 0) + 1
  }), `Section “${name}” added.`);
  await refreshAll(); renderApp();
}

/* ------------------------------------------------------------- view helpers */

function whoOk(row) {
  if (state.who === "all") return true;
  if (state.who === "shared") return row.assignee_id === null;
  return row.assignee_id === state.who || row.assignee_id === null;
}
const openTasks = () => state.tasks.filter((t) => !t.done && whoOk(t));

function whoBadge(assignee_id) {
  if (!assignee_id) return `<span class="who" style="background:linear-gradient(105deg,hsl(163 45% 32%) 50%,hsl(288 35% 42%) 50%);color:#fff" title="Shared">◑</span>`;
  const m = memberById(assignee_id);
  const hue = m?.hue ?? 163;
  return `<span class="who" style="background:hsl(${hue} 42% 35%);color:#fff" title="${esc(m?.display_name || "Member")}">${esc(initials(m?.display_name))}</span>`;
}

function taskHTML(t) {
  const s = secById(t.section_id), n = diff(t.due_date);
  const cls = n < 0 ? "od" : n === 0 ? "td" : "";
  return `<div class="task${t.done ? " done" : ""}" style="--h:${s.hue}" data-id="${t.id}">
    <button class="tick" data-act="toggle" data-id="${t.id}" aria-label="Mark as done">
      <svg viewBox="0 0 12 12" fill="none" stroke="${t.done ? "var(--on-accent)" : "currentColor"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 6.3 4.4 9.2 10.5 3"/></svg>
    </button>
    <div class="t-main"><div class="t-title">${esc(t.title)}</div>
      <div class="t-meta">
        <span class="sec">${esc(s.name)}</span><span>·</span>
        <span class="t-date ${cls}">${human(t.due_date)}</span>
        ${t.recurrence ? `<span class="badge rec">↻ ${REC[t.recurrence]}</span>` : ""}
        ${t.important ? `<span class="badge pri">important</span>` : ""}
      </div>
    </div>
    ${whoBadge(t.assignee_id)}
    <button class="del" data-act="del-task" data-id="${t.id}" aria-label="Delete task">×</button>
  </div>`;
}

function groupsHTML(list) {
  const groups = [
    { k: "overdue", t: "Overdue", items: [] }, { k: "today", t: "Today", items: [] },
    { k: "tom", t: "Tomorrow", items: [] }, { k: "week", t: "This week", items: [] },
    { k: "next", t: "Next week", items: [] }, { k: "later", t: "Later", items: [] }
  ];
  [...list].sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0)).forEach((t) => {
    const n = diff(t.due_date);
    if (n < 0) groups[0].items.push(t);
    else if (n === 0) groups[1].items.push(t);
    else if (n === 1) groups[2].items.push(t);
    else if (n <= 7) groups[3].items.push(t);
    else if (n <= 14) groups[4].items.push(t);
    else groups[5].items.push(t);
  });
  const out = groups.filter((g) => g.items.length).map((g) =>
    `<section class="tgroup ${g.k}"><div class="tgroup-head"><h3>${g.t}</h3><span class="n">${g.items.length}</span></div>
     <div class="tlist">${g.items.map(taskHTML).join("")}</div></section>`).join("");
  return out || `<div class="empty">Nothing here yet. Add the first task with “New task”.</div>`;
}

function filtersHTML() {
  const opts = [["all", "Everyone"], ...state.members.map((m) => [m.user_id, m.display_name]), ["shared", "Shared"]];
  return `<div class="filters">${opts.map(([v, label]) =>
    `<button class="fchip${state.who === v ? " on" : ""}" data-act="who" data-who="${v}">${esc(label)}</button>`).join("")}</div>`;
}

function assigneeOptions(selected) {
  return [...state.members.map((m) => `<option value="${m.user_id}"${selected === m.user_id ? " selected" : ""}>${esc(m.display_name)}</option>`),
    `<option value="shared"${selected === "shared" ? " selected" : ""}>Shared</option>`].join("");
}
const sectionOptions = (sel) =>
  state.sections.map((s) => `<option value="${s.id}"${sel === s.id ? " selected" : ""}>${esc(s.name)}</option>`).join("");

const habitDays = (n = 14) => Array.from({ length: n }, (_, i) => off(-(n - 1 - i)));
const ticked = (h, d) => state.days.has(`${h.id}|${d}`);
function streak(h) { let s = 0; for (let k = 0; k < 90; k++) { if (ticked(h, off(-k))) s++; else if (k > 0) break; } return s; }

/* ------------------------------------------------------------- views */

function viewOverview() {
  const act = openTasks();
  const od = act.filter((t) => diff(t.due_date) < 0);
  const td = act.filter((t) => diff(t.due_date) === 0);
  const wk = act.filter((t) => { const n = diff(t.due_date); return n > 0 && n <= 7; });
  const habToday = state.habits.filter((h) => ticked(h, off(0))).length;
  const next = [...act].sort((a, b) => (a.due_date < b.due_date ? -1 : 1)).slice(0, 6);
  const d = new Date();
  return `<div class="row" style="justify-content:space-between;margin-bottom:16px">
      <div><h2 style="font-size:21px">Hi, ${esc((me()?.display_name || displayName()).split(" ")[0])}.</h2>
      <p class="hint" style="margin:2px 0 0">${DOW[d.getDay()]}, ${d.getDate()} ${MONL[d.getMonth()]} ${d.getFullYear()}</p></div>
      ${filtersHTML()}</div>
    <div class="grid-stats">
      <div class="stat${od.length ? " crit" : ""}"><div class="k">Overdue</div><div class="v tnum">${od.length}</div><div class="s">${od.length ? "needs attention" : "all on time"}</div></div>
      <div class="stat warn"><div class="k">Due today</div><div class="v tnum">${td.length}</div><div class="s">${plural(td.length, "task")} scheduled</div></div>
      <div class="stat"><div class="k">This week</div><div class="v tnum">${wk.length}</div><div class="s">within 7 days</div></div>
      <div class="stat"><div class="k">Habits today</div><div class="v tnum">${habToday}/${state.habits.length}</div><div class="s">ticked off</div></div>
    </div>
    <div class="ov-grid" style="display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:14px;margin-top:16px">
      <div class="card"><div class="card-head"><h2>Coming up next</h2><div class="spacer"></div>
        <button class="btn btn-ghost btn-sm" data-act="go" data-view="upcoming">Full list</button></div>
        <div class="card-body"><div class="tlist">${next.length ? next.map(taskHTML).join("") : `<div class="empty">Nothing waiting.</div>`}</div></div></div>
      <div class="card"><div class="card-head"><h2>Habits today</h2></div><div>
        ${state.habits.length ? state.habits.map((h) => `
          <div class="hab" style="--h:${secById(h.section_id).hue}">
            <div class="hab-name"><div class="n">${esc(h.name)}</div><div class="s">${esc(h.target)}</div></div>
            <button class="hcell today${ticked(h, off(0)) ? " on" : ""}" data-act="habit" data-id="${h.id}" data-day="${off(0)}" aria-label="Tick off"></button>
          </div>`).join("") : `<div class="empty" style="margin:14px">No habits yet.</div>`}
      </div></div>
    </div>
    <h2 style="font-size:16px;margin:22px 0 10px">Sections</h2>
    <div class="sec-grid">${state.sections.map((s) => {
      const n = openTasks().filter((t) => t.section_id === s.id).length;
      const soon = openTasks().filter((t) => t.section_id === s.id).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
      const notes = state.notes.filter((x) => x.section_id === s.id).length;
      return `<button class="sec-card" style="--h:${s.hue}" data-act="go" data-view="section" data-sec="${s.id}">
        <div class="row" style="gap:9px"><span class="chip chip-lg">${esc(s.code)}</span><span class="nm">${esc(s.name)}</span></div>
        <div class="ln mono" style="font-size:12px">${n} ${plural(n, "task")} · ${notes} ${plural(notes, "note")}</div>
        <div class="bar"><i style="width:${Math.min(100, n * 14 + 8)}%"></i></div>
        <div class="ln">${soon ? `Next: ${esc(soon.title)} (${human(soon.due_date)})` : "No open tasks"}</div>
      </button>`;
    }).join("")}</div>`;
}

function quickAddHTML(sectionId) {
  return `<div class="qa" style="margin-bottom:8px">
    <input type="text" id="qa-title" placeholder="${sectionId ? `New task in ${esc(secById(sectionId).name)}…` : "Add a task and press Enter…"}">
    ${sectionId ? `<input type="hidden" id="qa-sec" value="${sectionId}">` : `<select id="qa-sec">${sectionOptions()}</select>`}
    <input type="date" id="qa-date" value="${off(0)}">
    <select id="qa-rec"><option value="">one-off</option>${Object.keys(REC).map((k) => `<option value="${k}">${REC[k]}</option>`).join("")}</select>
    <select id="qa-who">${assigneeOptions(state.user.id)}</select>
    <button class="btn btn-primary btn-sm" data-act="qa">Add</button>
  </div>`;
}

function viewUpcoming() {
  return `<div class="row" style="justify-content:space-between;margin-bottom:14px">${filtersHTML()}
      <button class="btn btn-ghost btn-sm" data-act="go" data-view="calendar">Calendar view</button></div>
    ${quickAddHTML(null)}${groupsHTML(openTasks())}`;
}

function viewCalendar() {
  const m = state.calMonth, y = m.getFullYear(), mo = m.getMonth();
  const startDow = (new Date(y, mo, 1).getDay() + 6) % 7;
  const start = new Date(y, mo, 1 - startDow);
  let cells = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = iso(d), isOut = d.getMonth() !== mo, isToday = key === off(0);
    const evs = state.tasks.filter((t) => t.due_date === key && !t.done && whoOk(t));
    cells += `<div class="cal-day${isOut ? " out" : ""}${isToday ? " today" : ""}"><div class="cal-num">${d.getDate()}</div>
      ${evs.slice(0, 3).map((t) => `<div class="cal-ev${diff(t.due_date) < 0 ? " od" : ""}" style="--h:${secById(t.section_id).hue}" title="${esc(t.title)}">${esc(t.title)}</div>`).join("")}
      ${evs.length > 3 ? `<div class="cal-more">+${evs.length - 3} more</div>` : ""}</div>`;
  }
  return `<div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div class="row"><button class="btn btn-ghost btn-sm" data-act="cal" data-d="-1">‹</button>
      <h2 style="font-size:18px;min-width:186px;text-align:center">${MONL[mo]} ${y}</h2>
      <button class="btn btn-ghost btn-sm" data-act="cal" data-d="1">›</button>
      <button class="btn btn-ghost btn-sm" data-act="cal" data-d="0">Today</button></div>
      ${filtersHTML()}</div>
    <div class="cal">${cells}</div>
    <p class="hint" style="margin-top:10px">The colour bar on each task is its section. A red outline means the date has passed.</p>`;
}

function viewHabits() {
  const days = habitDays();
  const visible = state.habits.filter((h) => whoOk(h));
  return `<div class="row" style="justify-content:space-between;margin-bottom:14px">
      <p class="hint" style="margin:0;max-width:60ch">Last 14 days. Click a cell to tick a day off — earlier days included. Every habit belongs to a section, so it shows up there too.</p>
      ${filtersHTML()}</div>
    <div class="card"><div class="card-head"><h2>Habits</h2><div class="spacer"></div>
      <span class="hint mono" style="font-size:11px">${parseDate(days[0]).getDate()} ${MON[parseDate(days[0]).getMonth()]} → today</span></div>
      <div>${visible.length ? visible.map((h) => `
        <div class="hab" style="--h:${secById(h.section_id).hue}">
          <div class="hab-name"><div class="n">${esc(h.name)}</div><div class="s">${esc(secById(h.section_id).name)} · ${esc(h.target)}</div></div>
          ${whoBadge(h.assignee_id)}
          <div class="hgrid">${days.map((d) =>
            `<button class="hcell${ticked(h, d) ? " on" : ""}${d === off(0) ? " today" : ""}" data-act="habit" data-id="${h.id}" data-day="${d}" title="${d}"></button>`).join("")}</div>
          <div class="streak">${streak(h)}-day streak</div>
        </div>`).join("") : `<div class="empty" style="margin:14px">No habits yet — add the first one below.</div>`}
      </div></div>
    <div class="qa" style="margin-top:12px">
      <input type="text" id="hb-name" placeholder="New habit, e.g. “Read 20 pages”">
      <select id="hb-sec">${sectionOptions()}</select>
      <select id="hb-who">${assigneeOptions(state.user.id)}</select>
      <button class="btn btn-primary btn-sm" data-act="add-habit">Add habit</button>
    </div>`;
}

function viewSection(id) {
  const s = secById(id);
  const tasks = state.tasks.filter((t) => t.section_id === id && !t.done && whoOk(t));
  const doneN = state.tasks.filter((t) => t.section_id === id && t.done).length;
  const notes = state.notes.filter((n) => n.section_id === id);
  const habs = state.habits.filter((h) => h.section_id === id);
  let body = "";
  if (state.tab === "tasks") {
    body = quickAddHTML(id) + groupsHTML(tasks);
  } else if (state.tab === "notes") {
    body = `<div class="qa" style="margin-bottom:12px">
        <input type="text" id="nt-title" placeholder="Note title">
        <input type="text" id="nt-body" placeholder="Note text" style="flex:2 1 260px;border:none;background:none">
        <button class="btn btn-primary btn-sm" data-act="add-note" data-sec="${id}">Add note</button></div>` +
      (notes.length ? `<div class="notes">${notes.map((n) => `
        <article class="note" style="--h:${s.hue}"><h4>${esc(n.title)}</h4><p>${esc(n.body)}</p>
          <div class="note-foot">${whoBadge(n.created_by)}<span>${human(String(n.created_at).slice(0, 10))}</span>
          <div class="spacer"></div><button class="del" style="opacity:1" data-act="del-note" data-id="${n.id}" aria-label="Delete note">×</button></div>
        </article>`).join("")}</div>` : `<div class="empty">No notes in this section yet.</div>`);
  } else {
    body = `<div class="card"><div class="card-head"><h2>Habits in this section</h2></div><div>
      ${habs.length ? habs.map((h) => `
        <div class="hab" style="--h:${s.hue}"><div class="hab-name"><div class="n">${esc(h.name)}</div><div class="s">${esc(h.target)}</div></div>
        <div class="hgrid">${habitDays().map((d) => `<button class="hcell${ticked(h, d) ? " on" : ""}${d === off(0) ? " today" : ""}" data-act="habit" data-id="${h.id}" data-day="${d}"></button>`).join("")}</div></div>`).join("")
        : `<div class="empty" style="margin:14px">No habits assigned to this section.</div>`}
      </div></div>
      <div class="card" style="margin-top:12px"><div class="card-head"><h2>History</h2></div>
      <div class="card-body"><p style="margin:0;color:var(--ink-2)">Tasks closed in this section: <strong class="tnum">${doneN}</strong>.
      Repeating tasks are never closed — ticking one moves it to its next date.</p></div></div>`;
  }
  return `<div class="sec-head" style="--h:${s.hue}"><span class="chip chip-lg">${esc(s.code)}</span>
      <div><h1>${esc(s.name)}</h1><p>${esc(s.description)}</p></div></div>
    <div class="row" style="justify-content:space-between"><div class="tabs">
      ${[["tasks", `Tasks (${tasks.length})`], ["notes", `Notes (${notes.length})`], ["more", "Habits & history"]]
        .map(([k, label]) => `<button class="tab${state.tab === k ? " on" : ""}" data-act="tab" data-tab="${k}">${label}</button>`).join("")}
      </div>${filtersHTML()}</div>${body}`;
}

/* ------------------------------------------------------------- app shell */

const MAIN = [
  { k: "overview", n: "Overview", code: "OV", h: 163 },
  { k: "upcoming", n: "Upcoming", code: "UP", h: 38 },
  { k: "calendar", n: "Calendar", code: "CA", h: 210 },
  { k: "habits", n: "Habits", code: "HA", h: 295 }
];

function renderApp() {
  if (!state.board) return;
  const counts = { overview: "", upcoming: openTasks().length, calendar: "", habits: state.habits.length };
  let title = "Overview", content = "";
  if (state.view.type === "overview") content = viewOverview();
  else if (state.view.type === "upcoming") { title = "Upcoming"; content = viewUpcoming(); }
  else if (state.view.type === "calendar") { title = "Calendar"; content = viewCalendar(); }
  else if (state.view.type === "habits") { title = "Habits"; content = viewHabits(); }
  else { title = secById(state.view.sec).name; content = viewSection(state.view.sec); }

  root.className = "shell";
  root.innerHTML = `
    <aside class="sidebar">
      <div class="side-head">
        <div class="brand-mark">TL</div>
        <div><div class="side-panel-name">${esc(state.board.name)}</div>
        <div class="side-panel-sub">${esc(state.board.invite_code)}</div></div>
      </div>
      <div class="nav-group">${MAIN.map((m) => `
        <button class="nav-item${state.view.type === m.k ? " active" : ""}" style="--h:${m.h}" data-act="go" data-view="${m.k}">
          <span class="chip">${m.code}</span>${m.n}<span class="nav-count">${counts[m.k]}</span></button>`).join("")}
      </div>
      <div class="nav-group">
        <div class="nav-title">Life sections</div>
        ${state.sections.map((s) => {
          const n = state.tasks.filter((t) => t.section_id === s.id && !t.done).length;
          return `<button class="nav-item${state.view.type === "section" && state.view.sec === s.id ? " active" : ""}" style="--h:${s.hue}" data-act="go" data-view="section" data-sec="${s.id}">
            <span class="chip">${esc(s.code)}</span>${esc(s.name)}<span class="nav-count">${n || ""}</span></button>`;
        }).join("")}
        <button class="nav-item" style="--h:163" data-act="new-section"><span class="chip">+</span>New section</button>
      </div>
      <div class="nav-group" style="margin-top:auto">
        <div class="sync${state.live ? "" : " off"}" style="padding:6px 10px"><span class="led"></span><span>${state.live ? " live" : " offline"}</span></div>
        <button class="nav-item" data-act="share"><span class="chip" style="--h:163">SH</span>Sharing</button>
        <button class="nav-item" data-act="switch-board"><span class="chip" style="--h:262">BD</span>Switch board</button>
        <button class="nav-item" data-act="sign-out"><span class="chip" style="--h:20">SO</span>Sign out</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <h1>${esc(title)}</h1>
        <div class="spacer"></div>
        <div class="members" title="${esc(state.members.map((m) => m.display_name).join(" · "))}">
          ${state.members.map((m) => `<div class="avatar" style="background:hsl(${m.hue} 42% 35%);color:#fff">${esc(initials(m.display_name))}</div>`).join("")}
        </div>
        <button class="btn btn-ghost btn-sm" data-act="theme">Theme</button>
        <button class="btn btn-primary btn-sm" data-act="new-task">+ New task</button>
      </header>
      <div class="content">${content}</div>
    </div>`;
}

/* ------------------------------------------------------------- modals */

const closeModal = () => { $("modal-root").innerHTML = ""; };

function newTaskModal() {
  $("modal-root").appendChild(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>New task</h2><div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body">
      <div class="field"><label for="m-title">What needs doing</label><input id="m-title" type="text" placeholder="e.g. Book the car inspection"></div>
      <div class="grid2">
        <div class="field"><label for="m-sec">Section</label><select id="m-sec">${sectionOptions(state.view.sec)}</select></div>
        <div class="field"><label for="m-date">Date</label><input id="m-date" type="date" value="${off(0)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="m-rec">Repeat</label><select id="m-rec"><option value="">one-off</option>${Object.keys(REC).map((k) => `<option value="${k}">${REC[k]}</option>`).join("")}</select></div>
        <div class="field"><label for="m-who">Who</label><select id="m-who">${assigneeOptions(state.user.id)}</select></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-family:inherit;font-size:14px;color:var(--ink)">
        <input type="checkbox" id="m-pri" style="width:auto"> Mark as important</label>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-act="close">Cancel</button>
    <button class="btn btn-primary" data-act="save-task">Add task</button></div>
  </div></div>`));
  $("m-title").focus();
}

function shareModal() {
  const owner = me()?.role === "owner";
  $("modal-root").appendChild(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>Share this board</h2><div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body">
      <div><label>Invite code</label><div class="code">${esc(state.board.invite_code)}</div>
      <p class="hint" style="margin:8px 0 0">The other person creates their own account, picks “Join with a code” and enters this. From then on you both edit the same board and see each other's changes live.</p></div>
      <div><label>People on this board</label>
        ${state.members.map((m) => `<div class="member">
          <span class="avatar" style="background:hsl(${m.hue} 42% 35%);color:#fff">${esc(initials(m.display_name))}</span>
          <div><div class="nm">${esc(m.display_name)}${m.user_id === state.user.id ? " (you)" : ""}</div>
          <div class="rl">${esc(m.role)}${m.email ? ` · ${esc(m.email)}` : ""}</div></div></div>`).join("")}
      </div>
    </div>
    <div class="modal-foot">
      ${owner ? `<button class="btn btn-ghost" data-act="rotate-code">New code</button>` : ""}
      <button class="btn btn-ghost" data-act="close">Close</button>
      <button class="btn btn-primary" data-act="copy-code">Copy code</button></div>
  </div></div>`));
}

function newSectionModal() {
  $("modal-root").appendChild(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>New section</h2><div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body"><div class="field"><label for="s-name">Section name</label>
      <input id="s-name" type="text" placeholder="e.g. Garden, Wedding, Side project"></div></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-act="close">Cancel</button>
    <button class="btn btn-primary" data-act="save-section">Add section</button></div>
  </div></div>`));
  $("s-name").focus();
}

/* ------------------------------------------------------------- events */

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act;

  switch (a) {
    case "auth-tab": state.authTab = b.dataset.tab; return renderAuth();
    case "sign-in": return signIn();
    case "sign-up": return signUp();
    case "sign-out": {
      if (channel) { sb.removeChannel(channel); channel = null; }
      localStorage.removeItem("thelife-board");
      state.board = null;
      await sb.auth.signOut();
      return;
    }
    case "open-board": return openBoard(b.dataset.id);
    case "create-board": return createBoard();
    case "join-board": return joinBoard();
    case "switch-board": {
      if (channel) { sb.removeChannel(channel); channel = null; }
      localStorage.removeItem("thelife-board");
      state.board = null;
      return renderBoardPicker();
    }
    case "go":
      state.view = b.dataset.view === "section" ? { type: "section", sec: b.dataset.sec } : { type: b.dataset.view };
      if (b.dataset.view === "section") state.tab = "tasks";
      window.scrollTo({ top: 0 });
      return renderApp();
    case "who": state.who = b.dataset.who; return renderApp();
    case "tab": state.tab = b.dataset.tab; return renderApp();
    case "cal": {
      const d = +b.dataset.d;
      state.calMonth = d === 0
        ? new Date(today.getFullYear(), today.getMonth(), 1)
        : new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + d, 1);
      return renderApp();
    }
    case "toggle": return toggleTask(b.dataset.id);
    case "del-task": return deleteTask(b.dataset.id);
    case "del-note": return deleteNote(b.dataset.id);
    case "habit": return toggleHabitDay(b.dataset.id, b.dataset.day);
    case "qa": {
      const who = $("qa-who").value;
      return addTask({
        title: $("qa-title").value, section_id: $("qa-sec").value, due_date: $("qa-date").value,
        recurrence: $("qa-rec").value, assignee_id: who === "shared" ? null : who, important: false
      });
    }
    case "add-note": return addNote(b.dataset.sec);
    case "add-habit": return addHabit();
    case "new-task": return newTaskModal();
    case "new-section": return newSectionModal();
    case "save-section": {
      const name = $("s-name").value.trim();
      if (!name) return toast("Give the section a name.");
      closeModal();
      return addSection(name);
    }
    case "save-task": {
      const who = $("m-who").value;
      const draft = {
        title: $("m-title").value,
        section_id: $("m-sec").value,
        due_date: $("m-date").value,
        recurrence: $("m-rec").value,
        assignee_id: who === "shared" ? null : who,
        important: $("m-pri").checked
      };
      if (!draft.title.trim()) return toast("Type what needs doing first.");
      closeModal();
      return addTask(draft);
    }
    case "share": return shareModal();
    case "copy-code":
      try { await navigator.clipboard.writeText(state.board.invite_code); toast("Invite code copied."); }
      catch { toast(`Invite code: ${state.board.invite_code}`); }
      return;
    case "rotate-code": {
      const { data, error } = await sb.rpc("rotate_invite_code", { p_board: state.board.id });
      if (error) return toast(error.message);
      state.board.invite_code = data;
      closeModal(); renderApp(); shareModal();
      return toast("New invite code generated.");
    }
    case "close": return closeModal();
    case "theme": {
      const cur = document.documentElement.getAttribute("data-theme");
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const next = cur ? (cur === "dark" ? "light" : "dark") : (dark ? "light" : "dark");
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("thelife-theme", next); } catch {}
      return;
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key !== "Enter") return;
  const id = e.target.id;
  const click = (sel) => document.querySelector(sel)?.click();
  if (id === "qa-title") click('[data-act="qa"]');
  else if (id === "m-title") click('[data-act="save-task"]');
  else if (id === "s-name") click('[data-act="save-section"]');
  else if (id === "nt-title" || id === "nt-body") click('[data-act="add-note"]');
  else if (id === "hb-name") click('[data-act="add-habit"]');
  else if (id === "new-board") click('[data-act="create-board"]');
  else if (id === "join-code") click('[data-act="join-board"]');
  else if (id === "a-email" || id === "a-pass" || id === "a-name") click(`[data-act="${state.authTab === "up" ? "sign-up" : "sign-in"}"]`);
});

document.addEventListener("mousedown", (e) => {
  if (e.target.classList?.contains("overlay")) closeModal();
});

/* ------------------------------------------------------------- boot */

try {
  const t = localStorage.getItem("thelife-theme");
  if (t) document.documentElement.setAttribute("data-theme", t);
} catch {}

sb.auth.onAuthStateChange(async (event, session) => {
  const user = session?.user || null;
  const changed = user?.id !== state.user?.id;
  state.user = user;
  if (!user) { state.board = null; return renderAuth(); }
  if (!changed && state.board) return;
  const last = localStorage.getItem("thelife-board");
  if (last) {
    const boards = await loadBoards();
    if (boards.some((b) => b.id === last)) return openBoard(last);
  }
  renderBoardPicker();
});

(async () => {
  const { data } = await sb.auth.getSession();
  if (!data.session) renderAuth();
})();
