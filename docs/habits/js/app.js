import {
  toIso, addDays, daysBetween, applyOps, doneDates, habitStats, missedDays, monthCells,
  toNumber, fmtSaved, parseUnit, isIsoDate, STREAK_MILESTONES,
} from './core.js';
import demoData from './demo-data.js';

/* ---------- storage (keys are prefixed: Lift Log shares this origin) ---------- */

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`hl.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`hl.${key}`, JSON.stringify(value)); } catch { /* private mode: keep going in memory */ }
  },
  del(key) { try { localStorage.removeItem(`hl.${key}`); } catch { /* ignore */ } },
};

const settings = () => ({ apiUrl: '', token: '', ...store.get('settings', {}) });
const isDemo = () => !settings().apiUrl;
const pending = () => store.get('pending', []);

/* ---------- API ---------- */

async function readJson(res) {
  try { return await res.json(); } catch {
    throw new Error('Unexpected reply from Apps Script. Check the deployment is a Web app with access "Anyone".');
  }
}

async function apiGet() {
  const { apiUrl, token } = settings();
  const res = await fetch(`${apiUrl}?action=data&token=${encodeURIComponent(token)}`, { redirect: 'follow' });
  const json = await readJson(res);
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json.data;
}

async function apiPost(payload) {
  const { apiUrl, token } = settings();
  // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight.
  const res = await fetch(apiUrl, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, token }),
  });
  const json = await readJson(res);
  if (!json.ok) throw Object.assign(new Error(json.error || 'Request failed'), { fatal: true });
  return json.data;
}

/* ---------- state ---------- */

const state = {
  base: null, // what the sheet (or demo store) says
  view: 'today',
  habit: store.get('habit', null),
  today: toIso(),
  date: toIso(), // the day the big button logs
  month: null, // [year, monthIndex] shown in the calendar
  editing: false,
  loading: false,
  syncing: false,
  error: null,
};

/** Sheet data with the taps that haven't reached the sheet yet. */
const view = () => applyOps(state.base, isDemo() ? [] : pending());

function setBase(data) {
  state.base = { habits: data.habits || [], log: data.log || [] };
  const names = state.base.habits.map((h) => h.name);
  if (!names.includes(state.habit)) state.habit = names[0] || null;
}

async function load({ quiet = false } = {}) {
  if (isDemo()) { setBase(store.get('demo', demoData)); state.error = null; render(); return; }
  state.loading = true;
  if (!quiet) render();
  try {
    await flush();
    const data = await apiGet();
    store.set('cache', data);
    setBase(data);
    state.error = pending().length ? 'Some taps are still waiting to reach your sheet.' : null;
  } catch (err) {
    setBase(store.get('cache', demoData));
    state.error = `Offline — showing your last synced data. Your taps are saved on this phone and will sync later. (${err.message})`;
  }
  state.loading = false;
  render();
}

/** Every change goes through here: instant on screen, then synced in order. */
function commit(op) {
  if (isDemo()) {
    state.base = applyOps(state.base, [op]);
    store.set('demo', state.base);
  } else {
    store.set('pending', [...pending(), op]);
    flush();
  }
}

async function flush() {
  if (state.syncing || isDemo()) return;
  state.syncing = true;
  renderSync();
  try {
    while (pending().length) {
      const [op] = pending();
      try {
        await apiPost(op);
        state.base = applyOps(state.base, [op]);
        store.set('cache', state.base);
      } catch (err) {
        if (!err.fatal) { state.error = 'Offline — your taps are saved on this phone and will sync when you are back online.'; break; }
        toast(`Your sheet refused a change: ${err.message}`, 'bad');
      }
      store.set('pending', pending().slice(1));
      if (!pending().length) state.error = null;
    }
  } finally {
    state.syncing = false;
    render();
  }
}

/* ---------- helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateObj = (iso) => new Date(`${iso}T12:00:00`);
const fmt = (iso, opts) => dateObj(iso).toLocaleDateString(undefined, opts);
const shortDate = (iso) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
const relDay = (iso) => {
  const n = daysBetween(iso, state.today);
  return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : fmt(iso, { weekday: 'long' });
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const ICONS = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1 2.5 2 3 0-3.5-.5-6 1-8.5z"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};

function toast(msg, kind = '', action = null) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.addEventListener('click', () => { action.run(); t.remove(); });
    t.appendChild(b);
  }
  $('#toasts').replaceChildren(t); // one at a time keeps "Undo" pointing at the latest tap
  setTimeout(() => t.classList.add('out'), action ? 5200 : 3200);
  setTimeout(() => t.remove(), action ? 5600 : 3600);
}

/* ---------- views ---------- */

function renderSync() {
  const n = isDemo() ? 0 : pending().length;
  $('#sync').classList.toggle('busy', state.loading || state.syncing);
  $('#sync').title = n ? `${n} change(s) waiting to sync` : 'Refresh from sheet';
  $('#sync-count').textContent = n || '';
}

function render() {
  document.body.dataset.view = state.view;
  renderSync();
  const banner = $('#banner');
  banner.hidden = !(state.error || isDemo());
  banner.className = `banner ${state.error ? 'warn' : 'info'}`;
  banner.innerHTML = state.error ? esc(state.error)
    : 'Demo mode — taps stay on this phone. <a href="#" data-view="settings">Connect your Google Sheet</a> to save them there.';
  if (!state.base) { $('#main').innerHTML = '<div class="skeleton"></div>'; return; }
  if (state.view === 'settings') renderSettings(); else renderToday();
}

function renderToday() {
  const data = view();
  const habit = data.habits.find((h) => h.name === state.habit);
  if (!habit) {
    $('#main').innerHTML = `<section class="empty-state"><h1>No habits yet</h1>
      <p class="sub">Add one on the <b>Habits</b> tab of your sheet (name, start date, saved per day), then tap refresh.</p></section>`;
    return;
  }
  const dates = doneDates(data.log, habit.name);
  const s = habitStats(habit, dates, state.today);
  const sel = state.date;
  const selDone = dates.has(sel);
  const beforeStart = sel < s.start;
  const missed = missedDays(habit, dates, state.today);
  if (!state.month) { const d = dateObj(sel); state.month = [d.getFullYear(), d.getMonth()]; }

  const week = Array.from({ length: 7 }, (_, i) => addDays(state.today, i - 6));
  const switcher = data.habits.length > 1
    ? `<div class="habit-tabs" role="tablist">${data.habits.map((h) => `<button role="tab" data-habit="${esc(h.name)}" aria-selected="${h.name === habit.name}">${esc(h.name)}</button>`).join('')}</div>`
    : '';

  const saves = s.rate > 0;
  const amount = (v, opts) => fmtSaved(v, s.unit, opts);
  const isTime = s.unit === 'h';
  const startShort = fmt(s.start, { month: 'short', day: 'numeric' });
  const streakNote = s.current && !s.doneToday ? 'Log today to keep it going' : s.current ? 'Keep it up' : s.last ? 'Start a new one today' : 'Your first day starts it';

  $('#main').innerHTML = `
    ${switcher}
    <section class="hero">
      <p class="eyebrow">${esc(habit.name)}</p>
      ${saves ? `
        <p class="saved-label">${isTime ? 'Time won back so far' : 'Saved so far'}</p>
        <p class="saved-amount" id="saved-amount">${amount(s.saved)}</p>
        <p class="sub">${plural(s.completed, 'day')} × ${amount(s.rate)} since ${startShort}</p>` : `
        <p class="saved-label">Current streak</p>
        <p class="saved-amount" id="saved-amount">${plural(s.current, 'day')}</p>
        <p class="sub">${plural(s.completed, 'day')} done since ${startShort}</p>`}
    </section>

    <section class="log card" aria-label="Log a day">
      <div class="week" role="group" aria-label="Pick a day">
        ${week.map((d) => dayButton(d, dates, s.start, sel, 'wk')).join('')}
      </div>
      <button id="big" class="big ${selDone ? 'done' : ''}" aria-pressed="${selDone}"
        aria-label="${selDone ? `${shortDate(sel)} is logged. Tap to undo` : `Log ${habit.name} for ${shortDate(sel)}`}">
        <span class="big-ring">
          <span class="big-icon">${selDone ? ICONS.check : ICONS.plus}</span>
          <span class="big-main">${selDone ? 'Done' : 'I did it'}</span>
          <span class="big-day">${relDay(sel)}${daysBetween(sel, state.today) > 1 ? `<br>${fmt(sel, { month: 'short', day: 'numeric' })}` : ''}</span>
        </span>
      </button>
      <p class="big-hint">${selDone
        ? `Logged${beforeStart || !saves ? '' : ` · +${amount(s.rate)}`}. Tap again to undo.`
        : sel === state.today ? `Tap when you've stuck to it today.`
        : `Forgot to log ${relDay(sel).toLowerCase() === 'yesterday' ? 'yesterday' : shortDate(sel)}? Tap to add it.`}
        ${beforeStart ? `<br><span class="muted">Before your start date (${fmt(s.start, { month: 'short', day: 'numeric' })}), so it counts toward streaks but not ${isTime ? 'time saved' : 'savings'}.</span>` : ''}</p>
      ${missed.length ? `
        <div class="missed">
          <p>Not logged: tap a day you stuck to it</p>
          <div class="missed-days">${missed.map((d) => `<button class="pill" data-quick="${d}">${ICONS.plus}${fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })}</button>`).join('')}</div>
        </div>` : ''}
    </section>

    <section class="stats" aria-label="Stats">
      ${tile('flame', 'Current streak', plural(s.current, 'day'), streakNote, s.current ? 'hot' : '')}
      ${tile('trophy', 'Best streak', plural(s.longest, 'day'), s.longest && s.current === s.longest ? 'You are on your best run' : '')}
      ${tile('target', 'Success rate', `${Math.round(s.completionRate * 100)}%`, `${s.completed} of ${plural(s.daysSinceStart, 'day')}`)}
      ${tile('cal', 'Last logged', s.last ? relDay(s.last) : '—', s.last ? fmt(s.last, { month: 'short', day: 'numeric' }) : 'Nothing yet')}
    </section>

    <section class="card money">
      <div class="card-head"><h2>${!saves ? 'Savings' : isTime ? 'Time saved' : 'Money saved'}</h2>
        ${state.editing ? '' : '<button class="link" id="edit-habit">Edit</button>'}</div>
      ${state.editing ? `
        <form id="habit-form" class="habit-form">
          <fieldset class="unit-pick"><legend>It saves me</legend>
            <label><input type="radio" name="unit" value="$" ${isTime ? '' : 'checked'}><span>Money ($)</span></label>
            <label><input type="radio" name="unit" value="h" ${isTime ? 'checked' : ''}><span>Time (hours)</span></label>
          </fieldset>
          <label><span>Saved per day</span>
            <span class="money-input ${isTime ? 'hours' : ''}"><i class="pre">$</i><input name="rate" type="text" inputmode="decimal" value="${esc(s.rate)}" required aria-label="Saved per day"><i class="post">h</i></span>
            <small class="for-money">e.g. one $2 soda twice a day = 4. Use 0 if it doesn't save money.</small>
            <small class="for-time">e.g. 8:45pm to 10:45pm = 2. Use 0.5 for half an hour.</small></label>
          <label><span>Counting from</span><input name="start" type="date" value="${esc(s.start)}" max="${state.today}" required></label>
          <div class="row"><button class="btn ghost" type="button" id="cancel-edit">Cancel</button><button class="btn primary" type="submit">Save</button></div>
        </form>` : `
        ${saves ? `
        <p class="rate"><b>${amount(s.rate)}</b> per day you stick to it${isTime ? ` · <b>${amount(s.saved)}</b> so far` : ''}</p>
        <div class="proj">
          <div><span>A week</span><b>${amount(s.rate * 7)}</b></div>
          <div><span>A month</span><b>${amount(s.perMonth, { cents: false })}</b></div>
          <div><span>A year</span><b>${amount(s.perYear, { cents: false })}</b>${isTime ? `<small>≈ ${Math.round(s.perYear / 24)} full days</small>` : ''}</div>
        </div>` : '<p class="rate">Not tracking money or time for this habit. Tap <b>Edit</b> to add what it saves you each day.</p>'}`}
    </section>

    <section class="card cal" aria-label="Calendar">
      ${calendar(dates, s.start, sel)}
      <p class="legend"><span><i class="lg done"></i>Done</span><span><i class="lg miss"></i>Not logged</span><span>Tap a day to pick it</span></p>
    </section>`;
}

function dayClasses(d, dates, start) {
  const c = [];
  if (dates.has(d)) c.push('done');
  else if (d >= start && d < state.today) c.push('miss');
  if (d > state.today) c.push('future');
  if (d < start) c.push('pre');
  if (d === state.today) c.push('today');
  return c.join(' ');
}

function dayButton(d, dates, start, sel, kind) {
  const done = dates.has(d);
  return `<button class="${kind} ${dayClasses(d, dates, start)}" data-date="${d}" aria-pressed="${d === sel}"
    aria-label="${shortDate(d)}${done ? ', done' : ''}">
    <span class="wk-dow">${fmt(d, { weekday: 'narrow' })}</span>
    <span class="wk-num">${dateObj(d).getDate()}</span>
    <span class="wk-mark">${done ? ICONS.check : ''}</span>
  </button>`;
}

function calendar(dates, start, sel) {
  const [y, m] = state.month;
  const cells = monthCells(y, m);
  const first = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const monthDone = cells.filter((d) => d && dates.has(d)).length;
  const canNext = first < state.today.slice(0, 7) + '-01';
  const dows = Array.from({ length: 7 }, (_, i) => fmt(addDays('2026-10-11', i), { weekday: 'narrow' })); // a Sunday
  return `
    <div class="cal-head">
      <button class="icon-btn" data-month="-1" aria-label="Previous month">${ICONS.left}</button>
      <div><h2>${fmt(first, { month: 'long', year: 'numeric' })}</h2><p class="sub">${plural(monthDone, 'day')} done</p></div>
      <button class="icon-btn" data-month="1" aria-label="Next month" ${canNext ? '' : 'disabled'}>${ICONS.right}</button>
    </div>
    <div class="cal-grid" role="grid">
      ${dows.map((d) => `<span class="dow">${d}</span>`).join('')}
      ${cells.map((d) => (d
        ? `<button class="cd ${dayClasses(d, dates, start)}" data-date="${d}" data-scroll="1" aria-pressed="${d === sel}" ${d > state.today ? 'disabled' : ''}
            aria-label="${shortDate(d)}${dates.has(d) ? ', done' : ''}">${dateObj(d).getDate()}</button>`
        : '<span></span>')).join('')}
    </div>`;
}

function tile(icon, label, value, note = '', cls = '') {
  return `<div class="tile ${cls}"><span class="tile-icon">${ICONS[icon]}</span>
    <span class="tile-label">${label}</span><b class="tile-value">${value}</b>${note ? `<span class="tile-note">${esc(note)}</span>` : ''}</div>`;
}

function renderSettings() {
  const s = settings();
  const n = pending().length;
  const data = view();
  $('#main').innerHTML = `
    <section class="page-head"><p class="eyebrow">Settings</p><h1>Connect your sheet</h1>
      <p class="sub">Paste the Web app URL and token from the Apps Script setup (see the README). Every tap is then written to the <b>Log</b> tab of your Habit Tracker sheet.</p></section>
    <form class="card settings" id="settings-form">
      <label><span>Apps Script Web app URL</span><input type="url" name="apiUrl" value="${esc(s.apiUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label><span>App token</span><input type="password" name="token" value="${esc(s.token)}" autocomplete="off"></label>
      <div class="row"><button class="btn primary" type="submit">Save & connect</button>
      ${s.apiUrl ? '<button class="btn ghost" type="button" id="disconnect">Use demo mode</button>' : ''}</div>
    </form>
    <section class="card">
      <div class="card-head"><h2>Status</h2></div>
      <ul class="status-list">
        <li><span>Mode</span><b>${isDemo() ? 'Demo (this phone only)' : 'Connected to Google Sheet'}</b></li>
        <li><span>Waiting to sync</span><b>${isDemo() ? '—' : n}</b></li>
        <li><span>Habits</span><b>${data.habits.length}</b></li>
        <li><span>Days logged</span><b>${data.log.length}</b></li>
      </ul>
      ${isDemo() && store.get('demo', null) ? '<button class="btn ghost" id="reset-demo">Reset demo data</button>' : ''}
    </section>
    <p class="foot"><a href="#" data-view="today">← Back to today</a></p>`;
}

/* ---------- actions ---------- */

function toggleDay(date, { from = 'button' } = {}) {
  const data = view();
  const habit = state.habit;
  const wasDone = doneDates(data.log, habit).has(date);
  if (date > state.today) return;
  const op = { action: wasDone ? 'unlogDay' : 'logDay', habit, date };
  const undo = { action: wasDone ? 'logDay' : 'unlogDay', habit, date };
  commit(op);
  try { navigator.vibrate?.(wasDone ? 8 : [12, 40, 18]); } catch { /* not supported */ }
  render();

  if (wasDone) {
    toast(`Removed ${shortDate(date)}`, '', { label: 'Undo', run: () => { commit(undo); render(); } });
    return;
  }
  if (from === 'button') $('#big')?.classList.add('pop');
  $('#saved-amount')?.classList.add('bump');
  const after = view();
  const habitRow = after.habits.find((h) => h.name === habit);
  const s = habitStats(habitRow, doneDates(after.log, habit), state.today);
  const milestone = s.current && STREAK_MILESTONES.includes(s.current) && date >= addDays(state.today, -s.current);
  const msg = milestone ? `${s.current}-day streak!${s.rate > 0 ? ` ${fmtSaved(s.saved, s.unit)} saved so far` : ''}`
    : date < s.start || !(s.rate > 0) ? `Logged ${shortDate(date)}`
    : `Logged ${shortDate(date)} · +${fmtSaved(s.rate, s.unit)}`;
  toast(msg, 'good', { label: 'Undo', run: () => { commit(undo); render(); } });
}

/* ---------- events ---------- */

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;
  if (t.dataset.view) { e.preventDefault(); state.view = t.dataset.view; state.editing = false; render(); window.scrollTo(0, 0); return; }
  if (t.id === 'sync') { load({ quiet: true }); return; }
  if (t.id === 'big') { toggleDay(state.date); return; }
  if (t.dataset.quick) { toggleDay(t.dataset.quick, { from: 'quick' }); return; }
  if (t.dataset.habit) { state.habit = t.dataset.habit; store.set('habit', state.habit); state.month = null; render(); return; }
  if (t.dataset.date) {
    state.date = t.dataset.date;
    render();
    if (t.dataset.scroll) $('.log').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (t.dataset.month) {
    const [y, m] = state.month;
    const d = new Date(y, m + Number(t.dataset.month), 1);
    state.month = [d.getFullYear(), d.getMonth()];
    render();
    return;
  }
  if (t.id === 'edit-habit') { state.editing = true; render(); $('#habit-form input[name="rate"]')?.select(); return; }
  if (t.id === 'cancel-edit') { state.editing = false; render(); return; }
  if (t.id === 'disconnect') { store.set('settings', { ...settings(), apiUrl: '' }); load(); return; }
  if (t.id === 'reset-demo') { store.del('demo'); load(); toast('Demo data reset'); }
});

// Switch the "$" / "h" marker as soon as the unit is picked.
document.addEventListener('change', (e) => {
  if (e.target.name !== 'unit') return;
  e.target.form.querySelector('.money-input').classList.toggle('hours', e.target.value === 'h');
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = Object.fromEntries(new FormData(e.target));
  if (e.target.id === 'habit-form') {
    const rate = toNumber(form.rate);
    const unit = form.unit === 'h' ? 'h' : '$';
    if (rate === null || rate < 0) { toast(unit === 'h' ? 'Enter the hours saved per day, e.g. 2 or 0.5' : 'Enter the dollars saved per day, e.g. 8 or 2.50', 'bad'); return; }
    if (!isIsoDate(form.start) || form.start > state.today) { toast('Pick a start date that is not in the future', 'bad'); return; }
    const habit = view().habits.find((h) => h.name === state.habit);
    const op = { action: 'updateHabit', habit: state.habit };
    if (rate !== Number(habit.rate)) op.rate = rate;
    if (form.start !== habit.start) op.start = form.start;
    if (unit !== parseUnit(habit.unit)) op.unit = unit;
    state.editing = false;
    if (Object.keys(op).length > 2) { commit(op); toast(rate > 0 ? `Now saving ${fmtSaved(rate, unit)} a day` : 'Saved', 'good'); }
    render();
  } else if (e.target.id === 'settings-form') {
    store.set('settings', { ...settings(), apiUrl: form.apiUrl.trim(), token: form.token.trim() });
    await load();
    if (!state.error) { toast(isDemo() ? 'Settings saved' : 'Connected to your Google Sheet', 'good'); state.view = 'today'; render(); }
  }
});

// The app often stays open overnight on a phone: roll "today" over when it comes back.
function checkDay() {
  const now = toIso();
  if (now === state.today) return false;
  if (state.date === state.today) state.date = now;
  state.today = now;
  state.month = null;
  return true;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkDay();
  load({ quiet: true });
});
window.addEventListener('online', () => load({ quiet: true }));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Show the last synced data instantly, then refresh from the sheet.
setBase(isDemo() ? store.get('demo', demoData) : store.get('cache', demoData));
render();
load({ quiet: true });
