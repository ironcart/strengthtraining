import {
  normaliseLog, historyByKey, entryKey, recommend, setGrade, describeDay, nextWeekForDay,
  suggestNextDay, weeklyVolume, personalBests, rollingAverage, fmtWeight, parseTarget, MAX_SETS, toNumber,
} from './core.js';
import { lineChart, barChart, sparkline, responsive } from './charts.js';
import demoData from './demo-data.js';

/* ---------- storage ---------- */

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep going in memory */ }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const DEFAULT_SETTINGS = { apiUrl: '', token: '', upperIncrement: 5, lowerIncrement: 5 };
const settings = () => ({ ...DEFAULT_SETTINGS, ...store.get('settings', {}) });
const isDemo = () => !settings().apiUrl;

/* ---------- API ---------- */

async function apiGet() {
  const { apiUrl, token } = settings();
  const res = await fetch(`${apiUrl}?action=data&token=${encodeURIComponent(token)}`, { redirect: 'follow' });
  const json = await res.json();
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
  const json = await res.json();
  if (!json.ok) throw Object.assign(new Error(json.error || 'Request failed'), { fatal: true });
  return json.data;
}

/** In demo mode, saves live in localStorage on top of the bundled snapshot. */
function demoSnapshot() {
  const extra = store.get('demoLog', []);
  const bw = store.get('demoBodyweight', []);
  return { ...demoData, log: [...demoData.log, ...extra], bodyweight: [...demoData.bodyweight, ...bw] };
}

function demoWrite(payload) {
  if (payload.action === 'logSession') {
    const extra = store.get('demoLog', []);
    payload.entries.forEach((e, i) => extra.push({
      row: 10000 + extra.length, week: payload.week, date: i === 0 ? payload.date : '', day: payload.day,
      exercise: e.exercise, target: e.target, weight: e.weight, sets: e.sets, notes: e.notes || '',
    }));
    store.set('demoLog', extra);
  } else if (payload.action === 'logBodyweight') {
    const bw = store.get('demoBodyweight', []);
    bw.push({ date: payload.date, weight: Number(payload.weight), notes: payload.notes || '' });
    store.set('demoBodyweight', bw);
  }
}

async function send(payload) {
  if (isDemo()) { demoWrite(payload); return 'saved'; }
  try {
    await apiPost(payload);
    return 'saved';
  } catch (err) {
    if (err.fatal) throw err;
    const q = store.get('pending', []);
    q.push(payload);
    store.set('pending', q);
    return 'queued';
  }
}

async function flushPending() {
  if (isDemo()) return 0;
  const q = store.get('pending', []);
  let sent = 0;
  while (q.length) {
    try { await apiPost(q[0]); } catch (err) { if (!err.fatal) break; toast(`Couldn't sync a saved session: ${err.message}`, 'bad'); }
    q.shift(); sent++;
    store.set('pending', q);
  }
  return sent;
}

/* ---------- state ---------- */

const state = {
  data: null, entries: [], history: new Map(), days: [], programByDay: new Map(),
  view: store.get('view', 'train'), day: null, progressKey: null, loading: false, error: null,
};

function ingest(data) {
  state.data = data;
  state.entries = normaliseLog(data.log || []);
  state.history = historyByKey(state.entries);
  state.programByDay = new Map();
  for (const p of data.program || []) {
    if (!state.programByDay.has(p.day)) state.programByDay.set(p.day, []);
    state.programByDay.get(p.day).push({ ...p, t: parseTarget(p.target) });
  }
  state.days = [...state.programByDay.keys()].sort((a, b) => describeDay(a).num - describeDay(b).num);
  if (!state.day || !state.days.includes(state.day)) state.day = store.get('draftDay', null) || suggestNextDay(state.entries, state.days);
  if (!state.days.includes(state.day)) state.day = state.days[0];
}

async function load({ quiet = false } = {}) {
  state.loading = true; state.error = null;
  if (!quiet) render();
  try {
    if (isDemo()) {
      ingest(demoSnapshot());
    } else {
      const flushed = await flushPending();
      const data = await apiGet();
      store.set('cache', data);
      ingest(data);
      if (flushed) toast(`Synced ${flushed} saved session${flushed > 1 ? 's' : ''} to your sheet`, 'good');
    }
  } catch (err) {
    const cached = store.get('cache', null);
    if (cached) { ingest(cached); state.error = `Offline — showing your last synced data (${err.message})`; }
    else { ingest(demoSnapshot()); state.error = `Couldn't reach your sheet: ${err.message}`; }
  }
  state.loading = false;
  render();
}

