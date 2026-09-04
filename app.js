/* The Life — shared life & household board.
   Front end only: accounts, storage and realtime come from Supabase. */

const { createClient } = window.supabase;   // vendor/supabase.js (supabase-js v2)

const CFG = window.THE_LIFE_CONFIG || {};
const I18N = window.THE_LIFE_I18N;
const DEFAULTS = window.THE_LIFE_DEFAULTS;
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

/* ------------------------------------------------------------- gestures

   A board is a list you tap, not a map you zoom. Pinching and double-tapping
   only ever happen here by accident — usually mid-scroll on a phone — and
   leave the layout stranded at 2x. Scrolling and panning stay untouched, and
   so does the browser's own zoom (⌘+ / Ctrl+), which people who need it use. */

["gesturestart", "gesturechange", "gestureend"].forEach((ev) =>
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1) e.preventDefault();          // a pinch, not a scroll
}, { passive: false });

document.addEventListener("wheel", (e) => {
  if (e.ctrlKey) e.preventDefault();                     // trackpad pinch on a laptop
}, { passive: false });

/* A short buzz where a finger expects one. Android honours it; iOS Safari
   has no Vibration API, so this is simply nothing there. */
function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}

/* ------------------------------------------------------------- language */

function detectLang() {
  try {
    const saved = localStorage.getItem("thelife-lang");
    if (saved && I18N[saved]) return saved;
  } catch {}
  return (navigator.language || "en").toLowerCase().startsWith("pl") ? "pl" : "en";
}

let lang = detectLang();

