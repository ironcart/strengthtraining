// Pure training logic: parsing the sheet, grouping sessions and the
// double-progression rule. No DOM access here so it can be unit-tested in Node.

export const MAX_SETS = 4; // the Log tab has four set columns (G:J)

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const monthOf = (name) => MONTHS[name.toLowerCase()] ?? MONTHS[name.toLowerCase().slice(0, 3)];
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** "4 x 5-8", "3 x 10 / leg", "3 x 30-45 sec" -> structured target. */
export function parseTarget(text) {
  const s = String(text || '').toLowerCase();
  const m = s.match(/(\d+)\s*[x×]\s*(\d+)(?:\s*[-–]\s*(\d+))?/);
  if (!m) return { sets: 3, min: null, max: null, unit: 'reps', perSide: false, label: String(text || '') };
  const min = Number(m[2]);
  const max = m[3] ? Number(m[3]) : min;
  return {
    sets: Number(m[1]),
    min,
    max,
    unit: /sec|s\b/.test(s.slice(m.index + m[0].length)) ? 'sec' : 'reps',
    perSide: /\/\s*(leg|side|arm)/.test(s),
    label: String(text),
  };
}

/** Accepts ISO dates, "30 Sept 2026", "10/3/2026" (US M/D/Y), Date objects and sheet serials. */
export function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value)) {
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && value > 30000 && value < 80000) {
    // Google Sheets serial date (days since 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, +m[1], +m[2]);
  }
  m = s.match(/^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i);
  if (m && monthOf(m[2])) return iso(+m[3], monthOf(m[2]), +m[1]);
  m = s.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m && monthOf(m[1])) return iso(+m[3], monthOf(m[1]), +m[2]);
  return null;
}

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return isFinite(n) ? n : null;
}

/** Day labels in the sheet look like "Day 2 - Lower (strength)". */
export function describeDay(day) {
  const m = String(day).match(/Day\s*(\d+)\s*[-–]\s*(\w+)\s*(?:\(([^)]+)\))?/i);
  if (!m) return { num: 0, region: String(day), focus: '', short: String(day) };
  return {
    num: Number(m[1]),
    region: m[2],
    focus: m[3] || '',
    short: `${m[2]}${m[3] ? ' · ' + m[3] : ''}`,
    isLower: /lower/i.test(m[2]),
  };
}

export const entryKey = (day, exercise) => `${day}||${exercise}`;

/**
 * Normalises raw Log rows into entries. A row counts as logged when at least
 * one set has a number. The date is written only on the first row of a day in
 * the sheet, so every row of a (week, day) block inherits the block's date.
 */
export function normaliseLog(rows) {
  const blockDates = new Map();
  for (const r of rows) {
    const d = parseDate(r.date);
    const k = `${r.week}||${r.day}`;
    if (d && !blockDates.has(k)) blockDates.set(k, d);
  }
  const entries = [];
  for (const r of rows) {
    if (!r.day || !r.exercise) continue;
    const sets = (r.sets || []).slice(0, MAX_SETS).map(toNumber);
    while (sets.length && sets[sets.length - 1] === null) sets.pop();
    if (!sets.some((x) => x !== null)) continue;
    const weight = toNumber(r.weight);
    const reps = sets.filter((x) => x !== null);
    const total = reps.reduce((a, b) => a + b, 0);
    entries.push({
      row: r.row,
      week: toNumber(r.week),
      date: parseDate(r.date) || blockDates.get(`${r.week}||${r.day}`) || null,
      day: String(r.day),
      exercise: String(r.exercise),
      target: parseTarget(r.target),
      targetLabel: String(r.target || ''),
      weight,
      sets,
      totalReps: total,
      volume: weight ? weight * total : 0,
      e1rm: weight ? Math.max(...reps.map((x) => weight * (1 + x / 30))) : null,
      notes: r.notes ? String(r.notes) : '',
    });
  }
  entries.sort(compareEntries);
  return entries;
}

function compareEntries(a, b) {
  return (a.week ?? 0) - (b.week ?? 0) || String(a.date || '').localeCompare(String(b.date || '')) || (a.row ?? 0) - (b.row ?? 0);
}

