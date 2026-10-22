# Ritch

A sibling of [Change](https://github.com/TeddyMilford/change). One screen: an 82-day block (Oct 19, 2026 to Jan 8, 2027) as 82 squares, and the one thing to do now.

The goals, by Thursday Dec 31: a 5K under 35:00, 25 pull-ups, 50 dips, 100 push-ups. Under the grid are running totals instead: minutes run, pull-ups, dips and push-ups ticked so far. Open a past day and they show the totals through that date.

The screen shows today as a list. Tap each thing when it's done; tap again to untick. Missed logging a day? Tap its square in the grid to open it and tick it after the fact. Tick everything and the day gets a 33: "You did all. Day counted." Rest days have one thing: "I rested". Streaks count days in a row.

The hidden math (pull-ups, dips, push-ups): leave one unticked on a lift day where you ticked something else and it drops a step next time, never below the minimums: 10 push-ups, 3 pull-ups, 3 dips per set. Tick it in every lift session of a week and it goes up a step (+1, push-ups +2). Days you don't touch change nothing. Weeks 1 and 6 are lighter and skip the step up. Test days are one max set of each, ticked, no counting. The PDF shows the starting numbers.

| Day | |
|---|---|
| Sun, Tue, Thu | Lift: pull-ups, dips, push-ups, plus legs or trunk |
| Mon, Wed, Sat | Run (Couch to 5K), then 2 easy sets of push-ups |
| Fri | Rest |

The block starts Monday Oct 19, in week 1. Week 6 (Thanksgiving) is lighter. Wednesday Dec 30 is a 5K. Thursday Dec 31 is a max test. The block ends Friday Jan 8.

## Files

| Path | What |
|---|---|
| `site/plan.js` | The entire plan. Edit the rep tables and sessions here. |
| `site/index.html` | The screen |
| `site/sw.js` | Offline cache |
| `scripts/pdf.mjs` | Prints the plan to `ritch.pdf` |

## Commands

```sh
npm run serve   # http://localhost:8000
npm test
npm run pdf     # writes ritch.pdf (needs: npm install && npx playwright install chromium)
```

Pushing to `main` deploys `site/` to GitHub Pages at https://teddymilford.github.io/ritch/. On the iPhone: open it in Safari, Share, Add to Home Screen. DONE marks are saved on the phone only.