function t(key, vars) {
  let s = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

function setLang(next) {
  lang = I18N[next] ? next : "en";
  try { localStorage.setItem("thelife-lang", lang); } catch {}
  document.documentElement.setAttribute("lang", lang);
}
document.documentElement.setAttribute("lang", lang);

/* Section names and descriptions are data. Translate only the seeded defaults,
   so a section someone renamed keeps exactly the name they gave it. */
function sectionName(s) {
  const def = DEFAULTS.sections[s?.key];
  if (def && s.name === def.en) return def[lang] || def.en;
  return s?.name || "—";
}
function sectionCode(s) {
  const def = DEFAULTS.sections[s?.key];
  if (def && s.name === def.en && def.code) return def.code[lang] || def.code.en;
  return s?.code || "??";
}
function sectionDesc(s) {
  const def = DEFAULTS.descriptions[s?.key];
  if (def && s.description === def.en) return def[lang] || def.en;
  return s?.description || "";
}
function habitTarget(h) {
  const def = DEFAULTS.habitTargets[h?.target];
  return def ? (def[lang] || def.en) : (h?.target || "");
}

/* ------------------------------------------------------------- dates */

const DAY = 86400000;
const today = new Date(); today.setHours(0, 0, 0, 0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDate = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const off = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const diff = (s) => Math.round((parseDate(s) - today) / DAY);

const NAMES = {
  en: {
    monthShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    monthLong: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthOfDay: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    dow: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    dowShort: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  },
  pl: {
    monthShort: ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"],
    monthLong: ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"],
    monthOfDay: ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"],
    dow: ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"],
    dowShort: ["pon", "wt", "śr", "czw", "pt", "sob", "ndz"]
  }
};
const names = () => NAMES[lang] || NAMES.en;

function human(s) {
  const n = diff(s), d = parseDate(s);
  if (n === 0) return t("today");
  if (n === 1) return t("tomorrow");
  if (n === -1) return t("overdue_one");
  if (n < 0) return t("overdue_many", { n: Math.abs(n) });
  if (n < 7) return names().dow[d.getDay()];
  return `${d.getDate()} ${names().monthOfDay[d.getMonth()]}`;
}

const countLabel = (n, one, many) => `${n} ${n === 1 ? t(one) : t(many)}`;

const RECUR = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"];
const recLabel = (r) => t("rec_" + r);

/* Next occurrence.
   fromCompletion = false → keep the fixed rhythm and catch up past dates.
   fromCompletion = true  → one period counted from today. */
function nextDate(task) {
  const fromCompletion = !!task.recur_from_completion;
  const rec = task.recurrence;
  const d = fromCompletion ? new Date(today) : parseDate(task.due_date);
  const step = () => {
    if (rec === "daily") d.setDate(d.getDate() + 1);
    else if (rec === "weekly") d.setDate(d.getDate() + 7);
    else if (rec === "biweekly") d.setDate(d.getDate() + 14);
    else if (rec === "monthly") d.setMonth(d.getMonth() + 1);
    else if (rec === "quarterly") d.setMonth(d.getMonth() + 3);
    else if (rec === "yearly") d.setFullYear(d.getFullYear() + 1);
  };
  step();
  if (!fromCompletion) {
    let guard = 0;
    while (d < today && rec !== "yearly" && guard++ < 400) step();
  }
  return iso(d);
}

/* ------------------------------------------------------------- theme */

function applyTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
  else document.documentElement.removeAttribute("data-theme");
}
let theme = "system";
try { theme = localStorage.getItem("thelife-theme") || "system"; } catch {}
applyTheme(theme);

/* ------------------------------------------------------------- setup gate */

if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
  root.innerHTML = `<div class="setup">
    <div class="brand" style="margin-bottom:14px"><div class="brand-mark">TL</div><div class="brand-name">The Life</div></div>
    <h1>${esc(t("setup_title"))}</h1>
    <p style="color:var(--ink-2)">${esc(t("setup_lede"))}</p>
    <ol><li>${t("setup_1")}</li><li>${t("setup_2")}</li><li>${t("setup_3")}</li><li>${t("setup_4")}</li></ol>
    <p class="hint">${esc(t("setup_more"))}</p>
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
  subtasks: [],
  expanded: new Set(),    // task ids with their checklist open
  days: new Set(),        // "habitId|YYYY-MM-DD"
  view: { type: "overview" },
  who: "all",             // "all" | user_id | "shared"
  tab: "tasks",
  calMonth: new Date(today.getFullYear(), today.getMonth(), 1),
  live: false,
  authTab: "in",
  recovery: false
};

/* one-shot animation markers, cleared shortly after they play */
let fx = { pop: null };
let fxTimer = null;

const secById = (id) => state.sections.find((s) => s.id === id) || { name: "—", hue: 163, code: "??", description: "" };
const memberById = (id) => state.members.find((m) => m.user_id === id);
const me = () => memberById(state.user?.id);
const taskById = (id) => state.tasks.find((x) => x.id === id);

function initials(name) {
  const parts = String(name || "?").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}
const memberHue = (id) => (id ? memberById(id)?.hue ?? 163 : null);
const memberName = (id) => (id ? memberById(id)?.display_name || "" : t("by_shared"));

/* A row belongs to whoever it is assigned to; shared rows keep the section colour. */
const rowHue = (row, section) => (row.assignee_id ? memberHue(row.assignee_id) : section?.hue ?? 163);

function avatarHTML(member, cls = "avatar") {
  const hue = member?.hue ?? 163;
  const name = member?.display_name || "";
  if (member?.avatar_url) {
    return `<span class="${cls} has-photo" title="${esc(name)}"><img src="${esc(member.avatar_url)}" alt=""></span>`;
  }
  return `<span class="${cls}" style="background:hsl(${hue} 42% 35%);color:#fff" title="${esc(name)}">${esc(initials(name))}</span>`;
}

const profileAvatar = () => me()?.avatar_url || null;

const displayName = () =>
  state.user?.user_metadata?.display_name || (state.user?.email || "").split("@")[0] || "Me";

/* ------------------------------------------------------------- auth screens */

function renderAuth(msg, err) {
  root.className = "auth";
  root.innerHTML = `
    <div class="auth-art">
      <div class="brand"><div class="brand-mark">TL</div><div class="brand-name">The Life</div></div>
      <div class="auth-lede">
        <h1>${esc(t("hero_title"))}</h1>
        <p>${esc(t("hero_lede"))}</p>
      </div>
      <div class="art-grid">
        <div class="art-cell" style="--h:210"><div class="k">${esc(t("hero_car"))}</div><div class="v">${esc(t("hero_car_v"))}</div><div class="s">${esc(t("hero_car_s"))}</div></div>
        <div class="art-cell" style="--h:38"><div class="k">${esc(t("hero_fin"))}</div><div class="v">${esc(t("hero_fin_v"))}</div><div class="s">${esc(t("hero_fin_s"))}</div></div>
        <div class="art-cell" style="--h:230"><div class="k">${esc(t("hero_learn"))}</div><div class="v">${esc(t("hero_learn_v"))}</div><div class="s">${esc(t("hero_learn_s"))}</div></div>
        <div class="art-cell" style="--h:196"><div class="k">${esc(t("hero_travel"))}</div><div class="v">${esc(t("hero_travel_v"))}</div><div class="s">${esc(t("hero_travel_s"))}</div></div>
      </div>
    </div>
    <div class="auth-form">
      <div class="tabs tabs-auth">
        <button class="tab ${state.authTab === "in" ? "on" : ""}" data-act="auth-tab" data-tab="in">${esc(t("sign_in"))}</button>
        <button class="tab ${state.authTab === "up" ? "on" : ""}" data-act="auth-tab" data-tab="up">${esc(t("create_account"))}</button>
        ${state.authTab === "reset" ? `<button class="tab on" data-act="auth-tab" data-tab="reset">${esc(t("reset_password"))}</button>` : ""}
      </div>
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      ${msg ? `<div class="ok-msg">${esc(msg)}</div>` : ""}
      ${state.authTab === "reset" ? `
        <p style="color:var(--ink-2);margin:0">${esc(t("reset_intro"))}</p>
        <div class="field"><label for="a-email">${esc(t("email"))}</label><input id="a-email" type="email" autocomplete="email"></div>
        <button class="btn btn-primary" data-act="send-reset">${esc(t("send_reset_link"))}</button>
        <button class="btn btn-ghost" data-act="auth-tab" data-tab="in">${esc(t("back_to_sign_in"))}</button>
      ` : `
        ${state.authTab === "up" ? `<div class="field"><label for="a-name">${esc(t("your_name"))}</label><input id="a-name" type="text" placeholder="${esc(t("name_placeholder"))}" autocomplete="name"></div>` : ""}
        <div class="field"><label for="a-email">${esc(t("email"))}</label><input id="a-email" type="email" autocomplete="email"></div>
        <div class="field"><label for="a-pass">${esc(t("password"))}</label><input id="a-pass" type="password" autocomplete="${state.authTab === "up" ? "new-password" : "current-password"}"></div>
        <button class="btn btn-primary" data-act="${state.authTab === "up" ? "sign-up" : "sign-in"}">${esc(state.authTab === "up" ? t("create_account") : t("sign_in"))}</button>
        ${state.authTab === "in" ? `<button class="btn btn-ghost" data-act="auth-tab" data-tab="reset">${esc(t("forgot_password"))}</button>` : ""}
        <p class="hint">${esc(state.authTab === "up" ? t("hint_sign_up") : t("hint_sign_in"))}</p>
      `}
      <div class="row" style="gap:6px;margin-top:4px">
        ${["en", "pl"].map((l) => `<button class="fchip${lang === l ? " on" : ""}" data-act="lang" data-lang="${l}">${l === "en" ? "English" : "Polski"}</button>`).join("")}
      </div>
    </div>`;
  ($("a-name") || $("a-email"))?.focus();
}

/* Screen shown after following the link from the reset email. */
function renderNewPassword(msg, err) {
  root.className = "auth";
  root.innerHTML = `
    <div class="auth-art">
      <div class="brand"><div class="brand-mark">TL</div><div class="brand-name">The Life</div></div>
      <div class="auth-lede">
        <h1>${esc(t("set_new_password"))}</h1>
        <p>${esc(t("set_new_password_lede"))}</p>
      </div>
      <div class="art-grid" style="grid-template-columns:1fr">
        <div class="art-cell" style="--h:163"><div class="k">${esc(t("reminder"))}</div><div class="v">${esc(t("at_least_6"))}</div><div class="s">${esc(t("longer_better"))}</div></div>
      </div>
    </div>
    <div class="auth-form">
      <h1 style="font-size:26px">${esc(t("new_password"))}</h1>
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      ${msg ? `<div class="ok-msg">${esc(msg)}</div>` : ""}
      <div class="field"><label for="np-1">${esc(t("new_password"))}</label><input id="np-1" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="np-2">${esc(t("repeat_it"))}</label><input id="np-2" type="password" autocomplete="new-password"></div>
      <button class="btn btn-primary" data-act="save-password">${esc(t("save_password"))}</button>
      <button class="btn btn-ghost" data-act="cancel-recovery">${esc(t("cancel"))}</button>
    </div>`;
  $("np-1")?.focus();
}

async function signIn() {
  const email = $("a-email").value.trim(), password = $("a-pass").value;
  if (!email || !password) return renderAuth(null, t("err_need_credentials"));
  root.classList.add("busy");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  root.classList.remove("busy");
  if (error) return renderAuth(null, error.message);
}

async function signUp() {
  const email = $("a-email").value.trim(), password = $("a-pass").value;
  const display_name = ($("a-name")?.value || "").trim();
  if (!email || !password) return renderAuth(null, t("err_need_credentials"));
  if (password.length < 6) return renderAuth(null, t("err_password_short"));
  root.classList.add("busy");
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name } } });
  root.classList.remove("busy");
  if (error) return renderAuth(null, error.message);
  if (!data.session) {
    state.authTab = "in";
    return renderAuth(t("account_created"));
  }
}

async function sendReset() {
  const email = $("a-email").value.trim();
  if (!email) return renderAuth(null, t("err_need_email"));
  root.classList.add("busy");
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  root.classList.remove("busy");
  state.authTab = "in";
  if (error) return renderAuth(null, error.message);
  renderAuth(t("reset_sent"));
}

async function savePassword() {
  const p1 = $("np-1").value, p2 = $("np-2").value;
  if (p1.length < 6) return renderNewPassword(null, t("err_password_short"));
  if (p1 !== p2) return renderNewPassword(null, t("err_passwords_differ"));
  root.classList.add("busy");
  const { error } = await sb.auth.updateUser({ password: p1 });
  root.classList.remove("busy");
  if (error) return renderNewPassword(null, error.message);
  state.recovery = false;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  toast(t("password_changed"));
  renderBoardPicker();
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
  root.innerHTML = `
    <div class="auth-art">
      <div class="brand"><div class="brand-mark">TL</div><div class="brand-name">The Life</div></div>
      <div class="auth-lede">
        <h1>${esc(t("boards_title"))}</h1>
        <p>${esc(t("boards_lede"))}</p>
      </div>
      <div class="art-grid" style="grid-template-columns:1fr">
        <div class="art-cell" style="--h:163"><div class="k">${esc(t("role_owner"))}</div><div class="v">${esc(t("full_access"))}</div><div class="s">${esc(t("owner_desc"))}</div></div>
        <div class="art-cell" style="--h:288"><div class="k">${esc(t("role_member"))}</div><div class="v">${esc(t("full_access"))}</div><div class="s">${esc(t("member_desc"))}</div></div>
      </div>
    </div>
    <div class="auth-form">
      <div class="row" style="justify-content:space-between">
        <div><h1 style="font-size:26px">${esc(t("your_boards"))}</h1>
        <p class="hint" style="margin:4px 0 0">${esc(t("signed_in_as"))} <strong>${esc(state.user?.email || "")}</strong></p></div>
        <div class="row" style="gap:6px">
          <button class="btn btn-ghost btn-sm" data-act="settings">${esc(t("settings"))}</button>
          <button class="btn btn-ghost btn-sm" data-act="sign-out">${esc(t("sign_out"))}</button>
        </div>
      </div>
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      ${state.boards.length
        ? `<div class="panel-pick">${state.boards.map((b) => `
            <button class="board-row" data-act="open-board" data-id="${b.id}">
              <span class="chip chip-lg" style="--h:163">${esc(initials(b.name))}</span>
              <span><span class="nm">${esc(b.name)}</span><br><span class="sub mono">${esc(b.invite_code)} · ${esc(b.role === "owner" ? t("role_owner") : t("role_member"))}</span></span>
            </button>`).join("")}</div>`
        : `<div class="empty">${esc(t("no_boards"))}</div>`}
      <div class="divider">${esc(t("create_or_join"))}</div>
      <div class="panel-pick">
        <div class="pick-card">
          <h3>${esc(t("create_board"))}</h3>
          <p>${esc(t("create_board_desc"))}</p>
          <div class="row" style="margin-top:6px">
            <input type="text" id="new-board" placeholder="${esc(t("our_board"))}" style="flex:1">
            <button class="btn btn-primary btn-sm" data-act="create-board">${esc(t("create"))}</button>
          </div>
        </div>
        <div class="pick-card">
          <h3>${esc(t("join_with_code"))}</h3>
          <p>${esc(t("join_with_code_desc"))}</p>
          <div class="row" style="margin-top:6px">
            <input type="text" id="join-code" class="mono" placeholder="HOME-4K2P" style="flex:1">
            <button class="btn btn-ghost btn-sm" data-act="join-board">${esc(t("join"))}</button>
          </div>
        </div>
      </div>
    </div>`;
}

async function createBoard() {
  const name = $("new-board").value.trim() || t("our_board");
  root.classList.add("busy");
  const { data, error } = await sb.rpc("create_board", { p_name: name, p_display_name: displayName() });
  root.classList.remove("busy");
  if (error) return renderBoardPicker(error.message);
  await openBoard(data);
}

async function joinBoard() {
  const code = $("join-code").value.trim();
  if (!code) return renderBoardPicker(t("err_need_code"));
  root.classList.add("busy");
  const { data, error } = await sb.rpc("join_board", { p_code: code, p_display_name: displayName() });
  root.classList.remove("busy");
  if (error) return renderBoardPicker(error.message.includes("not found") ? t("err_code_unknown") : error.message);
  toast(t("joined_board"));
  await openBoard(data);
}

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
  const [members, profiles, sections, tasks, notes, habits, days, subtasks] = await Promise.all([
    sb.from("board_members").select("*").eq("board_id", id),
    sb.from("profiles").select("id, email, display_name, avatar_url"),
    sb.from("sections").select("*").eq("board_id", id).order("position"),
    sb.from("tasks").select("*").eq("board_id", id),
    sb.from("notes").select("*").eq("board_id", id).order("created_at", { ascending: false }),
    sb.from("habits").select("*").eq("board_id", id).order("created_at"),
    sb.from("habit_days").select("habit_id, day").eq("board_id", id).gte("day", off(-70)),
    sb.from("subtasks").select("*").eq("board_id", id).order("position")
  ]);
  const profs = profiles.data || [];
  state.members = (members.data || []).map((m) => {
    const p = profs.find((x) => x.id === m.user_id);
    return { ...m, display_name: m.display_name || p?.display_name || p?.email || "Member",
             email: p?.email || "", avatar_url: p?.avatar_url || null };
  });
  state.sections = sections.data || [];
  state.tasks = tasks.data || [];
  state.notes = notes.data || [];
  state.habits = habits.data || [];
  state.days = new Set((days.data || []).map((d) => `${d.habit_id}|${d.day}`));
  state.subtasks = subtasks.data || [];
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => { await refreshAll(); renderApp(); }, 250);
}

function subscribe(boardId) {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel(`board:${boardId}`);
  ["sections", "tasks", "notes", "habits", "habit_days", "subtasks", "board_members"].forEach((table) => {
    channel.on("postgres_changes",
      { event: "*", schema: "public", table, filter: `board_id=eq.${boardId}` }, scheduleRefresh);
  });
  channel.on("postgres_changes",
    { event: "*", schema: "public", table: "boards", filter: `id=eq.${boardId}` }, scheduleRefresh);
  channel.subscribe((status) => {
    const live = status === "SUBSCRIBED";
    if (live !== state.live) { state.live = live; renderApp(); }
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

async function addTask(draft) {
  if (!draft.title.trim()) return toast(t("err_need_title"));
  const row = {
    board_id: boardId(), section_id: draft.section_id, title: draft.title.trim(),
    due_date: draft.due_date || off(0), recurrence: draft.recurrence || null,
    recur_from_completion: !!draft.recur_from_completion,
    description: draft.description || "",
    assignee_id: draft.assignee_id || null, important: !!draft.important, created_by: state.user.id
  };
  state.tasks = state.tasks.concat([{ ...row, id: "tmp" + Math.random(), done: false }]);
  renderApp();
  const { data, error } = await sb.from("tasks").insert(row).select("id");
  if (error) { toast(error.message); await refreshAll(); return renderApp(); }
  const newId = Array.isArray(data) ? data[0]?.id : data?.id;
  const steps = draft.steps || [];
  if (newId && steps.length) {
    await sb.from("subtasks").insert(steps.map((title, i) => ({
      task_id: newId, board_id: boardId(), title, position: i + 1
    })));
  }
  toast(t("added_to", { section: sectionName(secById(draft.section_id)) }));
  await refreshAll(); renderApp();
}

async function updateTask(id, patch, okMsg) {
  const task = taskById(id);
  if (task) Object.assign(task, patch);
  renderApp();
  await run(sb.from("tasks").update(patch).eq("id", id), okMsg);
  await refreshAll(); renderApp();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function playRowExit(id, cls) {
  const row = document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
  if (!row || reducedMotion()) return;
  row.style.setProperty("--row-h", `${row.offsetHeight}px`);
  row.classList.add(cls);
  await wait(cls === "leaving" ? 620 : 500);
}

async function toggleTask(id) {
  const task = taskById(id);
  if (!task) return;
  if (task.recurrence && !task.done) {
    const nd = nextDate(task);
    buzz([10, 40, 14]);
    await playRowExit(id, "shifting");
    task.due_date = nd; renderApp();
    await run(sb.from("tasks").update({ due_date: nd }).eq("id", id), t("next_time", { when: human(nd) }));
  } else {
    const done = !task.done;
    if (done) { buzz(18); await playRowExit(id, "leaving"); }
    task.done = done; renderApp();
    await run(sb.from("tasks").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", id),
      done ? t("task_closed") : null);
  }
}

async function deleteTask(id) {
  state.tasks = state.tasks.filter((x) => x.id !== id); renderApp();
  await run(sb.from("tasks").delete().eq("id", id), t("task_deleted"));
}

const stepsOf = (taskId) => state.subtasks.filter((x) => x.task_id === taskId);

async function addSubtask(task_id, title) {
  const clean = (title || "").trim();
  if (!clean) return;
  const position = (stepsOf(task_id).at(-1)?.position ?? 0) + 1;
  const row = { task_id, board_id: boardId(), title: clean, position };
  state.subtasks = state.subtasks.concat([{ ...row, id: "tmp" + Math.random(), done: false }]);
  renderApp();
  await run(sb.from("subtasks").insert(row));
  refreshStepEditor();
  await refreshAll(); renderApp();
}

async function toggleSubtask(id) {
  const step = state.subtasks.find((x) => x.id === id);
  if (!step) return;
  const done = !step.done;
  if (done) buzz(8);
  step.done = done; renderApp();
  await run(sb.from("subtasks").update({ done }).eq("id", id));
  refreshStepEditor();
}

async function deleteSubtask(id) {
  state.subtasks = state.subtasks.filter((x) => x.id !== id);
  renderApp();
  await run(sb.from("subtasks").delete().eq("id", id));
  refreshStepEditor();
}

async function addNote(section_id) {
  const title = $("nt-title").value.trim(), body = $("nt-body").value.trim();
  if (!title) return toast(t("err_note_title"));
  await run(sb.from("notes").insert({ board_id: boardId(), section_id, title, body, created_by: state.user.id }), t("note_saved"));
  await refreshAll(); renderApp();
}

async function deleteNote(id) {
  state.notes = state.notes.filter((n) => n.id !== id); renderApp();
  await run(sb.from("notes").delete().eq("id", id), t("note_deleted"));
}

async function addHabit(d) {
  if (!d || !d.name.trim()) return toast(t("err_habit_name"));
  await run(sb.from("habits").insert({
    board_id: boardId(), section_id: d.section_id, name: d.name.trim(),
    assignee_id: d.who === "shared" ? null : d.who, target: d.target || t("freq_daily")
  }), t("habit_added"));
  await refreshAll(); renderApp();
}

async function toggleHabitDay(habit_id, day) {
  const key = `${habit_id}|${day}`;
  if (state.days.has(key)) {
    state.days.delete(key); fx = { pop: null }; renderApp();
    await run(sb.from("habit_days").delete().eq("habit_id", habit_id).eq("day", day));
  } else {
    state.days.add(key);
    buzz(12);
    fx = { pop: key };
    clearTimeout(fxTimer);
    fxTimer = setTimeout(() => { fx = { pop: null }; }, 600);
    renderApp();
    await run(sb.from("habit_days").insert({ habit_id, day, board_id: boardId(), user_id: state.user.id }));
  }
}

async function addSection(name) {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "section" + Date.now();
  const hue = Math.floor(Math.random() * 360);
  const code = name.replace(/[^\p{L}]/gu, "").slice(0, 2).toUpperCase() || "NS";
  await run(sb.from("sections").insert({
    board_id: boardId(), key, name, code, hue, description: "",
    position: (state.sections.at(-1)?.position || 0) + 1
  }), t("section_added", { name }));
  await refreshAll(); renderApp();
}

async function deleteSection(id) {
  const sec = secById(id);
  const name = sectionName(sec);
  closeModal();
  state.sections = state.sections.filter((x) => x.id !== id);
  state.tasks = state.tasks.filter((x) => x.section_id !== id);
  state.notes = state.notes.filter((x) => x.section_id !== id);
  state.habits = state.habits.filter((x) => x.section_id !== id);
  if (state.view.type === "section" && state.view.sec === id) state.view = { type: "overview" };
  renderApp();
  for (const table of ["tasks", "notes", "habits"]) {
    const { error } = await sb.from(table).delete().eq("section_id", id);
    if (error) { toast(error.message); await refreshAll(); return renderApp(); }
  }
  await run(sb.from("sections").delete().eq("id", id), t("section_deleted", { name }));
  await refreshAll(); renderApp();
}

async function saveMemberHue(hue) {
  const m = me();
  if (m) m.hue = hue;
  renderApp();
  const { data, error } = await sb.from("board_members").update({ hue })
    .eq("board_id", boardId()).eq("user_id", state.user.id).select("user_id");
  if (error) toast(error.message);
  else if (!data || !data.length) toast("Run supabase/schema.sql again — the board is missing the update rule.");
  await refreshAll();
  closeModal(); settingsModal();
  renderApp();
}

/* Resize to a 128 px square in the browser, then keep it inline on the profile. */
function resizeToDataURL(file, size = 128) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadAvatar(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast(t("err_photo_type"));
  let dataUrl;
  try { dataUrl = await resizeToDataURL(file); } catch { return toast(t("err_photo_type")); }
  const { data, error } = await sb.from("profiles").update({ avatar_url: dataUrl })
    .eq("id", state.user.id).select("id");
  if (error) return toast(error.message);
  if (!data || !data.length) return toast("Run supabase/schema.sql again — the profile could not be written.");
  await refreshAll();
  toast(t("photo_saved"));
  closeModal(); settingsModal();
  if (state.board) renderApp();
}

async function removeAvatar() {
  const { error } = await sb.from("profiles").update({ avatar_url: null }).eq("id", state.user.id);
  if (error) return toast(error.message);
  await refreshAll();
  toast(t("photo_removed"));
  closeModal(); settingsModal();
  if (state.board) renderApp();
}

async function updateHabit(id, patch, okMsg) {
  const h = state.habits.find((x) => x.id === id);
  if (h) Object.assign(h, patch);
  renderApp();
  await run(sb.from("habits").update(patch).eq("id", id), okMsg);
  await refreshAll(); renderApp();
}

async function deleteHabit(id) {
  state.habits = state.habits.filter((x) => x.id !== id);
  renderApp();
  await run(sb.from("habits").delete().eq("id", id), t("habit_deleted"));
}

async function saveMemberName(name) {
  const clean = name.trim();
  if (!clean || !state.board) return;
  const { data, error } = await sb.from("board_members").update({ display_name: clean })
    .eq("board_id", boardId()).eq("user_id", state.user.id).select("user_id");
  if (error) toast(error.message);
  else if (!data || !data.length) toast("Run supabase/schema.sql again — the board is missing the update rule.");
  await refreshAll();
}

/* ------------------------------------------------------------- view helpers */

function whoOk(row) {
  if (state.who === "all") return true;
  if (state.who === "shared") return row.assignee_id === null;
  return row.assignee_id === state.who || row.assignee_id === null;
}
const openTasks = () => state.tasks.filter((x) => !x.done && whoOk(x));

function whoBadge(assignee_id) {
  if (!assignee_id) {
    const [a, b] = state.members;
    return `<span class="who who-shared" title="${esc(t("shared"))}"
      style="background:linear-gradient(105deg,hsl(${a?.hue ?? 163} 45% 34%) 50%,hsl(${b?.hue ?? 288} 40% 42%) 50%)">◑</span>`;
  }
  return avatarHTML(memberById(assignee_id), "who");
}

function taskDetailsHTML(task) {
  if (!state.expanded.has(task.id)) return "";
  const steps = stepsOf(task.id);
  if (!task.description && !steps.length) return "";
  return `<div class="t-details">
    ${task.description ? `<p class="t-desc">${esc(task.description)}</p>` : ""}
    ${steps.length ? `<ul class="steps">${steps.map((x) => `
      <li class="step${x.done ? " done" : ""}">
        <button class="step-tick" data-act="toggle-step" data-id="${x.id}" aria-label="${esc(x.title)}">
          <svg viewBox="0 0 12 12" fill="none" stroke="${x.done ? "var(--on-accent)" : "currentColor"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 6.3 4.4 9.2 10.5 3"/></svg>
        </button><span>${esc(x.title)}</span></li>`).join("")}</ul>` : ""}
  </div>`;
}

function taskHTML(task, i = 0) {
  const s = secById(task.section_id), n = diff(task.due_date);
  const cls = n < 0 ? "od" : n === 0 ? "td" : "";
  const p = task.assignee_id ? memberHue(task.assignee_id) : s.hue;
  const steps = stepsOf(task.id);
  const hasMore = !!task.description || steps.length > 0;
  const open = state.expanded.has(task.id);
  const doneSteps = steps.filter((x) => x.done).length;
  return `<div class="task${task.done ? " done" : ""}${task.assignee_id ? " mine" : ""}${open ? " open" : ""}"
    style="--h:${s.hue};--p:${p};--i:${Math.min(i, 12)}" data-id="${task.id}">
    <div class="t-row">
      <button class="t-main${hasMore ? " has-more" : ""}" ${hasMore
        ? `data-act="toggle-steps" data-id="${task.id}" title="${esc(open ? t("hide_details") : t("show_details"))}"`
        : `data-act="edit-task" data-id="${task.id}" title="${esc(t("edit_task"))}"`}>
        <span class="t-title">${esc(task.title)}</span>
        <span class="t-meta">
          <span class="sec">${esc(sectionName(s))}</span><span>·</span>
          <span class="t-date ${cls}">${human(task.due_date)}</span>
          ${task.recurrence ? `<span class="badge rec">↻ ${esc(recLabel(task.recurrence))}${task.recur_from_completion ? " · " + esc(t("badge_from_done")) : ""}</span>` : ""}
          ${task.important ? `<span class="badge pri">${esc(t("important"))}</span>` : ""}
          ${task.description ? `<span class="badge">≡</span>` : ""}
          ${steps.length ? `<span class="badge steps-badge${doneSteps === steps.length ? " all-done" : ""}">☑ ${esc(t("steps_done", { done: doneSteps, total: steps.length }))}</span>` : ""}
          ${hasMore ? `<span class="chev-mini${open ? " up" : ""}">▾</span>` : ""}
        </span>
      </button>
      <span class="who-wrap corner" title="${esc(memberName(task.assignee_id))}">${whoBadge(task.assignee_id)}</span>
      <button class="tick" data-act="toggle" data-id="${task.id}" aria-label="${esc(t("task_closed"))}">
        <svg viewBox="0 0 12 12" fill="none" stroke="${task.done ? "var(--on-accent)" : "currentColor"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 6.3 4.4 9.2 10.5 3"/></svg>
      </button>
    </div>
    ${taskDetailsHTML(task)}
  </div>`;
}

function groupsHTML(list) {
  const groups = [
    { k: "overdue", t: t("group_overdue"), items: [] }, { k: "today", t: t("group_today"), items: [] },
    { k: "tom", t: t("group_tomorrow"), items: [] }, { k: "week", t: t("group_week"), items: [] },
    { k: "next", t: t("group_next_week"), items: [] }, { k: "later", t: t("group_later"), items: [] }
  ];
  [...list].sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0)).forEach((task) => {
    const n = diff(task.due_date);
    if (n < 0) groups[0].items.push(task);
    else if (n === 0) groups[1].items.push(task);
    else if (n === 1) groups[2].items.push(task);
    else if (n <= 7) groups[3].items.push(task);
    else if (n <= 14) groups[4].items.push(task);
    else groups[5].items.push(task);
  });
  const out = groups.filter((g) => g.items.length).map((g) =>
    `<section class="tgroup ${g.k}"><div class="tgroup-head"><h3>${esc(g.t)}</h3><span class="n">${g.items.length}</span></div>
     <div class="tlist">${g.items.map((x, i) => taskHTML(x, i)).join("")}</div></section>`).join("");
  return out || `<div class="empty">${esc(t("empty_tasks"))}</div>`;
}

function filtersHTML() {
  const opts = [["all", t("everyone")], ...state.members.map((m) => [m.user_id, m.display_name]), ["shared", t("shared")]];
  return `<div class="filters">${opts.map(([v, label]) =>
    `<button class="fchip${state.who === v ? " on" : ""}" data-act="who" data-who="${v}">${esc(label)}</button>`).join("")}</div>`;
}

function assigneeOptions(selected) {
  return [...state.members.map((m) => `<option value="${m.user_id}"${selected === m.user_id ? " selected" : ""}>${esc(m.display_name)}</option>`),
    `<option value="shared"${selected === "shared" || selected === null ? " selected" : ""}>${esc(t("shared"))}</option>`].join("");
}
const sectionOptions = (sel) =>
  state.sections.map((s) => `<option value="${s.id}"${sel === s.id ? " selected" : ""}>${esc(sectionName(s))}</option>`).join("");
const recurrenceOptions = (sel) =>
  `<option value="">${esc(t("one_off"))}</option>` +
  RECUR.map((r) => `<option value="${r}"${sel === r ? " selected" : ""}>${esc(recLabel(r))}</option>`).join("");

const habitDays = (n = 14) => Array.from({ length: n }, (_, i) => off(-(n - 1 - i)));
const ticked = (h, d) => state.days.has(`${h.id}|${d}`);
function streak(h) { let s = 0; for (let k = 0; k < 90; k++) { if (ticked(h, off(-k))) s++; else if (k > 0) break; } return s; }

/* ------------------------------------------------------------- views */

function viewOverview() {
  const act = openTasks();
  const od = act.filter((x) => diff(x.due_date) < 0);
  const td = act.filter((x) => diff(x.due_date) === 0);
  const wk = act.filter((x) => { const n = diff(x.due_date); return n > 0 && n <= 7; });
  const habitsShown = state.habits.filter((h) => whoOk(h));
  const habToday = habitsShown.filter((h) => ticked(h, off(0))).length;
  const next = [...act].sort((a, b) => (a.due_date < b.due_date ? -1 : 1)).slice(0, 6);
  const d = new Date();
  const dateLine = lang === "pl"
    ? `${names().dow[d.getDay()].replace(/^./, (c) => c.toUpperCase())}, ${d.getDate()} ${names().monthOfDay[d.getMonth()]} ${d.getFullYear()}`
    : `${names().dow[d.getDay()]}, ${d.getDate()} ${names().monthLong[d.getMonth()]} ${d.getFullYear()}`;
  return `<div class="row" style="justify-content:space-between;margin-bottom:16px">
      <div><h2 style="font-size:21px">${esc(t("hi_name", { name: (me()?.display_name || displayName()).split(" ")[0] }))}</h2>
      <p class="hint" style="margin:2px 0 0">${esc(dateLine)}</p></div>
      ${filtersHTML()}</div>
    <div class="grid-stats">
      <div class="stat${od.length ? " crit" : ""}"><div class="k">${esc(t("stat_overdue"))}</div><div class="v tnum">${od.length}</div><div class="s">${esc(od.length ? t("stat_overdue_yes") : t("stat_overdue_no"))}</div></div>
      <div class="stat warn"><div class="k">${esc(t("stat_today"))}</div><div class="v tnum">${td.length}</div><div class="s">${esc(t("stat_today_sub", { n: countLabel(td.length, "task_one", "task_many") }))}</div></div>
      <div class="stat"><div class="k">${esc(t("stat_week"))}</div><div class="v tnum">${wk.length}</div><div class="s">${esc(t("stat_week_sub"))}</div></div>
      <div class="stat"><div class="k">${esc(t("stat_habits"))}</div><div class="v tnum">${habToday}/${habitsShown.length}</div><div class="s">${esc(t("stat_habits_sub"))}</div></div>
    </div>
    <div class="ov-grid" style="display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:14px;margin-top:16px">
      <div class="card"><div class="card-head"><h2>${esc(t("coming_up"))}</h2><div class="spacer"></div>
        <button class="btn btn-ghost btn-sm" data-act="go" data-view="upcoming">${esc(t("full_list"))}</button></div>
        <div class="card-body"><div class="tlist">${next.length ? next.map((x, i) => taskHTML(x, i)).join("") : `<div class="empty">${esc(t("nothing_waiting"))}</div>`}</div></div></div>
      <div class="card"><div class="card-head"><h2>${esc(t("habits_today"))}</h2></div><div>
        ${habitsShown.length ? habitsShown.map((h, i) => `
          <div class="hab${ticked(h, off(0)) ? " done-today" : ""}${fx.pop === h.id + "|" + off(0) ? " just-done" : ""}"
            style="--h:${rowHue(h, secById(h.section_id))};--i:${Math.min(i, 12)}" data-habit="${h.id}">
            <div class="hab-name">
              <button class="n hab-open" data-act="edit-habit" data-id="${h.id}" title="${esc(t("edit_habit"))}">${esc(h.name)}</button>
              <div class="s">${esc(memberName(h.assignee_id))} · ${esc(habitTarget(h))}</div></div>
            <button class="hcell today${ticked(h, off(0)) ? " on" : ""}${fx.pop === h.id + "|" + off(0) ? " pop" : ""}" data-act="habit" data-id="${h.id}" data-day="${off(0)}"></button>
          </div>`).join("") : `<div class="empty" style="margin:14px">${esc(t("no_habits_yet"))}</div>`}
      </div></div>
    </div>
    <h2 style="font-size:16px;margin:22px 0 10px">${esc(t("sections"))}</h2>
    <div class="sec-grid">${state.sections.map((s) => {
      const n = openTasks().filter((x) => x.section_id === s.id).length;
      const soon = openTasks().filter((x) => x.section_id === s.id).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
      const notes = state.notes.filter((x) => x.section_id === s.id).length;
      return `<button class="sec-card" style="--h:${s.hue}" data-act="go" data-view="section" data-sec="${s.id}">
        <div class="row" style="gap:9px"><span class="chip chip-lg">${esc(sectionCode(s))}</span><span class="nm">${esc(sectionName(s))}</span></div>
        <div class="ln mono" style="font-size:12px">${esc(countLabel(n, "task_one", "task_many"))} · ${esc(countLabel(notes, "note_one", "note_many"))}</div>
        <div class="bar"><i style="width:${Math.min(100, n * 14 + 8)}%"></i></div>
        <div class="ln">${soon ? esc(t("next_is", { title: soon.title, when: human(soon.due_date) })) : esc(t("no_open_tasks"))}</div>
      </button>`;
    }).join("")}</div>`;
}

/* One way in for everything: the same dialog the top bar opens. */
function addBarHTML(kind, sectionId) {
  return `<div class="add-bar">
    <button class="btn btn-primary" data-act="${kind === "habit" ? "pick-habit" : "pick-task"}"
      ${sectionId ? `data-sec="${sectionId}"` : ""}>
      ${esc(kind === "habit" ? t("add_habit_btn") : t("add_task_btn"))}
    </button>
    <span class="hint">${esc(t("hold_hint"))}</span>
  </div>`;
}

function viewUpcoming() {
  return `<div class="row" style="justify-content:space-between;margin-bottom:14px">${filtersHTML()}
      <button class="btn btn-ghost btn-sm" data-act="go" data-view="calendar">${esc(t("calendar_view"))}</button></div>
    ${groupsHTML(openTasks())}${addBarHTML("task")}`;
}

function viewCalendar() {
  const m = state.calMonth, y = m.getFullYear(), mo = m.getMonth();
  const startDow = (new Date(y, mo, 1).getDay() + 6) % 7;
  const start = new Date(y, mo, 1 - startDow);
  let cells = names().dowShort.map((d) => `<div class="cal-dow">${esc(d)}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = iso(d), isOut = d.getMonth() !== mo, isToday = key === off(0);
    const evs = state.tasks.filter((x) => x.due_date === key && !x.done && whoOk(x));
    cells += `<div class="cal-day${isOut ? " out" : ""}${isToday ? " today" : ""}"><div class="cal-num">${d.getDate()}</div>
      ${evs.slice(0, 3).map((x) => `<button class="cal-ev${diff(x.due_date) < 0 ? " od" : ""}" style="--h:${secById(x.section_id).hue}" data-act="edit-task" data-id="${x.id}" title="${esc(x.title)}">${esc(x.title)}</button>`).join("")}
      ${evs.length > 3 ? `<div class="cal-more">${esc(t("cal_more", { n: evs.length - 3 }))}</div>` : ""}</div>`;
  }
  return `<div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div class="row"><button class="btn btn-ghost btn-sm" data-act="cal" data-d="-1">‹</button>
      <h2 style="font-size:18px;min-width:186px;text-align:center">${esc(names().monthLong[mo])} ${y}</h2>
      <button class="btn btn-ghost btn-sm" data-act="cal" data-d="1">›</button>
      <button class="btn btn-ghost btn-sm" data-act="cal" data-d="0">${esc(t("today_btn"))}</button></div>
      ${filtersHTML()}</div>
    <div class="cal">${cells}</div>
    <p class="hint" style="margin-top:10px">${esc(t("cal_legend"))}</p>`;
}