/* ---------- helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const niceDate = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, opts) : 'No date');
const daysAgo = (iso) => {
  if (!iso) return '';
  const n = Math.round((Date.parse(today() + 'T12:00:00') - Date.parse(iso + 'T12:00:00')) / 864e5);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
};
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const fmtK = (v) => (v >= 10000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : Math.round(v).toLocaleString());
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const DAY_COLORS = ['--series-1', '--series-2', '--series-3', '--series-4'];
const dayColor = (day) => css(DAY_COLORS[(describeDay(day).num - 1 + 4) % 4]);

const ICONS = {
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  hold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  timer: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  train: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6M6 6.5v11M18 6.5v11M21 9v6M6 12h12"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M6 15l4-5 4 3 5-7"/></svg>',
  body: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 10.5a3 3 0 0 1 6 0M12 10.5v-1"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  sync: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 13a8 8 0 0 0 14.3 4.9L20 16M4 4v4h4M20 20v-4h-4"/></svg>',
};

const STATUS = {
  increase: { cls: 'good', icon: ICONS.up, word: 'Add weight' },
  build: { cls: 'info', icon: ICONS.plus, word: 'Add reps' },
  hold: { cls: 'warn', icon: ICONS.hold, word: 'Hold' },
  new: { cls: 'muted', icon: ICONS.star, word: 'New' },
};

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3600);
}

/* ---------- drafts (survive reloads / screen locks mid-workout) ---------- */

const draftKey = (day) => `draft:${day}`;
const getDraft = (day) => store.get(draftKey(day), { date: today(), values: {} });
const saveDraft = (day, draft) => store.set(draftKey(day), draft);

function recFor(day, exercise, t) {
  const list = state.history.get(entryKey(day, exercise)) || [];
  const last = list.at(-1) || null;
  const s = settings();
  return { last, list, rec: recommend(last, t, { isLower: describeDay(day).isLower, upperIncrement: +s.upperIncrement, lowerIncrement: +s.lowerIncrement }) };
}

/* ---------- views ---------- */

function render() {
  document.body.dataset.view = state.view;
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === state.view ? 'page' : 'false'));
  const banner = $('#banner');
  banner.hidden = !(state.error || isDemo());
  banner.className = `banner ${state.error ? 'warn' : 'info'}`;
  banner.innerHTML = state.error ? esc(state.error)
    : 'Demo mode — showing a snapshot of your sheet. Connect your Google Sheet in <a href="#" data-goto="settings">Settings</a> to save for real.';
  const pending = store.get('pending', []).length;
  $('#sync').classList.toggle('busy', state.loading);
  $('#sync').title = pending ? `${pending} session(s) waiting to sync` : 'Refresh from sheet';
  $('#sync-count').textContent = pending || '';
  if (!state.data) { $('#main').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>'; return; }
  const views = { train: renderTrain, progress: renderProgress, body: renderBody, settings: renderSettings };
  views[state.view]();
}

/* ----- Train ----- */

function renderTrain() {
  const day = state.day;
  const program = state.programByDay.get(day) || [];
  const draft = getDraft(day);
  const week = nextWeekForDay(state.entries, day);
  const next = suggestNextDay(state.entries, state.days);
  const info = describeDay(day);
  const recs = program.map((p) => ({ p, ...recFor(day, p.exercise, p.t) }));
  const counts = recs.reduce((a, r) => ((a[r.rec.status] = (a[r.rec.status] || 0) + 1), a), {});
  const lastSession = recs.map((r) => r.last?.date).filter(Boolean).sort().at(-1);

  $('#main').innerHTML = `
    <section class="days" role="tablist" aria-label="Workout day">
      ${state.days.map((d) => {
        const di = describeDay(d);
        const lastDate = state.entries.filter((e) => e.day === d && e.date).map((e) => e.date).sort().at(-1);
        return `<button role="tab" class="day-chip" aria-selected="${d === day}" data-day="${esc(d)}" style="--day:var(${DAY_COLORS[(di.num - 1) % 4]})">
          <span class="day-num">Day ${di.num}</span>
          <span class="day-name">${esc(di.region)}</span>
          <span class="day-focus">${esc(di.focus)}</span>
          ${d === next ? '<span class="day-next">Up next</span>' : `<span class="day-last">${lastDate ? niceDate(lastDate, { month: 'short', day: 'numeric' }) : '—'}</span>`}
        </button>`;
      }).join('')}
    </section>

    <section class="session-head">
      <div>
        <p class="eyebrow">Week ${week} · Day ${info.num}</p>
        <h1>${esc(info.region)} <span>${esc(info.focus)}</span></h1>
        <p class="sub">${lastSession ? `Last done ${niceDate(lastSession)} · ${daysAgo(lastSession)}` : 'First time on this day'}</p>
      </div>
      <label class="date-field"><span>Date</span><input type="date" id="session-date" value="${esc(draft.date || today())}"></label>
    </section>

    <section class="plan-summary" aria-label="Today's plan">
      ${['increase', 'build', 'hold', 'new'].filter((k) => counts[k]).map((k) => `
        <div class="plan-pill ${STATUS[k].cls}">${STATUS[k].icon}<b>${counts[k]}</b> ${STATUS[k].word.toLowerCase()}</div>`).join('')}
    </section>

    <section class="exercises">
      ${recs.map((r, i) => exerciseCard(r, i, draft)).join('')}
    </section>

    <div class="save-bar">
      <div class="save-progress"><div class="bar"><i style="width:0%"></i></div><span id="save-count"></span></div>
      <button class="btn primary" id="save-session">${ICONS.check}<span>Save workout</span></button>
    </div>`;
  updateProgress();
}

