# Lift Log — strength training tracker

A phone-first gym app for the 4-day upper/lower split in the **Workout Tracker** Google Sheet.
The sheet stays the source of truth: the app reads the `Program`, `Log` and `Bodyweight` tabs
and writes your sets straight back into `Log`.

**What it does**

- **Train** — pick the day (it suggests the next one in the rotation). Every exercise shows what you
  did last time, set by set, colour-coded against the rep range:
  - ✅ green = top of the range, red = below the range.
  - A **double-progression call** for today: **Add weight → 140 lb** (all sets at the top of the
    range), **Same weight, add reps** (shows how many reps are left), or **Hold** (a set fell below the range).
  - The weight is pre-filled with the suggestion, and each set input shows that set's target as a placeholder.
    "Fill targets" copies them in. Inputs turn green or red as you type.
  - Tap the rest time (⏱ 2-3 min) to start a rest timer that vibrates and beeps when it ends.
  - Unsaved input is kept on the phone, so locking the screen or reloading loses nothing.
  - No signal in the gym? The workout is saved on the phone and synced to the sheet later.
- **Progress** — per-exercise charts of working weight and estimated 1-rep max, total reps per workout
  against the "add weight" line, weekly volume stacked by day, and a personal-bests table.
- **Body** — log your bodyweight and see the 7-day average against the ±2 lb recomp band.

## How it fits together

```
docs/            Static web app (GitHub Pages serves this folder)
  index.html     App shell
  styles.css     Light + dark theme
  js/core.js     Training logic: parsing, double progression, volume (unit-tested)
  js/charts.js   Small dependency-free SVG charts
  js/app.js      UI, offline queue, drafts, rest timer
  js/demo-data.js Snapshot of the sheet for demo mode
apps-script/
  Code.gs        JSON API that runs inside the Google Sheet
test/            node --test unit tests for core.js
```

The browser talks to a Google Apps Script **web app** bound to your spreadsheet. Requests carry a
secret token that only you have.

## Setup (about 5 minutes)

### 1. Add the API to your sheet
1. Open the **Workout Tracker** spreadsheet → **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs) and save.
3. In the function dropdown pick **`setupToken`** → **Run**. Approve the permissions (it only
   touches this spreadsheet). Open **Execution log** and copy the token it prints.
4. **Deploy → New deployment →** type **Web app**:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone** (the token is what keeps it private)
5. Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

> If you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

### 2. Publish the app
1. In this GitHub repo: **Settings → Pages → Build and deployment → Deploy from a branch**,
   choose your branch and the **`/docs`** folder → **Save**.
2. After a minute the app is live at `https://<your-user>.github.io/strengthtraining/`.

(Or run it locally: `npm start` and open http://localhost:8080.)

### 3. Connect and install on your phone
1. Open the app → **Settings** → paste the **Web app URL** and **token** → **Save & connect**.
2. Add it to your home screen: iPhone Safari → Share → **Add to Home Screen**;
   Android Chrome → ⋮ → **Install app**. It then opens full-screen like a native app.

Until it's connected, the app runs in **demo mode** on a snapshot of your first two weeks.
Anything you save in demo mode stays on that phone only.

## How saving works

- A workout is written as **Week N** for that day, where N is one past the last week you logged that day.
- If the sheet already has the empty template row for that week/day/exercise, the app fills it in.
  Otherwise it adds a new row at the bottom (with the Volume formula).
- The date goes on the first row of the day, same as you do by hand. The Volume formula (column K) is never touched.
- Exercises with no reps entered are skipped, so you can save a partial workout.
- The double-progression increments default to +5 lb for upper and lower body. Change them in **Settings**
  (the sheet recommends 2.5–5 lb upper, 5–10 lb lower).

**Note:** the formulas on the sheet's own `Progress` tab only look at `Log` rows 2–193 (the 8 pre-made weeks).
The app's charts read every row, but if you log past week 8, extend those ranges in the sheet too.

## Habit Log — daily habit tracker

A second app in this repo, at `https://<your-user>.github.io/strengthtraining/habits/`, for the
**Habit Tracker** Google Sheet (`Habits`, `Log` and `Progress` tabs). It starts with the first habit, *No soda*.

**What it does**

- **One big button.** Tap **I did it** and today is logged (it turns green, with a small vibration).
  Tap it again to undo, or use **Undo** on the message at the bottom.
- **Forgot a day?** Tap that day in the week strip above the button, then tap the button. Older days can be
  picked from the calendar. Days since your start date that you didn't log are outlined in amber, with
  one-tap **+ day** buttons for the last week. Future days can't be logged.
- **Money saved.** The big number is *days completed since the start date × saved per day*, the same
  calculation as the sheet. Tap **Edit** to change the daily amount (e.g. `8` for $8) or the start date;
  both are written back to the yellow cells on the `Habits` tab. It also shows what that comes to per week,
  month and year.
- **Streaks.** Current and best streak, success rate and last logged day, matching the sheet's formulas.
  The current streak stays alive until you miss a whole day.
- Works offline: taps are kept on the phone and synced in order when you're back online.
- Add more habits as new rows on the `Habits` tab and a switcher appears at the top.
- **Money or time.** A habit can save dollars or hours: set **Saved as** (column L of `Habits`) to `$` or `hours`,
  or pick *Money* / *Time* under **Edit** in the app. Time habits show hours (2 h a day, 14 h a week, 730 h a year).
  A habit that saves nothing (0 per day) shows its streak in place of the savings.

**Setup.** It's the same as Lift Log, but done in the **Habit Tracker** spreadsheet using
[`apps-script/Habits.gs`](apps-script/Habits.gs):
Extensions → Apps Script → paste `Habits.gs` → run **`setupToken`** → **Deploy → New deployment → Web app**
(Execute as *Me*, access *Anyone*) → paste the URL and token into Habit Log's **Settings** (⚙). Then add it to
your home screen as its own app. Until it's connected it runs in demo mode on a snapshot of your sheet.

The app only writes the input columns: `Log` A–C (one row per habit per day, never duplicated; undo deletes
the row) and `Habits` B–C and L. The formula columns are never touched.

## Development

```bash
npm test     # unit tests for the progression and habit logic (Node 18+)
npm start    # serve docs/ on http://localhost:8080
```

No build step and no dependencies. The app is plain ES modules.