function viewHabits() {
  const days = habitDays();
  const visible = state.habits.filter((h) => whoOk(h));
  const first = parseDate(days[0]);
  return `<div class="row" style="justify-content:space-between;margin-bottom:14px">
      <p class="hint" style="margin:0;max-width:60ch">${esc(t("habits_intro"))}</p>
      ${filtersHTML()}</div>
    <div class="card"><div class="card-head"><h2>${esc(t("habits"))}</h2><div class="spacer"></div>
      <span class="hint mono" style="font-size:11px">${first.getDate()} ${esc(names().monthShort[first.getMonth()])} → ${esc(t("today"))}</span></div>
      <div>${visible.length ? visible.map((h, i) => `
        <div class="hab${ticked(h, off(0)) ? " done-today" : ""}${fx.pop && fx.pop.startsWith(h.id + "|") ? " just-done" : ""}"
          style="--h:${rowHue(h, secById(h.section_id))};--i:${Math.min(i, 12)}" data-habit="${h.id}">
          <div class="hab-name">
            <button class="n hab-open" data-act="edit-habit" data-id="${h.id}" title="${esc(t("edit_habit"))}">${esc(h.name)}</button>
            <div class="s"><button class="sec-link" data-act="go" data-view="section" data-sec="${h.section_id}">${esc(sectionName(secById(h.section_id)))}</button> · ${esc(habitTarget(h))}</div></div>
          <span class="who-wrap corner" title="${esc(memberName(h.assignee_id))}">${whoBadge(h.assignee_id)}</span>
          <div class="hgrid">${days.map((d) =>
            `<button class="hcell${ticked(h, d) ? " on" : ""}${d === off(0) ? " today" : ""}${fx.pop === h.id + "|" + d ? " pop" : ""}" data-act="habit" data-id="${h.id}" data-day="${d}" title="${d}"></button>`).join("")}</div>
          <div class="streak">${esc(t("habit_streak", { n: streak(h) }))}</div>
        </div>`).join("") : `<div class="empty" style="margin:14px">${esc(t("no_habits_add_first"))}</div>`}
      </div></div>
    ${addBarHTML("habit")}`;
}

