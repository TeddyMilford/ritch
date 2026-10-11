// The whole plan: a 90-day block, Sunday Oct 11, 2026 to Friday Jan 8, 2027. Edit this file to change it.
//
// Week 0 is practice (Oct 11-17). Week 1 starts Sunday Oct 18 (a rest day); the first workout is Monday Oct 19.
// Runs: Mon, Wed, Sat. Lifting: Sun, Tue, Thu. Rest: Fri.
// Running weeks 1-9 are NHS Couch to 5K. Weeks 10-11 build to a 5K on Wed Dec 30. Thu Dec 31 is a max test.

export const FIRST = '2026-10-11';
export const LAST = '2027-01-08';

// Starting reps per set by week, index 0 = practice week. The app adjusts these from your ticks; see adjustments().
// Starting points: 4 dips, 20 push-ups. Pull-ups unknown, so they start like dips.
// Week 6 (Thanksgiving) is lighter.
//            wk  0   1   2   3   4   5   6   7   8   9  10  11  12
const BASE = {
  pull:      [    2,  2,  2,  3,  3,  3,  3,  4,  4,  5,  5,  5,  6],
  dip:       [    2,  2,  2,  3,  3,  3,  3,  4,  4,  5,  5,  5,  6],
  push:      [   10, 10, 11, 12, 12, 13, 12, 14, 15, 15, 16, 16, 17],
};
const NAMES = { pull: 'Pull-ups', dip: 'Dips', push: 'Push-ups' };
const STEP = { pull: 1, dip: 1, push: 2 };
const LIGHT_WEEKS = [1, 6]; // one fewer set, and no weekly step

// Run sessions by week: [Monday, Wednesday, Saturday]. Each is a list of [what, how much].
const RUNS = {
  1: same([['Run / walk', '8 × 1 min / 90 s']]),
  2: same([['Run / walk', '6 × 90 s / 2 min']]),
  3: same([['Run / walk', '90 s / 90 s'], ['Run / walk', '3 min / 3 min'], ['Run / walk', '90 s / 90 s'], ['Run', '3 min']]),
  4: same([['Run / walk', '3 min / 90 s'], ['Run / walk', '5 min / 2.5 min'], ['Run / walk', '3 min / 90 s'], ['Run', '5 min']]),
  5: [
    [['Run / walk', '3 × 5 min / 3 min']],
    [['Run / walk', '8 min / 5 min'], ['Run', '8 min']],
    [['Run', '20 min']],
  ],
  6: [
    [['Run / walk', '5 min / 3 min'], ['Run / walk', '8 min / 3 min'], ['Run', '5 min']],
    [['Run / walk', '10 min / 3 min'], ['Run', '10 min']],
    [['Run', '25 min']],
  ],
  7: same([['Run', '25 min']]),
  8: same([['Run', '28 min']]),
  9: same([['Run', '30 min']]),
  10: [
    [['Run', '30 min easy']],
    [['Run', '10 min easy'], ['Steady / easy', '6 × 1 min / 2 min'], ['Run', '2 min easy']],
    [['Run', '33 min easy']],
  ],
  11: [
    [['Run', '30 min easy'], ['Strides', '4 × 20 s']],
    null, // Wednesday Dec 30 is the 5K, below
    [['Run', '36 min easy']],
  ],
  12: [
    [['Run', '30 min easy'], ['Strides', '4 × 20 s']],
    [['Run', '10 min easy'], ['Steady / easy', '3 × 5 min / 2 min'], ['Run', '4 min easy']],
    null, // Saturday Jan 9 is past the end
  ],
};

function same(session) {
  return [session, session, session];
}

// A day is a short list of things to do. You tick each one. Tick them all and the day counts.
//   { name, sets, reps, move }  e.g. Pull-ups 4 × 3
//   { name, sets, amount }      e.g. L-sit 3 × 15 s
//   { name, amount: 'max' }     test day: one all-out set
//   { name, lines }             a run: the intervals
//   { name }                    rest day: "I rested"

export function workout(date, log = {}) {
  if (date < FIRST || date > LAST) return null;

  const w = week(date);
  const day = weekday(date);
  const tag = w === 0 ? 'Practice' : `Week ${w}`;
  const k = kind(date);

  if (k === 'rest') return { title: 'Rest', tag, rest: true, items: [{ name: 'I rested' }] };
  if (k === 'test') return { title: 'Test', tag, items: test(), note: date === '2026-12-31' ? 'Then party.' : undefined };

  const adj = adjustments(log, date);
  if (k === 'run') return { title: 'Run', tag, ...run(w, day, adj) };
  return { title: 'Lift', tag, items: lift(w, day, adj) };
}

function kind(date) {
  const day = weekday(date);
  if (day === 5 || date === '2026-10-18') return 'rest';
  if (date === '2026-12-31' || (week(date) === 0 && day === 4)) return 'test';
  if (day === 1 || day === 3 || day === 6) return 'run';
  return 'lift';
}

// "4 × 3", "3 × 15 s", "max"
export function howMuch(item) {
  if (item.amount === 'max') return 'max';
  if (item.reps != null) return `${item.sets} × ${item.reps}`;
  if (item.amount) return `${item.sets} × ${item.amount}`;
  return '';
}

