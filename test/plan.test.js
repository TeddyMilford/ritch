import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayStr, addDays, diffDays, weekday, mondayOf, isDate } from '../src/dates.js';
import {
  START, TARGET, dayType, calWeek, runWeek, liftWeek, workoutFor, workingState, repeatWeek, undoRepeat,
  projections, weekStart, sessionDef, isPractice, practiceChecks, startReps, parseReps, outcome, weekType, textToItems, runTrouble,
} from '../src/plan.js';
import { emptyState, migrate, exportJSON, importJSON, load, save, STORAGE_KEY } from '../src/store.js';

const fresh = () => emptyState();

// ---------- dates ----------

test('today is computed in America/Chicago, across midnight and DST', () => {
  // 2026-10-20 04:59 UTC = Oct 19, 11:59 pm CDT
  assert.equal(todayStr(new Date('2026-10-20T04:59:00Z')), '2026-10-19');
  assert.equal(todayStr(new Date('2026-10-20T05:00:00Z')), '2026-10-20');
  // DST ends Nov 1, 2026: after that midnight is 06:00 UTC
  assert.equal(todayStr(new Date('2026-11-02T05:30:00Z')), '2026-11-01');
  assert.equal(todayStr(new Date('2026-11-02T06:00:00Z')), '2026-11-02');
  // DST starts Mar 14, 2027
  assert.equal(todayStr(new Date('2027-03-15T04:59:00Z')), '2027-03-14');
  assert.equal(todayStr(new Date('2027-03-15T05:00:00Z')), '2027-03-15');
});

test('date arithmetic is day-exact across DST', () => {
  assert.equal(addDays('2026-10-31', 2), '2026-11-02');
  assert.equal(diffDays('2026-10-19', '2026-12-31'), 73);
  assert.equal(weekday('2026-10-19'), 1);
  assert.equal(weekday('2026-12-31'), 4);
  assert.equal(mondayOf('2026-11-05'), '2026-11-02');
  assert.ok(isDate('2026-02-28') && !isDate('2026-02-30') && !isDate('x'));
});

// ---------- schedule ----------

test('plan starts Monday Oct 19, 2026 and target is Thursday Dec 31', () => {
  assert.equal(START, '2026-10-19');
  assert.equal(TARGET, '2026-12-31');
  assert.equal(dayType('2026-10-10'), 'prep');
  assert.equal(dayType('2026-10-17'), 'run', 'practice week Saturday');
  assert.equal(dayType('2026-10-18'), 'rest', 'Sunday Oct 18 opens week 1');
  assert.equal(dayType('2026-10-19'), 'run');
  assert.equal(dayType('2026-10-20'), 'lift');
});

test('weeks run Sunday through Saturday', () => {
  assert.equal(calWeek('2026-10-17'), 0);
  assert.equal(calWeek('2026-10-18'), 1);
  assert.equal(calWeek('2026-10-24'), 1, 'Saturday ends week 1');
  assert.equal(calWeek('2026-10-25'), 2, 'Sunday starts week 2');
  assert.equal(weekStart(2), '2026-10-25');
  assert.equal(weekday(weekStart(9)), 0);
  assert.equal(calWeek('2026-12-14'), 9);
  assert.equal(calWeek('2026-12-20'), 10);
  assert.equal(calWeek('2026-12-31'), 11);
});

test('every weekday has the fixed type for a whole year, even with repeats and edits elsewhere', () => {
  const expected = { 0: 'lift', 1: 'run', 2: 'lift', 3: 'run', 4: 'lift', 5: 'rest', 6: 'run' };
  let s = repeatWeek(repeatWeek(fresh(), 'run', 2), 'lift', 4);
  for (let i = 0; i < 365; i++) {
    const d = addDays(START, i);
    assert.equal(dayType(d), expected[weekday(d)], d);
    assert.equal(workoutFor(s, d).type, expected[weekday(d)], d);
  }
});

test('no two run days are ever consecutive', () => {
  for (let i = 0; i < 365; i++) {
    const d = addDays(START, i);
    if (dayType(d) === 'run') assert.notEqual(dayType(addDays(d, 1)), 'run', d);
  }
});