function viewSection(id) {
  const s = secById(id);
  const tasks = state.tasks.filter((x) => x.section_id === id && !x.done && whoOk(x));
  const doneN = state.tasks.filter((x) => x.section_id === id && x.done).length;
  const notes = state.notes.filter((n) => n.section_id === id);
  const habs = state.habits.filter((h) => h.section_id === id);
  let body = "";
  if (state.tab === "tasks") {
    body = groupsHTML(tasks) + addBarHTML("task", id);
  } else if (state.tab === "notes") {
    body = `<div class="qa" style="margin-bottom:12px">
        <input type="text" id="nt-title" placeholder="${esc(t("note_title"))}">
        <input type="text" id="nt-body" placeholder="${esc(t("note_text"))}" style="flex:2 1 260px;border:none;background:none">
        <button class="btn btn-primary btn-sm" data-act="add-note" data-sec="${id}">${esc(t("add_note"))}</button></div>` +
      (notes.length ? `<div class="notes">${notes.map((n) => `
        <article class="note" style="--h:${s.hue}"><h4>${esc(n.title)}</h4><p>${esc(n.body)}</p>
          <div class="note-foot">${whoBadge(n.created_by)}<span>${human(String(n.created_at).slice(0, 10))}</span>
          <div class="spacer"></div><button class="del" style="opacity:1" data-act="del-note" data-id="${n.id}" aria-label="${esc(t("delete"))}">×</button></div>
        </article>`).join("")}</div>` : `<div class="empty">${esc(t("no_notes"))}</div>`);
  } else {
    body = `<div class="card"><div class="card-head"><h2>${esc(t("habits_in_section"))}</h2></div><div>
      ${habs.length ? habs.map((h) => `
        <div class="hab${ticked(h, off(0)) ? " done-today" : ""}${fx.pop && fx.pop.startsWith(h.id + "|") ? " just-done" : ""}"
          style="--h:${rowHue(h, s)}" data-habit="${h.id}"><div class="hab-name">
          <button class="n hab-open" data-act="edit-habit" data-id="${h.id}" title="${esc(t("edit_habit"))}">${esc(h.name)}</button>
          <div class="s">${esc(memberName(h.assignee_id))} · ${esc(habitTarget(h))}</div></div>
          <span class="who-wrap corner" title="${esc(memberName(h.assignee_id))}">${whoBadge(h.assignee_id)}</span>
        <div class="hgrid">${habitDays().map((d) => `<button class="hcell${ticked(h, d) ? " on" : ""}${d === off(0) ? " today" : ""}${fx.pop === h.id + "|" + d ? " pop" : ""}" data-act="habit" data-id="${h.id}" data-day="${d}"></button>`).join("")}</div></div>`).join("")
        : `<div class="empty" style="margin:14px">${esc(t("no_habits_here"))}</div>`}
      </div></div>
      <div class="card" style="margin-top:12px"><div class="card-head"><h2>${esc(t("history"))}</h2></div>
      <div class="card-body"><p style="margin:0;color:var(--ink-2)">${esc(t("closed_in_section", { n: doneN }))}</p></div></div>`;
  }
  return `<div class="sec-head" style="--h:${s.hue}"><span class="chip chip-lg">${esc(sectionCode(s))}</span>
      <div style="flex:1;min-width:0"><h1>${esc(sectionName(s))}</h1><p>${esc(sectionDesc(s))}</p></div>
      <button class="btn btn-ghost btn-sm sec-del" data-act="del-section" data-id="${id}">${esc(t("delete_section"))}</button></div>
    <div class="row" style="justify-content:space-between"><div class="tabs">
      ${[["tasks", t("tasks_n", { n: tasks.length })], ["notes", t("notes_n", { n: notes.length })], ["more", t("habits_history")]]
        .map(([k, label]) => `<button class="tab${state.tab === k ? " on" : ""}" data-act="tab" data-tab="${k}">${esc(label)}</button>`).join("")}
      </div>${filtersHTML()}</div>${body}`;
}