function exerciseCard({ p, last, list, rec }, i, draft) {
  const t = p.t;
  const v = draft.values[p.exercise] || {};
  const nSets = Math.max(t.sets, v.sets ? v.sets.length : 0);
  const weight = v.weight ?? (rec.weight ?? '');
  const st = STATUS[rec.status];
  const unit = t.unit === 'sec' ? 'sec' : 'reps';
  const trend = list.filter((e) => e.weight).map((e) => e.weight);
  const bodyweight = last ? !last.weight : /bodyweight/i.test(p.notes || '');
  const filled = (v.sets || []).filter((x) => x !== '' && x != null).length;

  return `
  <article class="ex ${filled >= t.sets ? 'done' : ''}" data-ex="${esc(p.exercise)}" data-target="${esc(p.target)}" style="--i:${i}">
    <header class="ex-head">
      <span class="ex-idx">${filled >= t.sets ? ICONS.check : i + 1}</span>
      <div class="ex-title">
        <h2>${esc(p.exercise)}</h2>
        <p>${t.sets} × ${t.min === t.max ? t.min : `${t.min}–${t.max}`} ${unit}${t.perSide ? ' / side' : ''}
          ${p.rest ? `<button class="rest-btn" data-rest="${esc(p.rest)}">${ICONS.timer}${esc(p.rest)}</button>` : ''}</p>
      </div>
      ${trend.length > 1 ? `<div class="ex-spark" title="Weight trend">${sparkline(trend)}</div>` : ''}
    </header>

    ${last ? `
    <div class="last">
      <div class="last-meta"><span>Last · ${niceDate(last.date, { month: 'short', day: 'numeric' })}</span><b>${fmtWeight(last.weight)}</b></div>
      <ol class="chips" aria-label="Last session ${unit}">
        ${Array.from({ length: Math.max(t.sets, last.sets.length) }, (_, k) => {
          const val = last.sets[k] ?? null;
          const g = k < t.sets || val !== null ? setGrade(val, t) : 'empty';
          return `<li class="chip ${g}" title="Set ${k + 1}: ${val ?? '—'}">${val ?? '–'}</li>`;
        }).join('')}
      </ol>
    </div>` : ''}

    <div class="rec ${st.cls}">
      <span class="rec-icon">${st.icon}</span>
      <div><strong>${esc(rec.title)}</strong><span>${esc(rec.detail)}</span></div>
    </div>

    <div class="inputs">
      <div class="weight-field ${bodyweight ? 'bw' : ''}">
        <span class="label">Weight <small>lb${/one dumbbell|per hand/i.test(p.notes || '') ? ' · one DB' : ''}</small></span>
        <div class="stepper">
          <button type="button" data-wstep="-2.5" aria-label="Decrease weight">−</button>
          <input type="text" inputmode="decimal" class="w-input" value="${esc(weight)}" placeholder="${bodyweight ? 'BW' : '0'}" aria-label="Weight for ${esc(p.exercise)}">
          <button type="button" data-wstep="2.5" aria-label="Increase weight">+</button>
        </div>
      </div>
      <div class="sets" style="--n:${nSets}">
        ${Array.from({ length: nSets }, (_, k) => {
          const val = v.sets?.[k] ?? '';
          const g = val === '' ? '' : setGrade(toNumber(val), t);
          return `<label class="set ${g}">
            <span>Set ${k + 1}</span>
            <input type="text" inputmode="numeric" pattern="[0-9]*" class="s-input" data-set="${k}" value="${esc(val)}" placeholder="${rec.aims[k] ?? ''}" aria-label="Set ${k + 1} ${unit}">
          </label>`;
        }).join('')}
      </div>
      <div class="ex-actions">
        <button type="button" class="link fill-aims">Fill targets</button>
        ${nSets < MAX_SETS ? '<button type="button" class="link add-set">+ Add set</button>' : ''}
        <input type="text" class="note-input" placeholder="Note" value="${esc(v.notes || '')}" aria-label="Note">
      </div>
    </div>

    ${list.length ? `
    <details class="history">
      <summary>History <span>${list.length} session${list.length > 1 ? 's' : ''}</span></summary>
      <table>
        <thead><tr><th>Date</th><th>Weight</th><th>Sets</th></tr></thead>
        <tbody>${list.slice(-6).reverse().map((e) => `
          <tr><td>${niceDate(e.date, { month: 'short', day: 'numeric' })}</td><td>${fmtWeight(e.weight)}</td>
          <td class="sets-cell">${e.sets.map((x) => `<span class="${setGrade(x, t)}">${x ?? '–'}</span>`).join('')}</td></tr>`).join('')}
        </tbody>
      </table>
    </details>` : ''}
  </article>`;
}