test('first run and first lift show the right content', () => {
  const run = workoutFor(fresh(), '2026-10-19');
  assert.equal(run.type, 'run');
  assert.equal(run.planWeek, 1);
  assert.deepEqual(run.items.map((i) => i.id), ['warmup', 'main', 'cooldown', 'push']);
  assert.match(run.items[1].steps.join(' '), /Run 1 min, walk 90 sec/);
  const lift = workoutFor(fresh(), '2026-10-20');
  assert.equal(lift.type, 'lift');
  assert.equal(lift.weekType, 'intro');
  assert.deepEqual(lift.items.slice(0, 3).map((i) => i.movement), ['pull', 'dip', 'push']);
  assert.equal(workoutFor(fresh(), '2026-10-22').title, 'Strength B');
});

test('Couch to 5K week 9 lands Dec 14-20 and the 5K check on Wed Dec 30', () => {
  assert.equal(workoutFor(fresh(), '2026-12-14').planWeek, 9);
  assert.equal(workoutFor(fresh(), '2026-12-19').items[1].steps[0], 'Run 30 min without walking');
  assert.equal(workoutFor(fresh(), '2026-12-30').isCheck, true);
  const p = projections(fresh());
  assert.equal(p.run30, '2026-12-19');
  assert.equal(p.check5k, '2026-12-30');
  assert.equal(p.run30Late, false);
});

test('week 5 uses three distinct runs from the NHS plan', () => {
  const mins = ['2026-11-16', '2026-11-18', '2026-11-21'].map((d) => workoutFor(fresh(), d).items[1].steps.join(' '));
  assert.match(mins[0], /Run 5 min/);
  assert.match(mins[1], /Run 8 min/);
  assert.match(mins[2], /20 min/);
});

test('after the plan ends the ongoing week repeats indefinitely', () => {
  const w = workoutFor(fresh(), '2027-03-01');
  assert.equal(w.type, 'run');
  assert.match(w.planLabel, /Ongoing/);
});

// ---------- repeats ----------

test('repeating a week shifts only later weeks and keeps weekdays', () => {
  let s = fresh();
  s.logs['2026-10-26'] = { status: 'done' };
  s = repeatWeek(s, 'run', 2); // week 3 repeats week 2
  assert.equal(runWeek(s, 2), 2);
  assert.equal(runWeek(s, 3), 2);
  assert.equal(runWeek(s, 4), 3);
  assert.equal(liftWeek(s, 3), 3, 'lifting is unaffected by a run repeat');
  assert.equal(workoutFor(s, '2026-10-26').planWeek, 2, 'past week unchanged');
  assert.equal(workoutFor(s, '2026-11-02').planWeek, 2);
  assert.equal(workoutFor(s, '2026-11-02').repeatOf, true);
  assert.deepEqual(s.logs['2026-10-26'], { status: 'done' }, 'history untouched');
  const p = projections(s);
  assert.equal(p.run30, '2026-12-26');
  assert.equal(p.check5k, '2027-01-06');
  assert.equal(p.checkLate, true, 'honestly lands after Dec 31');
  assert.equal(runWeek(undoRepeat(s, 'run', 2), 3), 3);
});

test('a run start week from setup offsets the running plan', () => {
  const s = fresh();
  s.setup.runStartWeek = 3;
  assert.equal(workoutFor(s, '2026-10-19').planWeek, 3);
});

test('missed workouts do not move or double anything', () => {
  const s = fresh();
  s.logs['2026-10-19'] = { status: 'skipped' };
  const before = workoutFor(fresh(), '2026-10-21');
  const after = workoutFor(s, '2026-10-21');
  assert.deepEqual(after.items, before.items);
  assert.equal(after.minutes, before.minutes);
  assert.deepEqual(runTrouble(s, 1), ['2026-10-19']);
});

// ---------- strength ----------

test('unknown baselines give effort-based work, never zero', () => {
  const lift = workoutFor(fresh(), '2026-10-20');
  const pull = lift.items[0];
  assert.equal(pull.kind, 'unknown');
  assert.match(pull.detail, /2-3 clean reps left/);
  assert.equal(workingState(fresh(), '2026-10-20').pull.max, null);
});

test('starting reps leave at least 2 in reserve', () => {
  for (let max = 3; max <= 120; max++) {
    const w = startReps(max);
    assert.ok(w >= 1 && w <= max - 2, `max ${max} -> ${w}`);
  }
  assert.equal(startReps(10), 6);
});