/* ------------------------------------------------------------- app shell */

function renderApp() {
  if (!state.board) return;
  const MAIN = [
    { k: "overview", n: t("overview"), code: "OV", h: 163 },
    { k: "upcoming", n: t("tasks_view"), code: "TA", h: 38 },
    { k: "calendar", n: t("calendar"), code: "CA", h: 210 },
    { k: "habits", n: t("habits"), code: "HA", h: 295 }
  ];
  const counts = {
    overview: "", upcoming: openTasks().length, calendar: "",
    habits: state.habits.filter((h) => whoOk(h)).length
  };
  let title = t("overview"), content = "";
  if (state.view.type === "overview") content = viewOverview();
  else if (state.view.type === "upcoming") { title = t("tasks_view"); content = viewUpcoming(); }
  else if (state.view.type === "calendar") { title = t("calendar"); content = viewCalendar(); }
  else if (state.view.type === "habits") { title = t("habits"); content = viewHabits(); }
  else { title = sectionName(secById(state.view.sec)); content = viewSection(state.view.sec); }

  root.className = "shell";
  root.innerHTML = `
    <aside class="sidebar">
      <div class="side-head">
        <span class="brand-mark" aria-hidden="true">TL</span>
        <span><span class="side-panel-name">${esc(state.board.name)}</span>
        <span class="side-panel-sub">${esc(state.board.invite_code)}</span></span>
      </div>
      <div class="nav-group">${MAIN.map((m) => `
        <button class="nav-item${state.view.type === m.k ? " active" : ""}" style="--h:${m.h}" data-act="go" data-view="${m.k}">
          <span class="chip">${m.code}</span>${esc(m.n)}<span class="nav-count">${counts[m.k]}</span></button>`).join("")}
      </div>
      <div class="nav-group">
        <div class="nav-title">${esc(t("life_sections"))}</div>
        ${state.sections.map((s) => {
          const n = state.tasks.filter((x) => x.section_id === s.id && !x.done).length;
          return `<button class="nav-item${state.view.type === "section" && state.view.sec === s.id ? " active" : ""}" style="--h:${s.hue}" data-act="go" data-view="section" data-sec="${s.id}">
            <span class="chip">${esc(sectionCode(s))}</span>${esc(sectionName(s))}<span class="nav-count">${n || ""}</span></button>`;
        }).join("")}
        <button class="nav-item" style="--h:163" data-act="new-section"><span class="chip">+</span>${esc(t("new_section"))}</button>
      </div>

    </aside>
    <div class="main">
      <header class="topbar">
        <button class="burger" data-act="drawer" aria-label="${esc(t("open_menu"))}">
          <span></span><span></span><span></span>
        </button>
        <h1>${esc(title)}</h1>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" data-act="add-something">${esc(t("add_short"))}</button>
        <button class="acct-btn" data-act="account-menu" aria-haspopup="menu" title="${esc(me()?.display_name || displayName())}">
          ${avatarHTML(me(), "avatar av-lg")}
        </button>
      </header>
      <div class="content">${content}</div>
    </div>`;
}

/* ------------------------------------------------------------- modals */

const closeModal = () => {
  $("modal-root").innerHTML = "";
  if (!$("drawer")) document.body.classList.remove("locked");
};
const openModal = (node) => {
  $("modal-root").appendChild(node);
  document.body.classList.add("locked");
};

function stepEditorHTML(task) {
  const steps = task ? stepsOf(task.id) : pendingSteps.map((title, i) => ({ id: "p" + i, title, done: false, pending: true }));
  return `<div class="steps-editor" id="m-steps" data-task="${task ? task.id : ""}">
    ${steps.length ? `<ul class="steps edit">${steps.map((x) => `
      <li class="step${x.done ? " done" : ""}">
        ${x.pending
          ? `<span class="step-tick" aria-hidden="true"></span>`
          : `<button class="step-tick" data-act="toggle-step" data-id="${x.id}" aria-label="${esc(x.title)}">
              <svg viewBox="0 0 12 12" fill="none" stroke="${x.done ? "var(--on-accent)" : "currentColor"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 6.3 4.4 9.2 10.5 3"/></svg>
            </button>`}
        <span>${esc(x.title)}</span>
        <button class="del" style="opacity:1" data-act="${x.pending ? "del-pending-step" : "del-step"}" data-id="${x.pending ? x.id.slice(1) : x.id}" aria-label="${esc(t("delete"))}">×</button>
      </li>`).join("")}</ul>` : `<p class="hint" style="margin:0 0 6px">${esc(t("no_steps"))}</p>`}
    <div class="row" style="gap:6px">
      <input type="text" id="m-step" placeholder="${esc(t("step_placeholder"))}" style="flex:1">
      <button class="btn btn-ghost btn-sm" data-act="add-step" data-task="${task ? task.id : ""}">${esc(t("add_step"))}</button>
    </div>
  </div>`;
}

function refreshStepEditor() {
  const box = $("m-steps");
  if (!box) return;
  const id = box.dataset.task;
  const task = id ? taskById(id) : null;
  const fresh = el(stepEditorHTML(task));
  box.replaceWith(fresh);
  $("m-step")?.focus();
}

function taskFormHTML(task, presetSection) {
  const rec = task?.recurrence || "";
  return `
    <div class="field"><label for="m-title">${esc(t("what_needs_doing"))}</label>
      <input id="m-title" type="text" placeholder="${esc(t("task_placeholder"))}" value="${esc(task?.title || "")}"></div>
    <div class="grid2">
      <div class="field"><label for="m-sec">${esc(t("section"))}</label><select id="m-sec">${sectionOptions(task?.section_id ?? presetSection ?? state.view.sec)}</select></div>
      <div class="field"><label for="m-date">${esc(t("date"))}</label><input id="m-date" type="date" value="${task?.due_date || off(0)}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label for="m-rec">${esc(t("repeat"))}</label><select id="m-rec">${recurrenceOptions(rec)}</select></div>
      <div class="field"><label for="m-who">${esc(t("who"))}</label><select id="m-who">${assigneeOptions(task ? (task.assignee_id ?? "shared") : state.user.id)}</select></div>
    </div>
    <div id="m-fromdone-wrap" class="${rec ? "" : "hidden"}">
      <label class="check">
        <input type="checkbox" id="m-fromdone"${task?.recur_from_completion ? " checked" : ""}> ${esc(t("from_completion"))}</label>
      <p class="hint" style="margin:4px 0 0">${esc(t("from_completion_hint"))}</p>
    </div>
    <label class="check"><input type="checkbox" id="m-pri"${task?.important ? " checked" : ""}> ${esc(t("mark_important"))}</label>
    <div class="field"><label for="m-desc">${esc(t("description"))}</label>
      <textarea id="m-desc" rows="3" placeholder="${esc(t("description_placeholder"))}">${esc(task?.description || "")}</textarea></div>
    <div><label>${esc(t("checklist"))}</label>${stepEditorHTML(task)}</div>`;
}