function readCard(card) {
  const sets = [...card.querySelectorAll('.s-input')].map((i) => i.value.trim());
  return { weight: card.querySelector('.w-input').value.trim(), sets, notes: card.querySelector('.note-input').value.trim() };
}

function persistCard(card) {
  const draft = getDraft(state.day);
  draft.values[card.dataset.ex] = readCard(card);
  saveDraft(state.day, draft);
  store.set('draftDay', state.day);
}

function gradeCard(card) {
  const t = parseTarget(card.dataset.target);
  let filled = 0;
  card.querySelectorAll('.set').forEach((label) => {
    const val = label.querySelector('input').value.trim();
    label.classList.remove('top', 'in', 'below');
    if (val !== '') { label.classList.add(setGrade(toNumber(val), t)); filled++; }
  });
  const done = filled >= t.sets;
  card.classList.toggle('done', done);
  const idx = card.querySelector('.ex-idx');
  const n = [...card.parentNode.children].indexOf(card) + 1;
  idx.innerHTML = done ? ICONS.check : n;
  updateProgress();
}

function updateProgress() {
  const cards = [...document.querySelectorAll('.ex')];
  if (!cards.length) return;
  const done = cards.filter((c) => c.classList.contains('done')).length;
  const started = cards.filter((c) => readCard(c).sets.some((s) => s !== '')).length;
  $('.save-progress i').style.width = `${(done / cards.length) * 100}%`;
  $('#save-count').textContent = `${done}/${cards.length} done`;
  $('#save-session').disabled = started === 0;
}

async function saveSession() {
  const day = state.day;
  const date = $('#session-date').value || today();
  const entries = [...document.querySelectorAll('.ex')].map((card) => {
    const v = readCard(card);
    const sets = v.sets.map(toNumber);
    while (sets.length && sets.at(-1) === null) sets.pop();
    return { exercise: card.dataset.ex, target: card.dataset.target, weight: toNumber(v.weight), sets, notes: v.notes };
  }).filter((e) => e.sets.some((x) => x !== null));
  if (!entries.length) return;

  const skipped = (state.programByDay.get(day) || []).length - entries.length;
  const week = nextWeekForDay(state.entries, day);
  const ok = await confirmDialog(`Save ${entries.length} exercise${entries.length > 1 ? 's' : ''} to Week ${week}, Day ${describeDay(day).num}?`,
    `${niceDate(date)}${skipped > 0 ? ` · ${skipped} exercise${skipped > 1 ? 's' : ''} without reps will be skipped` : ''}`);
  if (!ok) return;

  const btn = $('#save-session');
  btn.disabled = true; btn.classList.add('busy');
  btn.querySelector('span').textContent = 'Saving…';
  try {
    const result = await send({ action: 'logSession', day, week, date, entries: entries.map((e) => ({ ...e, sets: e.sets.map((x) => x ?? '') })) });
    store.del(draftKey(day));
    store.del('draftDay');
    toast(result === 'queued' ? 'No connection — saved on this phone, will sync later' : isDemo() ? 'Saved (demo mode)' : 'Saved to your Google Sheet', result === 'queued' ? 'warn' : 'good');
    if (result === 'queued') {
      // Reflect queued work locally so the next session's recommendations are right.
      state.data.log.push(...entries.map((e, i) => ({ row: 1e6 + i, week, date: i ? '' : date, day, exercise: e.exercise, target: e.target, weight: e.weight, sets: e.sets, notes: e.notes })));
      ingest(state.data);
    }
    state.day = suggestNextDay(state.entries, state.days);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (result === 'queued') render(); else await load({ quiet: true });
  } catch (err) {
    toast(`Not saved: ${err.message}`, 'bad');
    btn.disabled = false; btn.classList.remove('busy');
    btn.querySelector('span').textContent = 'Save workout';
  }
}

