/** @OnlyCurrentDoc */
/**
 * Workout Tracker API - a tiny JSON API over the "Workout Tracker" sheet.
 *
 * Install: Extensions > Apps Script in the spreadsheet, paste this file,
 * run setupToken() once, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone). See README.md.
 *
 * GET  ?action=data&token=...           -> { program, log, bodyweight }
 * POST {action:'logSession', token, ...} -> writes a session into the Log tab
 * POST {action:'logBodyweight', token, ...}
 */

var LOG_SHEET = 'Log';
var PROGRAM_SHEET = 'Program';
var BODYWEIGHT_SHEET = 'Bodyweight';
var LOG_COLS = 12; // Week, Date, Day, Exercise, Target, Weight, Set 1-4, Volume, Notes
var MAX_SETS = 4;

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
    if (body.action === 'logSession') return logSession_(body);
    if (body.action === 'logBodyweight') return logBodyweight_(body);
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

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet: ' + name);
  return sh;
}

function fmtCell_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return v;
}

function getData_() {
  var program = [];
  var psh = sheet_(PROGRAM_SHEET);
  if (psh.getLastRow() >= 4) {
    psh.getRange(4, 1, psh.getLastRow() - 3, 5).getValues().forEach(function (r) {
      if (r[0] && r[1]) program.push({ day: r[0], exercise: r[1], target: r[2], rest: r[3], notes: r[4] });
    });
  }

  var log = [];
  var lsh = sheet_(LOG_SHEET);
  if (lsh.getLastRow() >= 2) {
    lsh.getRange(2, 1, lsh.getLastRow() - 1, LOG_COLS).getValues().forEach(function (r, i) {
      if (!r[2] || !r[3]) return;
      var hasSets = r.slice(6, 10).some(function (x) { return x !== '' && x !== null; });
      if (!hasSets && r[1] === '') return; // untouched template row
      log.push({
        row: i + 2, week: r[0], date: fmtCell_(r[1]), day: r[2], exercise: r[3], target: r[4],
        weight: r[5], sets: r.slice(6, 10), notes: r[11],
      });
    });
  }

  var bodyweight = [];
  var bsh = sheet_(BODYWEIGHT_SHEET);
  if (bsh.getLastRow() >= 5) {
    bsh.getRange(5, 1, bsh.getLastRow() - 4, 3).getValues().forEach(function (r) {
      if (r[0] !== '' && r[1] !== '') bodyweight.push({ date: fmtCell_(r[0]), weight: Number(r[1]), notes: r[2] });
    });
  }

  return { program: program, log: log, bodyweight: bodyweight, updated: new Date().toISOString() };
}

function isBlank_(v) { return v === '' || v === null; }

function toDate_(isoDate) {
  var m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Bad date: ' + isoDate);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function cleanNumber_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  if (!isFinite(n)) throw new Error('Not a number: ' + v);
  return n;
}

/**
 * Writes one session. Each entry fills the pre-made template row for the same
 * week/day/exercise when one is still empty; otherwise a new row is appended.
 * The Volume formula in column K is never overwritten.
 */
function logSession_(p) {
  if (!p.day || !p.week || !p.date || !p.entries || !p.entries.length) throw new Error('Missing day, week, date or entries');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(LOG_SHEET);
    var last = sh.getLastRow();
    var data = last >= 2 ? sh.getRange(2, 1, last - 1, LOG_COLS).getValues() : [];
    var appendAt = last;
    var date = toDate_(p.date);
    var written = [];

    p.entries.forEach(function (entry, i) {
      var sets = (entry.sets || []).slice(0, MAX_SETS).map(cleanNumber_);
      while (sets.length < MAX_SETS) sets.push('');
      var idx = -1;
      for (var r = 0; r < data.length; r++) {
        var row = data[r];
        if (String(row[0]) === String(p.week) && row[2] === p.day && row[3] === entry.exercise &&
            isBlank_(row[5]) && row.slice(6, 10).every(isBlank_)) { idx = r; break; }
      }
      var rowNum;
      if (idx >= 0) {
        rowNum = idx + 2;
        data[idx][6] = 'used';
      } else {
        rowNum = ++appendAt;
        sh.getRange(rowNum, 1, 1, 5).setValues([[Number(p.week), '', p.day, entry.exercise, entry.target || '']]);
        sh.getRange(rowNum, 11).setFormula('=IF(F' + rowNum + '="","",F' + rowNum + '*SUM(G' + rowNum + ':J' + rowNum + '))');
      }
      if (i === 0) sh.getRange(rowNum, 2).setValue(date).setNumberFormat('yyyy-mm-dd');
      sh.getRange(rowNum, 6, 1, 5).setValues([[cleanNumber_(entry.weight)].concat(sets)]);
      if (entry.notes) sh.getRange(rowNum, 12).setValue(String(entry.notes));
      written.push(rowNum);
    });
    return { rows: written };
  } finally {
    lock.releaseLock();
  }
}

function logBodyweight_(p) {
  var weight = cleanNumber_(p.weight);
  if (weight === '') throw new Error('Missing weight');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(BODYWEIGHT_SHEET);
    var row = Math.max(5, sh.getLastRow() + 1);
    sh.getRange(row, 1, 1, 3).setValues([[toDate_(p.date), weight, p.notes || '']]);
    sh.getRange(row, 1).setNumberFormat('yyyy-mm-dd');
    return { row: row };
  } finally {
    lock.releaseLock();
  }
}