let pendingSteps = [];

function readTaskForm() {
  const who = $("m-who").value;
  return {
    description: $("m-desc").value.trim(),
    steps: pendingSteps.slice(),
    title: $("m-title").value,
    section_id: $("m-sec").value,
    due_date: $("m-date").value,
    recurrence: $("m-rec").value || null,
    recur_from_completion: $("m-rec").value ? $("m-fromdone").checked : false,
    assignee_id: who === "shared" ? null : who,
    important: $("m-pri").checked
  };
}

function addMenuModal() {
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true" style="width:min(430px,100%)">
    <div class="modal-head"><h2>${esc(t("add_something"))}</h2><div class="spacer"></div>
      <button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body">
      <div class="pick-pair">
        <button class="pick-tile" style="--h:38" data-act="pick-task">
          <span class="pick-name">${esc(t("a_task").toUpperCase())}</span>
          <span class="pick-desc">${esc(t("a_task_desc"))}</span>
        </button>
        <button class="pick-tile" style="--h:295" data-act="pick-habit">
          <span class="pick-name">${esc(t("a_habit").toUpperCase())}</span>
          <span class="pick-desc">${esc(t("a_habit_desc"))}</span>
        </button>
      </div>
    </div>
  </div></div>`));
}

const FREQS = ["freq_daily", "freq_5w", "freq_3w", "freq_weekly", "freq_weekend"];

function newHabitModal(sectionId) {
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(t("new_habit"))}</h2><div class="spacer"></div>
      <button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body">
      <div class="field"><label for="nh-name">${esc(t("habit_name"))}</label>
        <input id="nh-name" type="text" placeholder="${esc(t("new_habit_placeholder"))}"></div>
      <div class="grid2">
        <div class="field"><label for="nh-sec">${esc(t("section"))}</label><select id="nh-sec">${sectionOptions(sectionId || state.view.sec)}</select></div>
        <div class="field"><label for="nh-who">${esc(t("who"))}</label><select id="nh-who">${assigneeOptions(state.user.id)}</select></div>
      </div>
      <div class="field"><label for="nh-freq">${esc(t("how_often"))}</label>
        <select id="nh-freq">${FREQS.map((f) => `<option value="${esc(t(f))}">${esc(t(f))}</option>`).join("")}</select></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-act="close">${esc(t("cancel"))}</button>
      <button class="btn btn-primary" data-act="save-habit">${esc(t("add_habit"))}</button></div>
  </div></div>`));
  $("nh-name").focus();
}

function newTaskModal(sectionId) {
  pendingSteps = [];
  const preset = sectionId || state.view.sec;
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(t("new_task"))}</h2><div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body">${taskFormHTML(null, preset)}</div>
    <div class="modal-foot"><button class="btn btn-ghost" data-act="close">${esc(t("cancel"))}</button>
    <button class="btn btn-primary" data-act="save-task">${esc(t("add"))}</button></div>
  </div></div>`));
  $("m-title").focus();
}

function editTaskModal(id) {
  const task = taskById(id);
  if (!task) return;
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(t("edit_task"))}</h2><div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body">${taskFormHTML(task)}</div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-act="del-task-modal" data-id="${task.id}">${esc(t("delete"))}</button>
      <button class="btn btn-ghost" data-act="go-section" data-sec="${task.section_id}">${esc(t("open_section"))}</button>
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">${esc(t("cancel"))}</button>
      <button class="btn btn-primary" data-act="update-task" data-id="${task.id}">${esc(t("save_changes"))}</button>
    </div>
  </div></div>`));
  $("m-title").focus();
}

function shareModal() {
  const owner = me()?.role === "owner";
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(t("share_title"))}</h2><div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body">
      <div><label>${esc(t("invite_code"))}</label><div class="code">${esc(state.board.invite_code)}</div>
      <p class="hint" style="margin:8px 0 0">${esc(t("invite_code_hint"))}</p></div>
      <div><label>${esc(t("people_on_board"))}</label>
        ${state.members.map((m) => `<div class="member">
          <span class="avatar" style="background:hsl(${m.hue} 42% 35%);color:#fff">${esc(initials(m.display_name))}</span>
          <div><div class="nm">${esc(m.display_name)}${m.user_id === state.user.id ? esc(t("you_suffix")) : ""}</div>
          <div class="rl">${esc(m.role === "owner" ? t("role_owner") : t("role_member"))}${m.email ? ` · ${esc(m.email)}` : ""}</div></div></div>`).join("")}
      </div>
    </div>
    <div class="modal-foot">
      ${owner ? `<button class="btn btn-ghost" data-act="rotate-code">${esc(t("new_code"))}</button>` : ""}
      <button class="btn btn-ghost" data-act="close">${esc(t("close"))}</button>
      <button class="btn btn-primary" data-act="copy-code">${esc(t("copy_code"))}</button></div>
  </div></div>`));
}

/* Nothing disappears without a question. */
function confirmModal({ title, body, confirm, act, id }) {
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true" style="width:min(420px,100%)">
    <div class="modal-head"><h2>${esc(title)}</h2><div class="spacer"></div>
      <button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body"><p style="margin:0;color:var(--ink-2)">${esc(body)}</p></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-act="close">${esc(t("cancel"))}</button>
      <button class="btn btn-danger" data-act="${act}" data-id="${id}">${esc(confirm)}</button></div>
  </div></div>`));
}

function confirmDeleteTask(id) {
  const task = taskById(id);
  if (!task) return;
  const steps = stepsOf(id).length;
  confirmModal({
    title: t("confirm_delete", { name: task.title }),
    body: steps
      ? t("confirm_delete_task_steps", { n: countLabel(steps, "step_one", "step_many") })
      : t("confirm_delete_task"),
    confirm: t("delete"), act: "do-del-task", id
  });
}

function confirmDeleteHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  confirmModal({
    title: t("confirm_delete", { name: h.name }),
    body: t("confirm_delete_habit"), confirm: t("delete_habit"), act: "do-del-habit", id
  });
}

function confirmDeleteNote(id) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  confirmModal({
    title: t("confirm_delete", { name: n.title }),
    body: t("confirm_delete_note"), confirm: t("delete"), act: "do-del-note", id
  });
}

function deleteSectionModal(id) {
  const sec = secById(id);
  const tasks = state.tasks.filter((x) => x.section_id === id).length;
  const notes = state.notes.filter((x) => x.section_id === id).length;
  const habits = state.habits.filter((x) => x.section_id === id).length;
  const empty = tasks + notes + habits === 0;
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true" style="width:min(430px,100%)">
    <div class="modal-head"><h2>${esc(t("delete_section_q", { name: sectionName(sec) }))}</h2>
      <div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body"><p style="margin:0;color:var(--ink-2)">${esc(empty
      ? t("delete_section_empty")
      : t("delete_section_body", {
          tasks: countLabel(tasks, "task_one", "task_many"),
          notes: countLabel(notes, "note_one", "note_many"),
          habits: countLabel(habits, "habit_one", "habit_many")
        }))}</p></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-act="close">${esc(t("cancel"))}</button>
      <button class="btn btn-danger" data-act="confirm-del-section" data-id="${id}">${esc(t("delete_section"))}</button></div>
  </div></div>`));
}

function newSectionModal() {
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(t("new_section"))}</h2><div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body"><div class="field"><label for="s-name">${esc(t("section_name"))}</label>
      <input id="s-name" type="text" placeholder="${esc(t("section_placeholder"))}"></div></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-act="close">${esc(t("cancel"))}</button>
    <button class="btn btn-primary" data-act="save-section">${esc(t("add_section"))}</button></div>
  </div></div>`));
  $("s-name").focus();
}