function confirmDialog(title, body) {
  return new Promise((resolve) => {
    const dlg = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

/* ----- Rest timer ----- */

const timer = { end: 0, id: null, total: 0 };
function parseRest(text) {
  const m = String(text).match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(min|sec|s)?/i);
  if (!m) return 90;
  const n = Number(m[1]);
  return /min/i.test(m[3] || '') ? n * 60 : n;
}
function startTimer(seconds) {
  timer.total = seconds;
  timer.end = Date.now() + seconds * 1000;
  clearInterval(timer.id);
  $('#timer').hidden = false;
  tick();
  timer.id = setInterval(tick, 250);
}
function tick() {
  const left = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
  $('#timer-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('#timer').style.setProperty('--p', `${(1 - left / timer.total) * 100}%`);
  if (left === 0) {
    clearInterval(timer.id);
    $('#timer').classList.add('ring');
    navigator.vibrate?.([200, 100, 200, 100, 400]);
    beep();
    setTimeout(stopTimer, 4000);
  }
}
function stopTimer() { clearInterval(timer.id); $('#timer').hidden = true; $('#timer').classList.remove('ring'); }
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.2, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* audio not available */ }
}

/* ----- Progress ----- */

function renderProgress() {
  const keys = [];
  for (const d of state.days) for (const p of state.programByDay.get(d)) if (state.history.has(entryKey(d, p.exercise))) keys.push({ day: d, p });
  if (!state.progressKey || !state.history.has(state.progressKey)) state.progressKey = keys[0] ? entryKey(keys[0].day, keys[0].p.exercise) : null;
  const vol = weeklyVolume(state.entries, state.days);
  const pbs = personalBests(state.history);
  const sessionsCount = new Set(state.entries.map((e) => `${e.week}|${e.day}`)).size;
  const lastWeek = vol.at(-1), prevWeek = vol.at(-2);
  // A week still in progress would always look like a drop, so only compare finished weeks.
  const weekDone = lastWeek && state.days.every((d) => lastWeek.byDay[d] > 0 || !state.entries.some((e) => e.day === d && e.volume));
  const delta = weekDone && prevWeek && prevWeek.total ? ((lastWeek.total - prevWeek.total) / prevWeek.total) * 100 : null;
  const increases = state.entries.filter((e, i, arr) => {
    const prev = [...arr.slice(0, i)].reverse().find((q) => q.day === e.day && q.exercise === e.exercise);
    return prev && e.weight && prev.weight && e.weight > prev.weight;
  }).length;

  $('#main').innerHTML = `
    <section class="page-head"><p class="eyebrow">Progress</p><h1>Getting stronger</h1></section>
    <section class="tiles">
      <div class="tile"><span>Workouts</span><b>${sessionsCount}</b><small>${vol.length} week${vol.length === 1 ? '' : 's'} logged</small></div>
      <div class="tile"><span>Weight increases</span><b>${increases}</b><small>double progression wins</small></div>
      <div class="tile"><span>Week ${lastWeek?.week ?? '–'} volume</span><b>${lastWeek ? fmtK(lastWeek.total) : '–'}</b>
        <small>${!weekDone && lastWeek ? `so far · ${state.days.filter((d) => lastWeek.byDay[d] > 0).length}/${state.days.length} days` : delta === null ? 'lb × reps' : `<em class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}%</em> vs week ${prevWeek.week}`}</small></div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Exercise</h2>
        <select id="progress-ex" aria-label="Exercise">
          ${state.days.map((d) => `<optgroup label="Day ${describeDay(d).num} · ${esc(describeDay(d).short)}">
            ${keys.filter((k) => k.day === d).map((k) => `<option value="${esc(entryKey(d, k.p.exercise))}" ${entryKey(d, k.p.exercise) === state.progressKey ? 'selected' : ''}>${esc(k.p.exercise)}</option>`).join('')}
          </optgroup>`).join('')}
        </select>
      </div>
      <div id="ex-detail"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Weekly volume</h2><span class="hint">lb × reps, by day</span></div>
      <div class="legend">${state.days.map((d) => `<span><i style="background:${dayColor(d)}"></i>Day ${describeDay(d).num} ${esc(describeDay(d).region)}</span>`).join('')}</div>
      <div id="chart-volume"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Personal bests</h2></div>
      <table class="pb-table">
        <thead><tr><th>Exercise</th><th>Top weight</th><th>Est. 1RM</th></tr></thead>
        <tbody>${keys.map((k) => {
          const pb = pbs.get(entryKey(k.day, k.p.exercise));
          return `<tr data-key="${esc(entryKey(k.day, k.p.exercise))}"><td>${esc(k.p.exercise)}<small>Day ${describeDay(k.day).num}</small></td>
            <td>${pb.weight ? fmtWeight(pb.weight) : `${pb.reps} ${k.p.t.unit}`}</td><td>${pb.e1rm ? fmtWeight(Math.round(pb.e1rm)) : '–'}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </section>`;

  renderExerciseDetail();
  const volEl = $('#chart-volume');
  responsive(volEl, () => barChart(volEl, {
    bars: vol.map((w) => ({ label: `W${w.week}`, segments: state.days.map((d) => ({ name: `Day ${describeDay(d).num}`, value: w.byDay[d] || 0, color: dayColor(d) })) })),
    fmt: fmtK,
    tooltip: (b, total) => `<b>${b.label.replace('W', 'Week ')}</b>${b.segments.map((s) => `<div><i style="background:${s.color}"></i>${s.name} <b>${s.value ? fmtK(s.value) : '–'}</b></div>`).join('')}<div class="tip-total">Total <b>${fmtK(total)}</b></div>`,
  }));
}

function renderExerciseDetail() {
  const box = $('#ex-detail');
  const list = state.history.get(state.progressKey) || [];
  if (!list.length) { box.innerHTML = '<p class="empty">Log a workout to see progress here.</p>'; return; }
  const [day, exercise] = state.progressKey.split('||');
  const p = (state.programByDay.get(day) || []).find((q) => q.exercise === exercise);
  const t = p ? p.t : list.at(-1).target;
  const weighted = list.some((e) => e.weight);
  const first = list[0], last = list.at(-1);
  const { rec } = recFor(day, exercise, t);
  const gain = weighted && first.weight ? last.weight - first.weight : null;
  const unit = t.unit === 'sec' ? 'sec' : 'reps';

  box.innerHTML = `
    <div class="ex-stats">
      <div><span>Current</span><b>${fmtWeight(last.weight)}</b></div>
      <div><span>Since start</span><b>${gain === null ? '–' : `${gain >= 0 ? '+' : ''}${num(gain)} lb`}</b></div>
      <div><span>Next time</span><b class="status-${STATUS[rec.status].cls}">${STATUS[rec.status].icon}${esc(STATUS[rec.status].word)}</b></div>
    </div>
    ${weighted ? `
      <h3>Weight & estimated 1-rep max</h3>
      <div class="legend"><span><i style="background:var(--series-1)"></i>Working weight</span><span><i class="ring" style="border-color:var(--series-2)"></i>Est. 1RM</span></div>
      <div id="chart-weight"></div>` : ''}
    <h3>Total ${unit} per workout</h3>
    <p class="hint">Reach the dashed line (${t.sets} × ${t.max}) on every set and it's time to add weight.</p>
    <div id="chart-reps"></div>
    <details class="history"><summary>All sessions <span>${list.length}</span></summary>
      <table><thead><tr><th>Date</th><th>Weight</th><th>Sets</th><th>Volume</th></tr></thead>
      <tbody>${[...list].reverse().map((e) => `<tr><td>${niceDate(e.date, { month: 'short', day: 'numeric' })}</td><td>${fmtWeight(e.weight)}</td>
        <td class="sets-cell">${e.sets.map((x) => `<span class="${setGrade(x, t)}">${x ?? '–'}</span>`).join('')}</td><td>${e.volume ? fmtK(e.volume) : '–'}</td></tr>`).join('')}</tbody></table>
    </details>`;

  const withDate = list.filter((e) => e.date);
  if (weighted) {
    const wEl = $('#chart-weight');
    responsive(wEl, () => lineChart(wEl, {
      series: [
        { name: 'Weight', color: css('--series-1'), points: withDate.filter((e) => e.weight).map((e) => ({ date: e.date, y: e.weight, meta: e })) },
        { name: 'Est. 1RM', color: css('--series-2'), dashed: true, points: withDate.filter((e) => e.e1rm).map((e) => ({ date: e.date, y: Math.round(e.e1rm) })) },
      ],
      fmt: (v) => `${num(v)}`,
      tooltip: (date, rows) => {
        const e = rows[0]?.p.meta;
        return `<b>${niceDate(date)}</b>${rows.map(({ s, p }) => `<div><i style="background:${s.color}"></i>${s.name} <b>${num(p.y)} lb</b></div>`).join('')}${e ? `<div class="tip-sets">${e.sets.map((x) => x ?? '–').join(' · ')} ${unit}</div>` : ''}`;
      },
    }));
  }
  const rEl = $('#chart-reps');
  responsive(rEl, () => barChart(rEl, {
    bars: list.map((e) => {
      const top = e.sets.slice(0, t.sets).filter((x) => x !== null).length >= t.sets && e.sets.slice(0, t.sets).every((x) => x >= t.max);
      return { label: niceDate(e.date, { month: 'short', day: 'numeric' }), meta: e, segments: [{ name: unit, value: e.sets.slice(0, t.sets).reduce((a, x) => a + (x || 0), 0), color: top ? css('--good') : css('--series-1') }] };
    }),
    threshold: t.max ? { value: t.sets * t.max, label: `${t.sets * t.max} = add weight` } : null,
    tooltip: (b, total) => `<b>${b.label}</b><div>${fmtWeight(b.meta.weight)} · ${b.meta.sets.map((x) => x ?? '–').join(' · ')}</div><div class="tip-total">Total <b>${total} ${unit}</b></div>`,
  }));
}

/* ----- Bodyweight ----- */

function renderBody() {
  const points = (state.data.bodyweight || []).map((b) => ({ date: String(b.date).slice(0, 10), weight: Number(b.weight), notes: b.notes }))
    .filter((b) => b.date && isFinite(b.weight)).sort((a, b) => a.date.localeCompare(b.date));
  const avg = rollingAverage(points);
  const latest = points.at(-1);
  const weekAgo = avg.filter((a) => Date.parse(a.date) <= Date.parse(today()) - 7 * 864e5).at(-1);
  const change = avg.length && weekAgo ? avg.at(-1).value - weekAgo.value : null;

  $('#main').innerHTML = `
    <section class="page-head"><p class="eyebrow">Bodyweight</p><h1>Recomp check</h1>
      <p class="sub">Keep the weekly average within ±2 lb while your lifts go up.</p></section>
    <form class="card bw-form" id="bw-form">
      <label><span>Date</span><input type="date" name="date" value="${today()}" required></label>
      <label><span>Weight (lb)</span><input type="text" inputmode="decimal" name="weight" required placeholder="${latest ? latest.weight : '180'}"></label>
      <button class="btn primary" type="submit">Log</button>
    </form>
    <section class="tiles">
      <div class="tile"><span>Latest</span><b>${latest ? `${num(latest.weight)}` : '–'}</b><small>${latest ? niceDate(latest.date) : 'no entries yet'}</small></div>
      <div class="tile"><span>7-day average</span><b>${avg.length ? avg.at(-1).value.toFixed(1) : '–'}</b><small>lb</small></div>
      <div class="tile"><span>vs last week</span><b>${change === null ? '–' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}`}</b>
        <small>${change === null ? 'need a week of data' : Math.abs(change) <= 2 ? '<em class="up">within ±2 lb ✓</em>' : '<em class="down">outside ±2 lb</em>'}</small></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Trend</h2></div>
      <div class="legend"><span><i style="background:var(--series-3)"></i>7-day average</span><span><i class="ring" style="border-color:var(--series-3)"></i>Weigh-in</span></div>
      <div id="chart-bw"></div>
    </section>`;

  const el = $('#chart-bw');
  if (points.length) {
    responsive(el, () => lineChart(el, {
      series: [
        { name: 'Weigh-in', color: css('--series-3'), dashed: true, points: points.map((p) => ({ date: p.date, y: p.weight })) },
        { name: '7-day avg', color: css('--series-3'), points: avg.map((a) => ({ date: a.date, y: +a.value.toFixed(1) })) },
      ],
      fmt: (v) => num(v),
    }));
  } else el.innerHTML = '<p class="empty">Log a few weigh-ins to see your trend.</p>';
}

