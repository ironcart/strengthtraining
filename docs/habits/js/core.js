// Pure habit logic: dates, streaks, savings. No DOM, so it is unit-tested in node.
// Dates are always local calendar days as 'YYYY-MM-DD' strings.

const DAY_MS = 864e5;
const noon = (iso) => Date.parse(`${iso}T12:00:00Z`);

export const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export function toIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso, n) {
  return new Date(noon(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  return Math.round((noon(b) - noon(a)) / DAY_MS);
}

export function toNumber(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Applies queued (not yet synced) changes on top of the sheet data, so the UI
 * shows what you tapped even before the sheet has it.
 */
export function applyOps(data, ops) {
  let log = [...(data.log || [])];
  let habits = (data.habits || []).map((h) => ({ ...h }));
  for (const op of ops || []) {
    if (op.action === 'logDay') {
      if (!log.some((r) => r.habit === op.habit && r.date === op.date)) log.push({ date: op.date, habit: op.habit, note: '' });
    } else if (op.action === 'unlogDay') {
      log = log.filter((r) => !(r.habit === op.habit && r.date === op.date));
    } else if (op.action === 'updateHabit') {
      habits = habits.map((h) => (h.name !== op.habit ? h : {
        ...h,
        ...(op.rate !== undefined ? { rate: op.rate } : {}),
        ...(op.start !== undefined ? { start: op.start } : {}),
      }));
    }
  }
  return { ...data, habits, log };
}

export function doneDates(log, habit) {
  return new Set((log || []).filter((r) => r.habit === habit && isIsoDate(r.date)).map((r) => r.date));
}

/** Streak of consecutive days ending on `end` (inclusive). */
function runEndingAt(dates, end) {
  let n = 0;
  while (dates.has(addDays(end, -n))) n++;
  return n;
}

/**
 * Same numbers as the sheet's Habits tab:
 * - completed / saved count only days on or after the start date
 * - the current streak stays alive until a full day is missed (done yesterday, not yet today)
 * - streaks use every logged day
 */
export function habitStats(habit, dates, today) {
  const sorted = [...dates].filter((d) => d <= today).sort();
  const start = isIsoDate(habit.start) ? habit.start : (sorted[0] || today);
  const rate = Number(habit.rate) || 0;
  const daysSinceStart = Math.max(0, daysBetween(start, today) + 1);
  const completed = sorted.filter((d) => d >= start).length;
  const last = sorted.at(-1) || null;
  const daysSinceLast = last ? daysBetween(last, today) : null;
  const current = last && daysSinceLast <= 1 ? runEndingAt(dates, last) : 0;

  let longest = 0;
  let run = 0;
  sorted.forEach((d, i) => {
    run = i > 0 && daysBetween(sorted[i - 1], d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });

  return {
    start, rate, daysSinceStart, completed, last, daysSinceLast, current, longest,
    doneToday: dates.has(today),
    completionRate: daysSinceStart ? completed / daysSinceStart : 0,
    saved: completed * rate,
    perMonth: rate * 30,
    perYear: rate * 365,
  };
}

/** Days since the start (within the last `window` days, before today) that were not logged. */
export function missedDays(habit, dates, today, window = 7) {
  const start = isIsoDate(habit.start) ? habit.start : null;
  const out = [];
  for (let i = window; i >= 1; i--) {
    const d = addDays(today, -i);
    if (start && d < start) continue;
    if (!dates.has(d)) out.push(d);
  }
  return out;
}

/** Calendar cells for a month, weeks starting Sunday. null = padding cell. */
export function monthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= daysIn; d++) cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 60, 90, 100, 180, 200, 365];

export function fmtMoney(v, { cents = true } = {}) {
  const n = Number(v) || 0;
  const whole = !cents || (Number.isInteger(n) && Math.abs(n) >= 1000);
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}
