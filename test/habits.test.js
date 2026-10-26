import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, applyOps, doneDates, habitStats, missedDays, monthCells, toNumber, fmtMoney,
  parseUnit, fmtSaved,
} from '../docs/habits/js/core.js';

// The sheet as of 2026-10-14: No soda, started 2026-10-08, $8/day.
const habit = { name: 'No soda', start: '2026-10-08', rate: 8 };
const log = ['08', '09', '10', '11', '12', '13', '14']
  .map((d) => ({ date: `2026-10-${d}`, habit: 'No soda' }));

test('date helpers cross month boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-10-08', '2026-10-14'), 6);
});

test('stats match the Habits tab', () => {
  const s = habitStats(habit, doneDates(log, 'No soda'), '2026-10-14');
  assert.equal(s.daysSinceStart, 7);
  assert.equal(s.completed, 7); // Oct 1-5 are before the start date
  assert.equal(s.completionRate, 1);
  assert.equal(s.last, '2026-10-14');
  assert.equal(s.current, 7);
  assert.equal(s.longest, 7);
  assert.equal(s.saved, 56);
  assert.equal(s.doneToday, true);
});

test('streak survives until a full day is missed', () => {
  const dates = doneDates(log, 'No soda');
  assert.equal(habitStats(habit, dates, '2026-10-15').current, 7); // not logged yet today
  assert.equal(habitStats(habit, dates, '2026-10-16').current, 0); // missed the 15th
});

test('logging a forgotten day retroactively joins the streak', () => {
  const data = { habits: [habit], log: log.filter((r) => r.date !== '2026-10-12') };
  let s = habitStats(habit, doneDates(data.log, 'No soda'), '2026-10-14');
  assert.equal(s.current, 2);
  assert.equal(s.saved, 48);
  const fixed = applyOps(data, [{ action: 'logDay', habit: 'No soda', date: '2026-10-12' }]);
  s = habitStats(habit, doneDates(fixed.log, 'No soda'), '2026-10-14');
  assert.equal(s.current, 7);
  assert.equal(s.saved, 56);
});

test('applyOps logs once, unlogs, and updates the rate', () => {
  const data = { habits: [habit], log: [] };
  const out = applyOps(data, [
    { action: 'logDay', habit: 'No soda', date: '2026-10-14' },
    { action: 'logDay', habit: 'No soda', date: '2026-10-14' },
    { action: 'logDay', habit: 'No soda', date: '2026-10-13' },
    { action: 'unlogDay', habit: 'No soda', date: '2026-10-13' },
    { action: 'updateHabit', habit: 'No soda', rate: 2.5 },
  ]);
  assert.deepEqual(out.log.map((r) => r.date), ['2026-10-14']);
  assert.equal(out.habits[0].rate, 2.5);
  assert.equal(data.habits[0].rate, 8); // input untouched
});

test('missedDays skips days before the start date and today', () => {
  const dates = doneDates(log.filter((r) => r.date !== '2026-10-12'), 'No soda');
  assert.deepEqual(missedDays(habit, dates, '2026-10-14'), ['2026-10-12']);
  assert.deepEqual(missedDays(habit, doneDates([], 'No soda'), '2026-10-10'), ['2026-10-08', '2026-10-09']);
});

test('monthCells pads to whole weeks starting Sunday', () => {
  const cells = monthCells(2026, 9); // October 2026 starts on a Thursday
  assert.equal(cells.length % 7, 0);
  assert.equal(cells.indexOf('2026-10-01'), 4);
  assert.equal(cells.filter(Boolean).length, 31);
});

test('money parsing and formatting', () => {
  assert.equal(toNumber('$8.50'), 8.5);
  assert.equal(toNumber('abc'), null);
  assert.equal(fmtMoney(56), '$56.00');
  assert.equal(fmtMoney(2920), '$2,920');
});

test('habits can save time instead of money', () => {
  assert.equal(parseUnit('hours'), 'h');
  assert.equal(parseUnit('$'), '$');
  assert.equal(parseUnit(''), '$'); // older sheets have no "Saved as" column
  const browsing = { name: 'No browsing', start: '2026-10-26', rate: 2, unit: 'hours' };
  const days = ['26', '27', '28'].map((d) => ({ date: `2026-10-${d}`, habit: 'No browsing' }));
  const s = habitStats(browsing, doneDates(days, 'No browsing'), '2026-10-28');
  assert.equal(s.unit, 'h');
  assert.equal(s.saved, 6);
  assert.equal(fmtSaved(s.saved, s.unit), '6 h');
  assert.equal(fmtSaved(0.5, 'h'), '30 min');
  assert.equal(fmtSaved(730, 'h'), '730 h');
  assert.equal(fmtSaved(8, '$'), '$8.00');
  const out = applyOps({ habits: [browsing], log: [] }, [{ action: 'updateHabit', habit: 'No browsing', unit: '$' }]);
  assert.equal(out.habits[0].unit, '$');
});