/* ----- Settings ----- */

function renderSettings() {
  const s = settings();
  const pending = store.get('pending', []).length;
  $('#main').innerHTML = `
    <section class="page-head"><p class="eyebrow">Settings</p><h1>Connect your sheet</h1>
      <p class="sub">Paste the Web app URL and token from the Apps Script setup (see the README).</p></section>
    <form class="card settings" id="settings-form">
      <label><span>Apps Script Web app URL</span><input type="url" name="apiUrl" value="${esc(s.apiUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label><span>App token</span><input type="password" name="token" value="${esc(s.token)}" autocomplete="off"></label>
      <div class="two">
        <label><span>Upper body increase (lb)</span><input type="text" inputmode="decimal" name="upperIncrement" value="${esc(s.upperIncrement)}"></label>
        <label><span>Lower body increase (lb)</span><input type="text" inputmode="decimal" name="lowerIncrement" value="${esc(s.lowerIncrement)}"></label>
      </div>
      <p class="hint">Your sheet suggests 2.5–5 lb for upper body and 5–10 lb for lower body.</p>
      <div class="row"><button class="btn primary" type="submit">Save & connect</button>
      ${s.apiUrl ? '<button class="btn ghost" type="button" id="disconnect">Use demo mode</button>' : ''}</div>
    </form>
    <section class="card">
      <div class="card-head"><h2>Status</h2></div>
      <ul class="status-list">
        <li><span>Mode</span><b>${isDemo() ? 'Demo (saved on this phone only)' : 'Connected to Google Sheet'}</b></li>
        <li><span>Waiting to sync</span><b>${pending}</b></li>
        <li><span>Logged exercises</span><b>${state.entries.length}</b></li>
      </ul>
      ${isDemo() && (store.get('demoLog', []).length || store.get('demoBodyweight', []).length) ? '<button class="btn ghost" id="reset-demo">Clear demo entries</button>' : ''}
    </section>`;
}