/** Index entries by day+exercise (Leg curl on Day 2 and Day 4 are different variants). */
export function historyByKey(entries) {
  const map = new Map();
  for (const e of entries) {
    const k = entryKey(e.day, e.exercise);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

/** Sessions = entries grouped by (week, day). */
export function sessions(entries) {
  const map = new Map();
  for (const e of entries) {
    const k = `${e.week}||${e.day}`;
    if (!map.has(k)) map.set(k, { week: e.week, day: e.day, date: e.date, entries: [] });
    const s = map.get(k);
    s.entries.push(e);
    if (!s.date && e.date) s.date = e.date;
  }
  return [...map.values()].sort((a, b) => (a.week - b.week) || String(a.date || '').localeCompare(String(b.date || '')) || describeDay(a.day).num - describeDay(b.day).num);
}

/** The week to write for the next session of `day`: one past the last logged week of that day. */
export function nextWeekForDay(entries, day) {
  let max = 0;
  for (const e of entries) if (e.day === day && e.week > max) max = e.week;
  return max + 1;
}

/** Suggests which day comes next: the one after the most recently trained day. */
export function suggestNextDay(entries, days) {
  if (!days.length) return null;
  const all = sessions(entries);
  if (!all.length) return days[0];
  const last = all[all.length - 1];
  const i = days.indexOf(last.day);
  return days[(i + 1) % days.length];
}

/**
 * Double progression. Compares the last session against the rep range:
 *  - every required set at or above the top of the range -> increase the weight
 *  - any set below the bottom of the range -> keep the weight, rebuild reps
 *  - otherwise -> same weight, add reps
 * Also returns per-set "aim" numbers for the next session.
 */
export function recommend(last, target, opts = {}) {
  const { upperIncrement = 5, lowerIncrement = 5, isLower = false } = opts;
  if (!last) {
    return {
      status: 'new',
      title: 'First time',
      detail: target.min != null ? `Pick a weight you can do for ${target.min}–${target.max} ${target.unit}` : 'Log your first session',
      weight: null,
      aims: Array(target.sets).fill(target.min),
    };
  }
  const n = target.sets;
  const required = last.sets.slice(0, n);
  const filled = required.filter((x) => x !== null);
  const complete = filled.length >= n;
  const allTop = complete && target.max != null && filled.every((x) => x >= target.max);
  const below = target.min != null ? required.map((x, i) => (x !== null && x < target.min ? i + 1 : null)).filter(Boolean) : [];
  const timed = target.unit === 'sec';
  const bodyweight = !last.weight;

  if (allTop) {
    if (bodyweight || timed) {
      return {
        status: 'increase',
        title: timed ? 'Top of range — go longer' : 'Top of range — make it harder',
        detail: timed ? 'All sets hit the top. Add time or a harder variation.' : 'All sets hit the top. Add load or slow the tempo.',
        weight: last.weight,
        aims: Array(n).fill(target.max),
      };
    }
    const inc = isLower ? lowerIncrement : upperIncrement;
    return {
      status: 'increase',
      title: `Add weight → ${fmtWeight(last.weight + inc)}`,
      detail: `All ${n} sets hit ${target.max}. Reps will drop — build back up.`,
      weight: last.weight + inc,
      increment: inc,
      aims: Array(n).fill(target.min),
    };
  }

  const aims = Array.from({ length: n }, (_, i) => {
    const prev = last.sets[i];
    if (prev === null || prev === undefined) return target.min;
    return Math.min(target.max ?? prev + 1, Math.max(target.min ?? 0, prev + 1));
  });
  const missing = n - filled.length;
  if (below.length) {
    return {
      status: 'hold',
      title: `Same weight · ${fmtWeight(last.weight)}`,
      detail: `Set${below.length > 1 ? 's' : ''} ${below.join(', ')} fell below ${target.min}. Keep the weight and rebuild reps.`,
      weight: last.weight,
      aims,
    };
  }
  const toGo = required.reduce((acc, x) => acc + Math.max(0, (target.max ?? 0) - (x ?? 0)), 0);
  return {
    status: 'build',
    title: `Same weight · ${fmtWeight(last.weight)}`,
    detail: missing > 0
      ? `Only ${filled.length} of ${n} sets logged last time. Do all ${n}, then chase ${target.max}.`
      : `${toGo} rep${toGo === 1 ? '' : 's'} to go until you can add weight.`,
    weight: last.weight,
    aims,
  };
}

/** How a single logged set compares to the range: 'top' | 'in' | 'below' | 'empty'. */
export function setGrade(value, target) {
  if (value === null || value === undefined) return 'empty';
  if (target.max != null && value >= target.max) return 'top';
  if (target.min != null && value < target.min) return 'below';
  return 'in';
}

export function fmtWeight(w) {
  if (w === null || w === undefined) return 'BW';
  return `${Number.isInteger(w) ? w : w.toFixed(1)} lb`;
}

/** Weekly volume per day label (mirrors the Progress tab). */
export function weeklyVolume(entries, days) {
  const weeks = new Map();
  for (const e of entries) {
    if (!e.week) continue;
    if (!weeks.has(e.week)) weeks.set(e.week, Object.fromEntries(days.map((d) => [d, 0])));
    const w = weeks.get(e.week);
    w[e.day] = (w[e.day] || 0) + e.volume;
  }
  return [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([week, byDay]) => ({ week, byDay, total: Object.values(byDay).reduce((a, b) => a + b, 0) }));
}

/** Personal bests per day+exercise. */
export function personalBests(history) {
  const out = new Map();
  for (const [k, list] of history) {
    const weighted = list.filter((e) => e.weight);
    out.set(k, {
      weight: weighted.length ? Math.max(...weighted.map((e) => e.weight)) : null,
      volume: weighted.length ? Math.max(...weighted.map((e) => e.volume)) : null,
      e1rm: weighted.length ? Math.max(...weighted.map((e) => e.e1rm)) : null,
      reps: Math.max(...list.map((e) => Math.max(...e.sets.filter((x) => x !== null)))),
    });
  }
  return out;
}

/** Trailing 7-day mean for each bodyweight point. */
export function rollingAverage(points, days = 7) {
  return points.map((p, i) => {
    const t = Date.parse(p.date);
    const win = points.slice(0, i + 1).filter((q) => t - Date.parse(q.date) < days * 86400000);
    return { date: p.date, value: win.reduce((a, q) => a + q.weight, 0) / win.length };
  });
}