test('known baselines produce targets; low baselines get regressions', () => {
  const s = fresh();
  Object.assign(s.setup, { pull: 1, dip: 10, push: 20 });
  const lift = workoutFor(s, '2026-10-27');
  const [pull, dip, push] = lift.items;
  assert.equal(pull.kind, 'regression');
  assert.equal(dip.kind, 'working');
  assert.equal(dip.target, 6);
  assert.equal(push.target, 12);
});

test('missing equipment swaps in a substitute', () => {
  const s = fresh();
  s.setup.equipment.bar = false;
  s.setup.equipment.weights = false;
  const lift = workoutFor(s, '2026-10-27');
  assert.equal(lift.items[0].name, 'Inverted rows');
  assert.equal(lift.items[3].name, 'Bodyweight squat');
});

function logSession(s, date, m, sets, opts = {}) {
  const def = sessionDef(s, date);
  const item = def.items.find((i) => i.movement === m);
  const total = item.sets + (item.long ? 1 : 0);
  s.logs[date] ??= { status: 'done', checks: {}, actual: {}, effort: {} };
  for (let i = 0; i < Math.min(total, sets ?? total); i++) s.logs[date].checks[`${m}:${i}`] = true;
  if (opts.effort) s.logs[date].effort[m] = opts.effort;
  if (opts.reps) s.logs[date].actual[m] = { reps: opts.reps };
  if (opts.pain) s.logs[date].pain = true;
}

test('progression adds a step only after a clean week, and only once the week is over', () => {
  const s = fresh();
  s.setup.dip = 10; // W = 6
  logSession(s, '2026-10-20', 'dip');
  logSession(s, '2026-10-22', 'dip');
  assert.equal(workingState(s, '2026-10-24').dip.W, 6, 'not mid-week');
  assert.equal(workingState(s, '2026-10-27').dip.W, 7);
});

test('a hard, painful, short or skipped session holds the target', () => {
  for (const variant of ['hard', 'pain', 'short', 'skip']) {
    const s = fresh();
    s.setup.dip = 10;
    logSession(s, '2026-10-20', 'dip');
    if (variant === 'hard') logSession(s, '2026-10-22', 'dip', null, { effort: 'hard' });
    if (variant === 'pain') logSession(s, '2026-10-22', 'dip', null, { pain: true });
    if (variant === 'short') logSession(s, '2026-10-22', 'dip', 0);
    if (variant === 'skip') s.logs['2026-10-22'] = { status: 'skipped' };
    assert.equal(workingState(s, '2026-10-27').dip.W, 6, variant);
  }
});

test('logging fewer reps than the target counts as short', () => {
  const item = { movement: 'push', sets: 2, long: false };
  const log = { status: 'done', checks: { 'push:0': true, 'push:1': true }, actual: { push: { reps: '12, 9' } } };
  assert.equal(outcome(log, item, 12), 'short');
  log.actual.push.reps = '12, 12';
  assert.equal(outcome(log, item, 12), 'clean');
});

test('two short sessions in a week step the target down', () => {
  const s = fresh();
  s.setup.push = 20; // W = 12
  logSession(s, '2026-10-20', 'push', 0, { reps: '8' });
  logSession(s, '2026-10-22', 'push', 0, { reps: '7' });
  assert.equal(workingState(s, '2026-10-27').push.W, 10);
});

test('lighter and check-in weeks never progress', () => {
  assert.equal(weekType(5), 'test');
  assert.equal(weekType(6), 'lighter');
  assert.equal(weekType(11), 'test');
  assert.equal(weekType(16), 'test');
  const s = fresh();
  s.setup.dip = 10;
  logSession(s, '2026-11-24', 'dip');
  logSession(s, '2026-11-26', 'dip');
  assert.equal(workingState(s, '2026-11-30').dip.W, 6);
});

test('first logged reps set the target when the baseline was unknown', () => {
  const s = fresh();
  s.logs['2026-10-20'] = { status: 'done', checks: {}, actual: { pull: { reps: '5, 4, 4' } }, effort: {} };
  const w = workingState(s, '2026-10-22');
  assert.equal(w.pull.W, 4);
  assert.equal(w.pull.mode, 'working');
  assert.equal(workoutFor(s, '2026-10-22').items[0].kind, 'working');
});