function reps(m, w, adj) {
  return Math.max(1, BASE[m][w] + adj[m]);
}

function run(w, day, adj) {
  if (w === 0) return { items: [{ name: 'Run', lines: [['Walk', '5 min'], ['Jog / walk', '6 × 30 s / 90 s'], ['Walk', '5 min']] }] };
  if (w === 11 && day === 3) {
    return { items: [{ name: '5K', lines: [['Walk', '5 min'], ['Jog', '5 min'], ['5K', 'under 35:00']] }], note: '7:00 per km.' };
  }
  const session = RUNS[w][[1, 3, 6].indexOf(day)];
  return {
    items: [
      { name: 'Run', lines: [['Walk', '5 min'], ...session, ['Walk', '5 min']] },
      { name: 'Push-ups', sets: 2, reps: Math.max(1, Math.round(reps('push', w, adj) / 2)) },
    ],
  };
}

function lift(w, day, adj) {
  const light = LIGHT_WEEKS.includes(w) || (w === 11 && day === 2);
  const move = (m, n) => ({ name: NAMES[m], sets: light ? n - 1 : n, reps: reps(m, w, adj), move: m });

  if (w === 0) {
    return [move('pull', 2), move('dip', 2), move('push', 2), { name: 'Squat', sets: 2, reps: 10 }, { name: 'Hollow hold', sets: 2, amount: '15 s' }];
  }
  const sessions = {
    0: [move('push', 5), move('pull', 4), move('dip', 3), { name: 'L-sit', sets: 3, amount: '15 s' }, { name: 'Dead hang', sets: 2, amount: '30 s' }],
    2: [move('pull', 5), move('dip', 4), move('push', 3), { name: 'Squat', sets: 3, reps: 15 }, { name: 'Hollow hold', sets: 3, amount: '20 s' }],
    4: [move('pull', 4), move('push', 4), move('dip', 3), { name: 'Split squat, each leg', sets: 3, reps: 8 }, { name: 'Side plank, each side', sets: 2, amount: '30 s' }],
  };
  return sessions[day];
}

// One all-out set of each. Nothing to count; just go until you can't.
function test() {
  return ['pull', 'dip', 'push'].map((m) => ({ name: NAMES[m], amount: 'max' }));
}

// ---------- the hidden math ----------

// Reps added to (or taken from) the starting numbers, learned from the lift days before `beforeDate`.
//   Left a move unticked on a lift day you ticked something else: down a step next time (never below 1 rep).
//   Ticked a move in every lift session of a week (2 or more):    up a step next week.
// Days you didn't touch at all change nothing. Weeks 1 and 6 are lighter and skip the step up.
export function adjustments(log, beforeDate) {
  const adj = { pull: 0, dip: 0, push: 0 };
  let ticked = { pull: 0, dip: 0, push: 0 }; // sessions ticked this week, or -1 once one was missed
  let current = 0;

  for (const date of allDates()) {
    const w = week(date);
    if (w !== current) {
      for (const m of Object.keys(adj)) {
        if (!LIGHT_WEEKS.includes(current) && ticked[m] >= 2) adj[m] += STEP[m];
      }
      ticked = { pull: 0, dip: 0, push: 0 };
      current = w;
    }
    if (date >= beforeDate) break;

    const checks = log[date];
    if (kind(date) !== 'lift' || !checks?.some(Boolean)) continue;

    lift(w, weekday(date), adj).forEach((item, i) => {
      const m = item.move;
      if (!m) return;
      if (checks[i]) {
        if (ticked[m] >= 0) ticked[m]++;
      } else {
        ticked[m] = -1;
        adj[m] = Math.max(adj[m] - STEP[m], 1 - BASE[m][w]);
      }
    });
  }
  return adj;
}

// ---------- the block and streaks ----------

export function allDates() {
  const out = [];
  for (let d = FIRST; d <= LAST; d = addDays(d, 1)) out.push(d);
  return out;
}

// A day counts when every item is ticked.
export function counted(date, log) {
  const checks = log[date];
  if (!checks) return false;
  return workout(date).items.every((_, i) => checks[i]);
}

// Consecutive days counted. Today doesn't break it until it's over.
export function streaks(log, todayStr) {
  const days = allDates().filter((d) => d <= todayStr);
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = counted(d, log) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (const d of days.reverse()) {
    if (counted(d, log)) current++;
    else if (d !== todayStr) break;
  }
  return { current, longest };
}

// ---------- dates, as 'YYYY-MM-DD' strings ----------

function utc(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date, n) {
  return new Date(utc(date) + n * 86400000).toISOString().slice(0, 10);
}

// b - a in whole days
export function diffDays(a, b) {
  return Math.round((utc(b) - utc(a)) / 86400000);
}

// 0 = Sunday ... 6 = Saturday
export function weekday(date) {
  return new Date(utc(date)).getUTCDay();
}

function week(date) {
  return Math.floor(diffDays(FIRST, date) / 7);
}

// Today in Chicago, wherever the phone is.
export function today(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

// "Sun, Oct 11"
export function label(date) {
  return new Date(utc(date)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}