/* ---------- events ---------- */

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a, tr[data-key]');
  if (!t) return;
  if (t.dataset.view) { state.view = t.dataset.view; store.set('view', state.view); render(); window.scrollTo(0, 0); return; }
  if (t.dataset.goto) { e.preventDefault(); state.view = t.dataset.goto; render(); return; }
  if (t.dataset.day) { state.day = t.dataset.day; render(); return; }
  if (t.id === 'sync') { load({ quiet: true }); return; }
  if (t.id === 'save-session') { saveSession(); return; }
  if (t.id === 'timer-stop') { stopTimer(); return; }
  if (t.id === 'timer-add') { timer.end += 30000; timer.total += 30; return; }
  if (t.dataset.rest) { startTimer(parseRest(t.dataset.rest)); return; }
  if (t.dataset.key) { state.progressKey = t.dataset.key; renderProgress(); $('#progress-ex').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  if (t.id === 'disconnect') { store.set('settings', { ...settings(), apiUrl: '' }); load(); return; }
  if (t.id === 'reset-demo') { store.del('demoLog'); store.del('demoBodyweight'); load(); return; }

  const card = t.closest('.ex');
  if (!card) return;
  if (t.dataset.wstep) {
    const input = card.querySelector('.w-input');
    const v = toNumber(input.value) ?? 0;
    input.value = num(Math.max(0, v + Number(t.dataset.wstep)));
    persistCard(card);
  } else if (t.classList.contains('fill-aims')) {
    card.querySelectorAll('.s-input').forEach((i) => { if (!i.value) i.value = i.placeholder; });
    persistCard(card); gradeCard(card);
  } else if (t.classList.contains('add-set')) {
    persistCard(card);
    const draft = getDraft(state.day);
    draft.values[card.dataset.ex].sets.push('');
    saveDraft(state.day, draft);
    renderTrain();
  }
});