test('an optional rep check updates the max and targets', () => {
  const s = fresh();
  s.setup.pull = 5; // W = 3
  s.logs['2026-11-17'] = { status: 'done', checks: { 'pull:0': true }, actual: { pull: { reps: '12' } }, effort: {} };
  assert.equal(workoutFor(s, '2026-11-17').items[0].kind, 'test');
  const w = workingState(s, '2026-11-19');
  assert.equal(w.pull.max, 12);
  assert.equal(w.pull.W, 7);
  // A skipped check changes nothing
  const t = fresh();
  t.setup.pull = 5;
  t.logs['2026-11-17'] = { status: 'skipped' };
  assert.equal(workingState(t, '2026-11-19').pull.W, 3);
});

test('repeating a lifting week moves the check-in later without touching history', () => {
  const s = repeatWeek(fresh(), 'lift', 4);
  assert.equal(sessionDef(s, '2026-11-17').weekType, 'normal');
  assert.equal(sessionDef(s, '2026-11-24').weekType, 'test');
});

// ---------- edits ----------

test('editing a future workout replaces items; rest edits keep the weekday free', () => {
  const s = fresh();
  s.edits['2026-10-21'] = { title: 'Short run', minutes: 20, items: textToItems('Walk | 5 min\nRun easy | 10 min'), note: '' };
  const w = workoutFor(s, '2026-10-21');
  assert.equal(w.edited, true);
  assert.equal(w.title, 'Short run');
  assert.deepEqual(w.items.map((i) => i.name), ['Walk', 'Run easy']);
  s.edits['2026-10-22'] = { rest: true };
  assert.equal(workoutFor(s, '2026-10-22').type, 'rest');
  assert.equal(workoutFor(s, '2026-10-23').type, 'rest');
});

test('parseReps', () => {
  assert.deepEqual(parseReps('6, 6,5'), [6, 6, 5]);
  assert.deepEqual(parseReps(''), []);
  assert.deepEqual(parseReps(undefined), []);
});

// ---------- storage ----------

test('migrate cleans data and never turns unknown into zero', () => {
  const m = migrate({ setup: { pull: '', dip: 'abc', push: 0 }, logs: { bad: {}, '2026-10-19': { status: 'done', checks: { main: true, x: 'yes' } } } });
  assert.equal(m.setup.pull, null);
  assert.equal(m.setup.dip, null);
  assert.equal(m.setup.push, 0, 'an explicit 0 is kept');
  assert.deepEqual(Object.keys(m.logs), ['2026-10-19']);
  assert.deepEqual(m.logs['2026-10-19'].checks, { main: true });
});

test('export -> import round-trips everything', () => {
  const s = fresh();
  s.setup.pull = 4;
  s.setup.limitations = 'left knee';
  s.logs['2026-10-19'] = { status: 'done', checks: { main: true }, actual: {}, effort: { session: 'right' }, pain: false, note: 'felt fine', distance: '3.1', time: '29:00' };
  s.edits['2026-10-28'] = { rest: true };
  const s2 = repeatWeek(s, 'run', 1);
  const back = importJSON(exportJSON(migrate(s2)));
  assert.equal(back.setup.pull, 4);
  assert.equal(back.setup.limitations, 'left knee');
  assert.equal(back.logs['2026-10-19'].note, 'felt fine');
  assert.equal(back.logs['2026-10-19'].effort.session, 'right');
  assert.deepEqual(back.edits['2026-10-28'], { rest: true });
  assert.deepEqual(back.repeats.run, [1]);
  assert.throws(() => importJSON('{"hello":1}'), /backup/);
  assert.throws(() => importJSON('nope'), /JSON/);
});

test('save/load use one stable key', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = fresh();
  s.logs['2026-10-19'] = { status: 'done' };
  save(s, storage);
  assert.ok(mem.has(STORAGE_KEY));
  assert.equal(load(storage).logs['2026-10-19'].status, 'done');
});

// ---------- practice week ----------

