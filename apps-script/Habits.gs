/** @OnlyCurrentDoc */
/**
 * Habit Tracker API - a tiny JSON API over the "Habit Tracker" sheet.
 *
 * Install: Extensions > Apps Script in the Habit Tracker spreadsheet, paste this
 * file, run setupToken() once, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone). See README.md.
 *
 * GET  ?action=data&token=...                      -> { habits, log }
 * POST {action:'logDay', token, habit, date}       -> adds a Log row (once per habit and day)
 * POST {action:'unlogDay', token, habit, date}     -> removes that habit's Log rows for the day
 * POST {action:'updateHabit', token, habit, rate?, start?} -> edits "Saved per day" / "Start date"
 *
 * Only the yellow input columns (Habits A-C, Log A-C) are written; the formulas are never touched.
 */

var HABITS_SHEET = 'Habits';
var LOG_SHEET = 'Log';
var HABITS_FIRST_ROW = 5; // rows 1-4 are the title, help text, total and headers

/** Run once from the editor. Generates the secret the web app must send. */
function setupToken() {
  var token = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('APP_TOKEN', token);
  Logger.log('Your app token (paste it into the app Settings): ' + token);
  return token;
}

function doGet(e) {
  return respond_(function () {
    checkToken_(e.parameter.token);
    var action = e.parameter.action || 'data';
    if (action === 'data') return getData_();
    throw new Error('Unknown action: ' + action);
  });
}

function doPost(e) {
  return respond_(function () {
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    checkToken_(body.token);
    if (body.action === 'logDay') return withLock_(function () { return logDay_(body); });
    if (body.action === 'unlogDay') return withLock_(function () { return unlogDay_(body); });
    if (body.action === 'updateHabit') return withLock_(function () { return updateHabit_(body); });
    throw new Error('Unknown action: ' + body.action);
  });
}

function respond_(fn) {
  var out;
  try {
    out = { ok: true, data: fn() };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('APP_TOKEN');
  if (!expected) throw new Error('Server not set up: run setupToken() in the Apps Script editor.');
  if (token !== expected) throw new Error('Invalid token');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet: ' + name);
  return sh;
}

function fmtDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return String(v || '').trim();
}

function checkDate_(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) throw new Error('Bad date: ' + iso);
  return iso;
}

function habitRows_() {
  var sh = sheet_(HABITS_SHEET);
  var last = sh.getLastRow();
  if (last < HABITS_FIRST_ROW) return [];
  return sh.getRange(HABITS_FIRST_ROW, 1, last - HABITS_FIRST_ROW + 1, 3).getValues().map(function (r, i) {
    return { row: HABITS_FIRST_ROW + i, name: String(r[0]).trim(), start: fmtDate_(r[1]), rate: r[2] === '' ? 0 : Number(r[2]) };
  }).filter(function (h) { return h.name; });
}

function findHabit_(name) {
  var h = habitRows_().filter(function (x) { return x.name === name; })[0];
  if (!h) throw new Error('No habit called "' + name + '" on the Habits tab');
  return h;
}

function logRows_() {
  var sh = sheet_(LOG_SHEET);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getValues().map(function (r, i) {
    return { row: i + 2, date: fmtDate_(r[0]), habit: String(r[1]).trim(), note: r[2] };
  });
}

function getData_() {
  var habits = habitRows_().map(function (h) { return { name: h.name, start: h.start, rate: h.rate }; });
  var log = logRows_().filter(function (r) { return r.date && r.habit; })
    .map(function (r) { return { date: r.date, habit: r.habit, note: r.note }; });
  return { habits: habits, log: log, updated: new Date().toISOString() };
}

function logDay_(p) {
  var habit = findHabit_(p.habit).name;
  var date = checkDate_(p.date);
  var rows = logRows_();
  var existing = rows.filter(function (r) { return r.habit === habit && r.date === date; })[0];
  if (existing) return { row: existing.row, already: true };
  // Reuse the first blank row so a deleted day doesn't leave a gap at the top.
  var blank = rows.filter(function (r) { return !r.date && !r.habit; })[0];
  var row = blank ? blank.row : sheet_(LOG_SHEET).getLastRow() + 1;
  var range = sheet_(LOG_SHEET).getRange(row, 1, 1, 2);
  range.setValues([[date, habit]]); // a 'YYYY-MM-DD' string is stored as a real date, as if typed
  range.getCell(1, 1).setNumberFormat('yyyy-mm-dd');
  if (p.note) sheet_(LOG_SHEET).getRange(row, 3).setValue(String(p.note));
  return { row: row };
}

function unlogDay_(p) {
  var habit = String(p.habit || '');
  var date = checkDate_(p.date);
  var sh = sheet_(LOG_SHEET);
  var hits = logRows_().filter(function (r) { return r.habit === habit && r.date === date; });
  for (var i = hits.length - 1; i >= 0; i--) sh.deleteRow(hits[i].row);
  return { removed: hits.length };
}

function updateHabit_(p) {
  var h = findHabit_(p.habit);
  var sh = sheet_(HABITS_SHEET);
  if (p.rate !== undefined) {
    var rate = Number(p.rate);
    if (!isFinite(rate) || rate < 0) throw new Error('Saved per day must be a number of dollars');
    sh.getRange(h.row, 3).setValue(rate);
  }
  if (p.start !== undefined) {
    sh.getRange(h.row, 2).setValue(checkDate_(p.start)).setNumberFormat('yyyy-mm-dd');
  }
  return { row: h.row };
}
