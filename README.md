# Ritch

A small offline PWA that shows today's workout and tracks it: a tap counter for reps with a rest timer, a run session timer, and a Progress screen. Weeks run Sunday through Saturday. Runs are on Monday, Wednesday and Saturday, strength sessions on Sunday, Tuesday and Thursday, with short push-up practice after each run, and Friday is the rest day. Sunday, Oct 18 stays a rest day so the first workout is still Monday, Oct 19. An optional, easier practice week runs Oct 11-17. Training starts Monday, Oct 19, 2026, and the target date is Thursday, Dec 31, 2026.

The stack is vanilla JS with Vite and `vite-plugin-pwa`. There's no backend and no runtime API calls. All data lives in `localStorage` on the device.

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173 (also printed on your LAN IP)
npm test           # unit tests: dates, schedule, progression, progress, storage
npm run verify     # build + end-to-end checks in Chromium/WebKit at iPhone sizes
```

`npm run verify` leaves screenshots in `test-results/`.

## Where things live

| Path | What |
|---|---|
| `src/plan/running.json` | Couch to 5K weeks 1-9 (NHS), plus weeks 10-11 and the ongoing weeks (the app's proposal) |
| `src/plan/practice.json` | The optional practice week, Oct 11-17 (the app's proposal) |
| `src/plan/strength.json` | Rep standards, regressions, sessions A/B, week types, progression rule |
| `src/plan/about.json` | Start/target dates, weekday schedule, safety text, sources, programming choices |
| `src/plan.js` | Pure logic: date → workout, repeats, progression replay, projections |
| `src/progress.js` | Pure logic: reps per session, weekly totals, consistency, run times |
| `src/chart.js` | Inline SVG line chart for the Progress screen |
| `src/dates.js` | America/Chicago "today" and DST-safe date math |
| `src/store.js` | localStorage, schema migration, JSON export/import |
| `src/screen.js` | All views |

Edit the JSON files to change the plan, then rebuild. Logs are keyed by date and item id, so text edits never touch saved history.

## Install on iPhone

The service worker, offline mode and a dependable home-screen install all need **HTTPS on a URL the phone can reach**. On the iPhone, `localhost` means the phone itself, not your Mac. A `http://192.168.x.x:5173` LAN URL will open the page, but it isn't a secure context, so offline mode won't work.

The simplest option is GitHub Pages, which is free and HTTPS. `.github/workflows/deploy.yml` is already set up:

```sh
git init && git add -A && git commit -m "Workout app"
gh repo create ritch --private --source . --push   # or --public
```

Then in the repo settings, go to **Settings → Pages → Source: GitHub Actions**. Pages on a private repo needs a paid GitHub plan; on the free plan, make the repo public. The code contains no personal data: your logs and setup stay on the phone. The workflow runs the tests, builds with the right base path and publishes to `https://<user>.github.io/ritch/`.

On the iPhone:

1. Open that URL in **Safari**.
2. Tap Share, then **Add to Home Screen**, then Add.
3. Open it once from the home screen while online. After that it works offline.

## Data

- Saved on the device only, with no sync. The home-screen app has its own storage, separate from the Safari tab.
- **Setup → Export JSON** saves a backup through the share sheet. **Import JSON** restores it, replacing what's on the device.
- App updates replace code only. The storage key (`workout.v1`) stays the same, and `migrate()` upgrades older data.
