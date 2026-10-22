# Ritch

A sibling of [Change](https://github.com/TeddyMilford/change). One screen: a 90-day block (Oct 11, 2026 to Jan 8, 2027) as 90 squares, and the one thing to do now.

The screen shows today as a list. Tap each thing when it's done; tap again to untick. Tick everything and the day gets a 33: "You did all. Day counted." Rest days have one thing: "I rested". Streaks count days in a row.

The hidden math (pull-ups, dips, push-ups): leave one unticked on a lift day where you ticked something else and it drops a step next time (never below 1 rep). Tick it in every lift session of a week and it goes up a step (+1, push-ups +2). Days you don't touch change nothing. Weeks 1 and 6 are lighter and skip the step up. Test days are one max set of each, ticked, no counting. The PDF shows the starting numbers.

| Day | |
|---|---|
| Sun, Tue, Thu | Lift: pull-ups, dips, push-ups, plus legs or trunk |
| Mon, Wed, Sat | Run (Couch to 5K), then 2 easy sets of push-ups |
| Fri | Rest |

Oct 11-17 is a practice week; Thursday Oct 15 is a max test. Week 6 (Thanksgiving) is lighter. Wednesday Dec 30 is a 5K. Thursday Dec 31 is a max test. The block ends Friday Jan 8.

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
