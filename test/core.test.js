import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTarget, parseDate, normaliseLog, historyByKey, entryKey, recommend,
  nextWeekForDay, suggestNextDay, weeklyVolume, describeDay, setGrade,
} from '../docs/js/core.js';
import demo from '../docs/js/demo-data.js';

const entries = normaliseLog(demo.log);
const history = historyByKey(entries);
const last = (day, ex) => history.get(entryKey(day, ex)).at(-1);
const DAYS = [...new Set(demo.program.map((p) => p.day))];

test('parseTarget handles every program format', () => {
  assert.deepEqual(parseTarget('4 x 5-8'), { sets: 4, min: 5, max: 8, unit: 'reps', perSide: false, label: '4 x 5-8' });
  assert.equal(parseTarget('3 x 5').max, 5);
  assert.equal(parseTarget('3 x 10-12 / leg').perSide, true);
  assert.equal(parseTarget('3 x 30-45 sec').unit, 'sec');
  assert.equal(parseTarget('3 x 30-45 sec').max, 45);
});

test('parseDate handles the mixed formats in the Log tab', () => {
  assert.equal(parseDate('2026-09-27'), '2026-09-27');
  assert.equal(parseDate('30 Sept 2026'), '2026-09-30');
  assert.equal(parseDate('10/3/2026'), '2026-10-03');
  assert.equal(parseDate(46292), '2026-09-27');
  assert.equal(parseDate(''), null);
});

test('rows inherit the date of their day block', () => {
  assert.equal(last('Day 1 - Upper (strength)', 'Rope pushdown').date, '2026-10-05');
  assert.equal(last('Day 2 - Lower (strength)', 'Leg curl').date, '2026-10-10');
});

test('empty template rows are not counted as logged', () => {
  assert.equal(entries.length, 42);
  assert.equal(nextWeekForDay(entries, 'Day 4 - Lower (hypertrophy)'), 2);
  assert.equal(nextWeekForDay(entries, 'Day 1 - Upper (strength)'), 3);
  assert.equal(suggestNextDay(entries, DAYS), 'Day 4 - Lower (hypertrophy)');
});

const rec = (day, ex) => {
  const e = last(day, ex);
  return recommend(e, e.target, { isLower: describeDay(day).isLower, upperIncrement: 5, lowerIncrement: 10 });
};

test('all sets at top of range -> add weight', () => {
  const r = rec('Day 1 - Upper (strength)', 'Barbell bench press'); // 8,8,8,8 @135
  assert.equal(r.status, 'increase');
  assert.equal(r.weight, 140);
  assert.deepEqual(r.aims, [5, 5, 5, 5]);
  assert.equal(rec('Day 2 - Lower (strength)', 'Back squat').weight, 145);
  assert.equal(rec('Day 3 - Upper (hypertrophy)', 'Hammer curl').status, 'increase'); // 18s beat 15
});

test('in range but not at top -> same weight, aim one more rep', () => {
  const r = rec('Day 1 - Upper (strength)', 'Dumbbell curl'); // 15,14,13 @40
  assert.equal(r.status, 'build');
  assert.equal(r.weight, 40);
  assert.deepEqual(r.aims, [15, 15, 14]);
});

test('below range -> hold weight', () => {
  const r = rec('Day 2 - Lower (strength)', 'Bulgarian split squat'); // 12,9,9 vs 10-12
  assert.equal(r.status, 'hold');
  assert.deepEqual(r.aims, [12, 10, 10]);
});

test('missing sets block a weight increase', () => {
  const r = rec('Day 2 - Lower (strength)', 'Plank or ab wheel'); // 40,33 of 3 sets
  assert.equal(r.status, 'build');
  assert.match(r.detail, /Only 2 of 3/);
});

test('setGrade', () => {
  const t = parseTarget('4 x 5-8');
  assert.equal(setGrade(8, t), 'top');
  assert.equal(setGrade(6, t), 'in');
  assert.equal(setGrade(4, t), 'below');
  assert.equal(setGrade(null, t), 'empty');
});

test('weekly volume matches the Progress tab', () => {
  const v = weeklyVolume(entries, DAYS);
  assert.equal(v[0].byDay['Day 1 - Upper (strength)'], 15191);
  assert.equal(v[0].total, 54471);
  assert.equal(v[1].total, 50519);
});