function editHabitModal(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(t("edit_habit"))}</h2><div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body">
      <div class="field"><label for="h-name">${esc(t("habit_name"))}</label>
        <input id="h-name" type="text" value="${esc(h.name)}"></div>
      <div class="grid2">
        <div class="field"><label for="h-sec">${esc(t("section"))}</label><select id="h-sec">${sectionOptions(h.section_id)}</select></div>
        <div class="field"><label for="h-who">${esc(t("who"))}</label><select id="h-who">${assigneeOptions(h.assignee_id ?? "shared")}</select></div>
      </div>
      <div class="field"><label for="h-target">${esc(t("frequency"))}</label>
        <input id="h-target" type="text" value="${esc(habitTarget(h))}" placeholder="${esc(t("frequency_placeholder"))}"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-act="del-habit" data-id="${h.id}">${esc(t("delete_habit"))}</button>
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">${esc(t("cancel"))}</button>
      <button class="btn btn-primary" data-act="update-habit" data-id="${h.id}">${esc(t("save_changes"))}</button>
    </div>
  </div></div>`));
  $("h-name").focus();
}

/* The whole navigation, slid in from the left on narrow screens. */
function openDrawer() {
  if ($("drawer")) return;
  const nav = document.querySelector(".sidebar")?.innerHTML || "";
  const wrap = el(`<div id="drawer" class="drawer-wrap">
    <div class="drawer-scrim" data-act="close-drawer"></div>
    <aside class="drawer">
      <div class="drawer-head">
        <span class="brand-mark" aria-hidden="true">TL</span>
        <span class="drawer-title">${esc(t("menu"))}</span>
        <div class="spacer"></div>
        <button class="del" style="opacity:1" data-act="close-drawer" aria-label="${esc(t("close"))}">×</button>
      </div>
      <div class="drawer-body">${nav}</div>
    </aside>
  </div>`);
  document.body.appendChild(wrap);
  document.body.classList.add("locked");
  requestAnimationFrame(() => wrap.classList.add("in"));
}

function closeDrawer() {
  const wrap = $("drawer");
  if (!wrap) return;
  wrap.classList.remove("in");
  document.body.classList.remove("locked");
  setTimeout(() => wrap.remove(), 240);
}

/* Edit or delete, from holding a task or a habit. */
function rowMenu(anchor, kind, id) {
  const open = document.querySelector("#menu-root .popover");
  closeMenu();
  if (open && open.dataset.row === id) return;
  const isTask = kind === "task";
  const menu = el(`<div class="popover popover-task" role="menu" data-row="${id}">
    <button class="pop-item" data-act="${isTask ? "edit-task" : "edit-habit"}" data-id="${id}">
      <span class="pop-ico">✎</span>${esc(isTask ? t("edit_task") : t("edit_habit"))}</button>
    <button class="pop-item danger" data-act="${isTask ? "del-task" : "del-habit-row"}" data-id="${id}">
      <span class="pop-ico">✕</span>${esc(t("delete"))}</button>
  </div>`);
  placePopover(menu, anchor);
  buzz(14);
}

/* A press that lingers is a request for options, not a tap. */
(function holdToOpen() {
  let timer = null, startX = 0, startY = 0, target = null, heldAt = 0;

  /* the release after a hold is not a tap on whatever sat under the finger */
  document.addEventListener("click", (e) => {
    if (Date.now() - heldAt < 600 && !e.target.closest?.(".popover")) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  const cancel = () => { clearTimeout(timer); timer = null; target = null; };

  const begin = (e, point) => {
    const card = e.target.closest?.(".task, .hab");
    if (!card || e.target.closest(".tick, .hcell, .step-tick, .popover, a, input, select, textarea")) return;
    const kind = card.classList.contains("task") ? "task" : "habit";
    const id = kind === "task" ? card.dataset.id : card.dataset.habit;
    if (!id) return;
    startX = point.clientX; startY = point.clientY; target = card;
    timer = setTimeout(() => {
      timer = null;
      heldAt = Date.now();
      card.classList.add("held");
      setTimeout(() => card.classList.remove("held"), 260);
      rowMenu(card, kind, id);
    }, 480);
  };

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return cancel();
    begin(e, e.touches[0]);
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!timer) return;
    const p = e.touches[0];
    if (Math.abs(p.clientX - startX) > 12 || Math.abs(p.clientY - startY) > 12) cancel();
  }, { passive: true });
  document.addEventListener("touchend", cancel, { passive: true });
  document.addEventListener("touchcancel", cancel, { passive: true });

  document.addEventListener("mousedown", (e) => { if (e.button === 0) begin(e, e); });
  document.addEventListener("mousemove", (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > 12 || Math.abs(e.clientY - startY) > 12) cancel();
  });
  document.addEventListener("mouseup", cancel);

  /* the desktop right-click lands on the same menu */
  document.addEventListener("contextmenu", (e) => {
    const card = e.target.closest?.(".task, .hab");
    if (!card) return;
    const kind = card.classList.contains("task") ? "task" : "habit";
    const id = kind === "task" ? card.dataset.id : card.dataset.habit;
    if (!id) return;
    e.preventDefault();
    rowMenu(card, kind, id);
  });
})();

/* Small menu anchored to the account button. */
function accountMenu(anchor) {
  closeMenu();
  const menu = el(`<div class="popover" role="menu">
    <div class="pop-head">
      ${avatarHTML(me(), "avatar av-lg")}
      <div style="min-width:0">
        <div class="nm">${esc(me()?.display_name || displayName())}</div>
        <div class="sub">${esc(state.user?.email || "")}</div>
      </div>
    </div>
    <button class="pop-item" data-act="settings"><span class="pop-ico">⚙</span>${esc(t("settings"))}</button>
    <button class="pop-item" data-act="share"><span class="pop-ico">↗</span>${esc(t("sharing"))}</button>
    <button class="pop-item" data-act="switch-board"><span class="pop-ico">⇄</span>${esc(t("switch_board"))}</button>
    <div class="pop-sep"></div>
    <button class="pop-item danger" data-act="sign-out"><span class="pop-ico">⏻</span>${esc(t("sign_out"))}</button>
  </div>`);
  placePopover(menu, anchor);
}
const closeMenu = () => { const r = document.getElementById("menu-root"); if (r) r.innerHTML = ""; };

/* Keep a popover inside the window: pick the side with room, cap its height. */
function placePopover(menu, anchor) {
  const root = document.getElementById("menu-root");
  menu.style.visibility = "hidden";
  menu.style.maxHeight = "";
  root.appendChild(menu);

  const gap = 8, edge = 8;
  const a = anchor.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const width = menu.offsetWidth;
  let height = menu.offsetHeight;

  const below = vh - a.bottom - gap - edge;
  const above = a.top - gap - edge;
  let top;
  if (height <= below) top = a.bottom + gap;
  else if (height <= above) top = a.top - height - gap;
  else if (below >= above) { menu.style.maxHeight = `${below}px`; top = a.bottom + gap; }
  else { menu.style.maxHeight = `${above}px`; height = Math.min(height, above); top = a.top - height - gap; }

  menu.style.left = `${Math.round(Math.min(Math.max(edge, a.left), Math.max(edge, vw - width - edge)))}px`;
  menu.style.top = `${Math.round(Math.max(edge, top))}px`;
  menu.style.visibility = "";
}

/* A popover pinned to a moving target has to go when the page moves under it. */
window.addEventListener("resize", closeMenu);
window.addEventListener("scroll", (e) => {
  // the menu scrolls inside itself when it is long — that is not a page scroll
  const el = e.target;
  if (el && el.closest && el.closest(".popover")) return;
  closeMenu();
}, true);

function settingsModal() {
  const themes = [["system", t("theme_system")], ["light", t("theme_light")], ["dark", t("theme_dark")]];
  openModal(el(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(t("settings_title"))}</h2><div class="spacer"></div><button class="del" style="opacity:1" data-act="close">×</button></div>
    <div class="modal-body">
      <div class="row" style="gap:14px;align-items:flex-start">
        ${avatarHTML(me() || { display_name: displayName(), avatar_url: profileAvatar() }, "avatar av-xl")}
        <div style="flex:1;min-width:170px">
          <label>${esc(t("profile_photo"))}</label>
          <div class="row" style="gap:8px;margin-top:6px">
            <label class="btn btn-ghost btn-sm" style="text-transform:none;letter-spacing:0;font-family:inherit;font-size:13px;color:var(--ink)">
              ${esc(t("upload_photo"))}<input type="file" id="set-photo" accept="image/*" hidden>
            </label>
            ${profileAvatar() ? `<button class="btn btn-ghost btn-sm" data-act="remove-photo">${esc(t("remove_photo"))}</button>` : ""}
          </div>
          <p class="hint" style="margin:6px 0 0">${esc(t("photo_hint"))}</p>
        </div>
      </div>
      ${state.board ? `<div><label>${esc(t("your_colour"))}</label>
        <div class="swatches">${[163, 210, 288, 38, 345, 120, 262, 16].map((h) => {
          const taken = state.members.find((m) => m.user_id !== state.user.id && m.hue === h);
          return `<button class="swatch${(me()?.hue ?? 163) === h ? " on" : ""}${taken ? " taken" : ""}"
            style="background:hsl(${h} 42% 40%)" data-act="set-hue" data-hue="${h}"
            title="${esc(taken ? t("colour_taken", { name: taken.display_name }) : "")}"></button>`;
        }).join("")}</div>
        <p class="hint" style="margin:6px 0 0">${esc(t("colour_hint"))}</p></div>` : ""}
      <div><label>${esc(t("language"))}</label>
        <div class="filters" style="margin-top:6px">
          ${["en", "pl"].map((l) => `<button class="fchip${lang === l ? " on" : ""}" data-act="set-lang" data-lang="${l}">${l === "en" ? "English" : "Polski"}</button>`).join("")}
        </div>
        <p class="hint" style="margin:6px 0 0">${esc(t("language_note"))}</p>
      </div>
      <div><label>${esc(t("theme"))}</label>
        <div class="filters" style="margin-top:6px">
          ${themes.map(([v, label]) => `<button class="fchip${theme === v ? " on" : ""}" data-act="set-theme" data-theme="${v}">${esc(label)}</button>`).join("")}
        </div>
      </div>
      ${state.board ? `<div class="field"><label for="set-name">${esc(t("display_name"))}</label>
        <input id="set-name" type="text" value="${esc(me()?.display_name || displayName())}">
        <p class="hint" style="margin:2px 0 0">${esc(t("display_name_hint"))}</p></div>` : ""}
      <div><label>${esc(t("password"))}</label>
        <button class="btn btn-ghost btn-sm" style="margin-top:6px" data-act="change-password">${esc(t("change_password"))}</button></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-act="close">${esc(t("close"))}</button>
      <button class="btn btn-primary" data-act="save-settings">${esc(t("save"))}</button></div>
  </div></div>`));
}

/* ------------------------------------------------------------- events */