test('practice week Oct 11-17 is easier, same weekdays, and week 1 is unchanged', () => {
  assert.equal(isPractice('2026-10-10'), false);
  assert.equal(isPractice('2026-10-11'), true);
  assert.equal(isPractice('2026-10-17'), true);
  assert.equal(isPractice('2026-10-18'), false);
  assert.equal(calWeek('2026-10-14'), 0);
  const types = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'].map((d) => workoutFor(fresh(), d).type);
  assert.deepEqual(types, ['lift', 'run', 'lift', 'run', 'lift', 'rest', 'run']);
  assert.equal(workoutFor(fresh(), '2026-10-11').items[0].kind, 'practice', 'practice Sunday is easy sets');
  const run = workoutFor(fresh(), '2026-10-12');
  assert.equal(run.title, 'Practice run');
  assert.ok(run.minutes < workoutFor(fresh(), '2026-10-19').minutes);
  assert.deepEqual(workoutFor(fresh(), '2026-10-13').items.slice(0, 3).map((i) => i.kind), ['practice', 'practice', 'practice']);
  assert.deepEqual(workoutFor(fresh(), '2026-10-15').items.slice(0, 3).map((i) => i.kind), ['test', 'test', 'test']);
  assert.equal(START, '2026-10-19');
  assert.equal(workoutFor(fresh(), '2026-10-19').planLabel, 'Couch to 5K, week 1, run 1 of 3');
});

test('practice logs never change week 1 targets unless used as starting numbers', () => {
  const s = fresh();
  s.logs['2026-10-13'] = { status: 'done', actual: { pull: { reps: '4, 4' } } };
  s.logs['2026-10-15'] = { status: 'done', actual: { pull: { reps: '9' }, dip: { reps: '12' } } };
  assert.equal(workingState(s, '2026-10-20').pull.mode, 'unknown');
  assert.deepEqual(practiceChecks(s), { pull: 9, dip: 12 });
  s.setup.pull = 9;
  assert.equal(workingState(s, '2026-10-20').pull.W, 5);
});

// ---------- three lifting days ----------

test('Sunday Oct 18 stays rest so the first workout is Monday; Sunday lifting starts Oct 25', () => {
  assert.equal(dayType('2026-10-18'), 'rest');
  const c = workoutFor(fresh(), '2026-10-25');
  assert.equal(c.type, 'lift');
  assert.equal(c.title, 'Strength C');
  assert.deepEqual(c.items.slice(0, 3).map((i) => i.movement), ['push', 'pull', 'dip'], 'push-ups first on Sunday');
});

test('more sets: A 5/4/3, B long set + 3 each, C push-up volume', () => {
  const s = fresh();
  s.setup = { ...s.setup, pull: 8, dip: 10, push: 20 };
  const sets = (d) => Object.fromEntries(workoutFor(s, d).items.filter((i) => i.movement).map((i) => [i.movement, i.sets.length]));
  assert.deepEqual(sets('2026-10-27'), { pull: 5, dip: 4, push: 3 });
  assert.deepEqual(sets('2026-10-29'), { pull: 4, push: 4, dip: 3 });
  assert.deepEqual(sets('2026-10-25'), { push: 5, pull: 4, dip: 3 });
  assert.deepEqual(sets('2026-11-15'), { push: 2, pull: 2, dip: 2 }, 'check-in week Sunday is light');
});

test('progression needs all three sessions in a week to be clean', () => {
  const s = fresh();
  s.setup = { ...s.setup, pull: 10 };
  const clean = { status: 'done', checks: Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`pull:${i}`, true])), actual: {} };
  for (const d of ['2026-10-25', '2026-10-27', '2026-10-29']) s.logs[d] = clean;
  assert.equal(workingState(s, '2026-11-01').pull.W, 7, '6 + 1 after a clean week');
  s.logs['2026-10-29'] = { status: 'skipped' };
  assert.equal(workingState(s, '2026-11-01').pull.W, 6, 'a skipped session holds the target');
});

test('run days add easy push-up practice at half the working target', () => {
  const s = fresh();
  s.setup = { ...s.setup, push: 20 };
  const push = workoutFor(s, '2026-10-21').items.find((i) => i.movement === 'push');
  assert.equal(push.detail, '2 × 6'); // working 12
  assert.equal(push.addon, true);
  assert.equal(workoutFor(fresh(), '2026-10-12').items.some((i) => i.movement), false, 'practice week runs stay plain');
});