document.addEventListener('input', (e) => {
  const card = e.target.closest('.ex');
  if (card) { persistCard(card); if (e.target.classList.contains('s-input')) gradeCard(card); return; }
  if (e.target.id === 'session-date') { const d = getDraft(state.day); d.date = e.target.value; saveDraft(state.day, d); }
});

// Jump to the next set input after typing a rep count, so you can log with one thumb.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('.s-input, .w-input')) return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll('.w-input, .s-input')];
  const next = inputs[inputs.indexOf(e.target) + 1];
  if (next) next.focus(); else e.target.blur();
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'progress-ex') { state.progressKey = e.target.value; renderExerciseDetail(); }
});

document.addEventListener('submit', async (e) => {
  // The confirm dialog's <form method="dialog"> must submit normally so it closes.
  if (e.target.id !== 'settings-form' && e.target.id !== 'bw-form') return;
  e.preventDefault();
  const form = Object.fromEntries(new FormData(e.target));
  if (e.target.id === 'settings-form') {
    store.set('settings', { ...settings(), ...form, apiUrl: form.apiUrl.trim(), token: form.token.trim() });
    await load();
    if (!state.error) toast(isDemo() ? 'Settings saved' : 'Connected to your Google Sheet', 'good');
  } else if (e.target.id === 'bw-form') {
    const weight = toNumber(form.weight);
    if (!weight) return;
    try {
      const r = await send({ action: 'logBodyweight', date: form.date, weight });
      toast(r === 'queued' ? 'Saved on this phone, will sync later' : 'Bodyweight logged', r === 'queued' ? 'warn' : 'good');
      if (r === 'queued') { state.data.bodyweight.push({ date: form.date, weight }); render(); } else await load({ quiet: true });
    } catch (err) { toast(`Not saved: ${err.message}`, 'bad'); }
  }
});

window.addEventListener('online', () => load({ quiet: true }));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

load();