function rerenderAfterLangOrTheme() {
  closeModal();
  if (state.board) renderApp();
  else if (state.recovery) renderNewPassword();
  else if (state.user) renderBoardPicker();
  else renderAuth();
  settingsModal();
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act;

  switch (a) {
    /* auth */
    case "auth-tab": state.authTab = b.dataset.tab; return renderAuth();
    case "sign-in": return signIn();
    case "sign-up": return signUp();
    case "send-reset": return sendReset();
    case "save-password": return savePassword();
    case "lang": setLang(b.dataset.lang); return renderAuth();
    case "change-password":
      closeModal();
      state.recovery = true;
      return renderNewPassword();
    case "cancel-recovery":
      state.recovery = false;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      return state.user ? renderBoardPicker() : renderAuth();
    case "sign-out": {
      closeMenu();
      if (channel) { sb.removeChannel(channel); channel = null; }
      localStorage.removeItem("thelife-board");
      state.board = null;
      closeModal();
      await sb.auth.signOut();
      return;
    }

    /* menu and adding */
    case "drawer": return openDrawer();
    case "close-drawer": return closeDrawer();
    case "add-something": return addMenuModal();
    case "pick-task": {
      const sec = b.dataset.sec;
      closeModal();
      return newTaskModal(sec);
    }
    case "pick-habit": {
      const sec = b.dataset.sec;
      closeModal();
      return newHabitModal(sec);
    }
    case "save-habit": {
      const draft = { name: $("nh-name").value, section_id: $("nh-sec").value, who: $("nh-who").value, target: $("nh-freq").value };
      if (!draft.name.trim()) return toast(t("err_habit_name"));
      closeModal();
      return addHabit(draft);
    }
    case "del-habit-row": closeMenu(); return confirmDeleteHabit(b.dataset.id);

    /* account */
    case "account-menu": {
      const open = document.querySelector("#menu-root .popover");
      if (open) return closeMenu();
      return accountMenu(b);
    }
    case "settings": closeMenu(); return settingsModal();
    case "set-hue": return saveMemberHue(+b.dataset.hue);
    case "remove-photo": return removeAvatar();
    case "set-lang": setLang(b.dataset.lang); return rerenderAfterLangOrTheme();
    case "set-theme": {
      theme = b.dataset.theme;
      try { localStorage.setItem("thelife-theme", theme); } catch {}
      applyTheme(theme);
      return rerenderAfterLangOrTheme();
    }
    case "save-settings": {
      const nameInput = $("set-name");
      if (nameInput) await saveMemberName(nameInput.value);
      closeModal();
      if (state.board) renderApp();
      return toast(t("settings_saved"));
    }

    /* boards */
    case "open-board": return openBoard(b.dataset.id);
    case "create-board": return createBoard();
    case "join-board": return joinBoard();
    case "switch-board": {
      closeMenu();
      if (channel) { sb.removeChannel(channel); channel = null; }
      localStorage.removeItem("thelife-board");
      state.board = null;
      return renderBoardPicker();
    }

    /* navigation */
    case "go-close":
      closeMenu();
      state.view = b.dataset.view === "section" ? { type: "section", sec: b.dataset.sec } : { type: b.dataset.view };
      if (b.dataset.view === "section") state.tab = "tasks";
      window.scrollTo({ top: 0 });
      return renderApp();
    case "go":
      closeDrawer();
      state.view = b.dataset.view === "section" ? { type: "section", sec: b.dataset.sec } : { type: b.dataset.view };
      if (b.dataset.view === "section") state.tab = "tasks";
      window.scrollTo({ top: 0 });
      return renderApp();
    case "go-section":
      closeModal();
      state.view = { type: "section", sec: b.dataset.sec };
      state.tab = "tasks";
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

    /* tasks */
    case "toggle": return toggleTask(b.dataset.id);
    case "del-task": closeMenu(); return confirmDeleteTask(b.dataset.id);
    case "del-task-modal": closeModal(); return confirmDeleteTask(b.dataset.id);
    case "edit-task": closeMenu(); return editTaskModal(b.dataset.id);
    case "do-del-task": closeModal(); return deleteTask(b.dataset.id);
    case "do-del-habit": closeModal(); return deleteHabit(b.dataset.id);
    case "do-del-note": closeModal(); return deleteNote(b.dataset.id);
    case "new-task": return newTaskModal();
    case "save-task": {
      const draft = readTaskForm();
      if (!draft.title.trim()) return toast(t("err_need_title"));
      closeModal();
      return addTask(draft);
    }
    case "update-task": {
      const draft = readTaskForm();
      if (!draft.title.trim()) return toast(t("err_need_title"));
      delete draft.steps;                 // checklist is saved as you edit it
      closeModal();
      return updateTask(b.dataset.id, draft, t("task_updated"));
    }
    case "toggle-steps": {
      const id = b.dataset.id;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      return renderApp();
    }
    case "toggle-step": return toggleSubtask(b.dataset.id);
    case "del-step": return deleteSubtask(b.dataset.id);
    case "add-step": {
      const input = $("m-step");
      const title = input.value.trim();
      if (!title) return;
      input.value = "";
      if (b.dataset.task) return addSubtask(b.dataset.task, title);
      pendingSteps.push(title);
      return refreshStepEditor();
    }
    case "del-pending-step": {
      pendingSteps.splice(+b.dataset.id, 1);
      return refreshStepEditor();
    }

    /* notes, habits, sections */
    case "add-note": return addNote(b.dataset.sec);
    case "del-note": return confirmDeleteNote(b.dataset.id);
    case "edit-habit": return editHabitModal(b.dataset.id);
    case "update-habit": {
      const name = $("h-name").value.trim();
      if (!name) return toast(t("err_habit_name"));
      const who = $("h-who").value;
      const patch = {
        name, section_id: $("h-sec").value,
        assignee_id: who === "shared" ? null : who,
        target: $("h-target").value.trim() || "every day"
      };
      closeModal();
      return updateHabit(b.dataset.id, patch, t("habit_updated"));
    }
    case "del-habit": closeModal(); return confirmDeleteHabit(b.dataset.id);
    case "habit": return toggleHabitDay(b.dataset.id, b.dataset.day);
    case "new-section": closeMenu(); closeDrawer(); return newSectionModal();
    case "del-section": return deleteSectionModal(b.dataset.id);
    case "confirm-del-section": return deleteSection(b.dataset.id);
    case "save-section": {
      const name = $("s-name").value.trim();
      if (!name) return toast(t("err_section_name"));
      closeModal();
      return addSection(name);
    }

    /* sharing */
    case "share": closeMenu(); return shareModal();
    case "copy-code":
      try { await navigator.clipboard.writeText(state.board.invite_code); toast(t("code_copied")); }
      catch { toast(state.board.invite_code); }
      return;
    case "rotate-code": {
      const { data, error } = await sb.rpc("rotate_invite_code", { p_board: state.board.id });
      if (error) return toast(error.message);
      state.board.invite_code = data;
      closeModal(); renderApp(); shareModal();
      return toast(t("code_rotated"));
    }

    case "close": return closeModal();
  }
});

/* show or hide the "count from completion" option with the repeat select */
document.addEventListener("change", (e) => {
  if (e.target.id !== "m-rec") return;
  const wrap = $("m-fromdone-wrap");
  if (wrap) wrap.classList.toggle("hidden", !e.target.value);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeModal(); closeMenu(); closeDrawer(); }
  if (e.key !== "Enter") return;
  const id = e.target.id;
  const click = (sel) => document.querySelector(sel)?.click();
  if (id === "m-step") { e.preventDefault(); return click('[data-act="add-step"]'); }
  else if (id === "m-title") {
    const save = document.querySelector('[data-act="update-task"]') || document.querySelector('[data-act="save-task"]');
    save?.click();
  }
  else if (id === "s-name") click('[data-act="save-section"]');
  else if (id === "nt-title" || id === "nt-body") click('[data-act="add-note"]');
  else if (id === "h-name" || id === "h-target") click('[data-act="update-habit"]');
  else if (id === "nh-name") click('[data-act="save-habit"]');
  else if (id === "new-board") click('[data-act="create-board"]');
  else if (id === "join-code") click('[data-act="join-board"]');
  else if (id === "np-1" || id === "np-2") click('[data-act="save-password"]');
  else if (id === "a-email" || id === "a-pass" || id === "a-name") {
    const act = state.authTab === "up" ? "sign-up" : state.authTab === "reset" ? "send-reset" : "sign-in";
    click(`[data-act="${act}"]`);
  }
});

document.addEventListener("mousedown", (e) => {
  if (e.target.classList?.contains("overlay")) closeModal();
  if (!e.target.closest?.(".popover") && !e.target.closest?.('[data-act="account-menu"]')) closeMenu();
});

/* photo picker inside settings */
document.addEventListener("change", (e) => {
  if (e.target.id === "set-photo") uploadAvatar(e.target.files?.[0]);
});

/* ------------------------------------------------------------- boot */

// Arriving from the "reset password" email.
{
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  if (hash.get("type") === "recovery" || query.get("type") === "recovery") state.recovery = true;
}

sb.auth.onAuthStateChange(async (event, session) => {
  const user = session?.user || null;
  const changed = user?.id !== state.user?.id;
  state.user = user;
  if (event === "PASSWORD_RECOVERY" || state.recovery) {
    state.recovery = true;
    if (!$("np-1")) renderNewPassword();
    return;
  }
  if (!user) { state.board = null; return renderAuth(); }
  if (!changed && state.board) return;
  const last = localStorage.getItem("thelife-board");
  if (last) {
    const boards = await loadBoards();
    if (boards.some((x) => x.id === last)) return openBoard(last);
  }
  renderBoardPicker();
});

/* Pull down at the top of the page to refresh — with the rubber band the
   browser's own gesture would have given us, and a spring back on release. */
(function pullToRefresh() {
  const THRESHOLD = 70, MAX = 120, DAMPING = 0.45;
  let startY = 0, pulling = false, dist = 0, busy = false;

  const bar = document.createElement("div");
  bar.id = "pull";
  bar.innerHTML = `<span class="pull-ring"><span class="pull-arrow">↓</span></span>`;
  document.body.appendChild(bar);

  const scroller = () => document.scrollingElement || document.documentElement;
  const spring = (on) => {
    root.style.transition = on ? "transform .34s cubic-bezier(.2,.7,.3,1)" : "";
    bar.style.transition = on ? "opacity .3s, transform .34s cubic-bezier(.2,.7,.3,1)" : "";
  };
  const setPull = (d) => {
    dist = d;
    root.style.transform = d ? `translateY(${d.toFixed(1)}px)` : "";
    bar.style.opacity = Math.max(0, Math.min(1, d / THRESHOLD));
    bar.style.transform = `translate(-50%, ${(Math.min(d, MAX) * 0.62).toFixed(1)}px) scale(${(0.72 + Math.min(d, MAX) / MAX * 0.28).toFixed(2)})`;
    bar.classList.toggle("ready", d >= THRESHOLD);
  };

  const atBottom = () => {
    const el = scroller();
    return el.scrollHeight - el.scrollTop - window.innerHeight <= 1;
  };
  let mode = null;                            // "top" or "bottom"

  document.addEventListener("touchstart", (e) => {
    if (busy || e.touches.length !== 1 || !state.board) return;
    if (document.body.classList.contains("locked")) return;
    if (e.target.closest?.(".popover, .modal, .drawer, .cal, .hgrid, input, textarea, select")) return;
    const top = scroller().scrollTop <= 0, bottom = atBottom();
    if (!top && !bottom) return;
    mode = top ? "top" : "bottom";
    startY = e.touches[0].clientY;
    pulling = true;
    spring(false);
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!pulling || busy || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - startY;
    if (mode === "top") {
      if (dy <= 0) { if (dist) setPull(0); mode = scroller().scrollTop <= 0 ? mode : null; return; }
      if (scroller().scrollTop > 0) { pulling = false; setPull(0); return; }
      e.preventDefault();                     // the page stays; the rubber band is ours
      setPull(Math.min(MAX, dy * DAMPING));
    } else {
      if (dy >= 0) { if (dist) setPull(0); return; }
      if (!atBottom()) { pulling = false; setPull(0); return; }
      e.preventDefault();
      setPull(Math.max(-MAX * 0.6, dy * DAMPING * 0.7));   // the end of a list gives less
    }
  }, { passive: false });

  document.addEventListener("touchend", async () => {
    if (!pulling || busy) return;
    pulling = false;
    const go = mode === "top" && dist >= THRESHOLD;
    mode = null;
    spring(true);
    if (go) {
      busy = true;
      bar.classList.add("busy");
      buzz(10);
      setPull(54);
      try { await refreshAll(); renderApp(); } catch {}
      await wait(260);
      bar.classList.remove("busy", "ready");
      busy = false;
      toast(t("refreshed"));
    }
    setPull(0);
    setTimeout(() => spring(false), 360);
  }, { passive: true });
})();

/* Swipe right to open the menu, swipe left to put it away. */
(function swipeForDrawer() {
  let x0 = 0, y0 = 0, tracking = false, fromDrawer = false;

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || !state.board) return;
    if (document.querySelector(".modal")) return;
    const p = e.touches[0];
    fromDrawer = !!$("drawer");
    tracking = fromDrawer || p.clientX < 44;      // the left edge, the way a phone expects
    x0 = p.clientX; y0 = p.clientY;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const p = e.changedTouches[0];
    const dx = p.clientX - x0, dy = Math.abs(p.clientY - y0);
    if (dy > 70) return;                          // that was a scroll
    if (!fromDrawer && dx > 64) openDrawer();
    if (fromDrawer && dx < -56) closeDrawer();
  }, { passive: true });
})();

(async () => {
  const { data } = await sb.auth.getSession();
  if (!data.session) renderAuth();
})();
