import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST, LAST, workout, howMuch, addDays, weekday, today, label, allDates, streaks, adjustments, counted, totals, runMinutes } from '../site/plan.js';

// Tick every item of a day, except the ones listed in `skip`.
function tick(date, log, skip = []) {
  const w = workout(date, log);
  return { ...log, [date]: w.items.map((_, i) => !skip.includes(i)) };
}

test('a 90-day block, every day has something to tick', () => {
  assert.equal(allDates().length, 90);
  assert.equal(allDates().at(-1), LAST);
  for (const d of allDates()) {
    const w = workout(d);
    assert.ok(w.title && w.tag && w.items.length, d);
  }
  assert.equal(workout(addDays(FIRST, -1)), null);
  assert.equal(workout(addDays(LAST, 1)), null);
});

test('weekly pattern', () => {
  for (const d of allDates()) {
    const expected = { 0: 'Lift', 1: 'Run', 2: 'Lift', 3: 'Run', 4: 'Lift', 5: 'Rest', 6: 'Run' }[weekday(d)];
    const title = workout(d).title;
    if (d === '2026-10-18') assert.equal(title, 'Rest');
    else if (d === '2026-10-15' || d === '2026-12-31') assert.equal(title, 'Test');
    else assert.equal(title, expected, d);
  }
});

test('every item says plainly how much', () => {
  for (const d of allDates()) {
    for (const it of workout(d).items) {
      if (it.lines || workout(d).rest) continue;
      assert.match(howMuch(it), /^(\d+ × \d+( s)?|max)$/, `${d} ${it.name}`);
    }
  }
});

test('starting numbers and lighter weeks', () => {
  assert.deepEqual(workout('2026-10-19').items[0].lines[1], ['Run / walk', '8 × 1 min / 90 s']);
  assert.equal(howMuch(workout('2026-10-20').items[1]), '3 × 3'); // week 1 dips, light
  assert.equal(howMuch(workout('2026-10-27').items[1]), '4 × 3'); // week 2
  assert.equal(workout('2026-11-24').items[1].sets, 3); // week 6, Thanksgiving, light
});

test('hidden math: a ticked week steps up', () => {
  let log = tick('2026-10-11', {});
  log = tick('2026-10-13', log);
  assert.deepEqual(adjustments(log, '2026-10-13'), { pull: 0, dip: 0, push: 0 }); // week not over
  assert.deepEqual(adjustments(log, '2026-10-18'), { pull: 1, dip: 1, push: 2 });
  assert.equal(workout('2026-10-27', log).items[0].reps, 4); // week 2 pull-ups: 3 + 1
});

test('hidden math: leaving one unticked drops it, never below the minimum', () => {
  // Practice Sunday: pull, dip, push, squat, hollow. Pull-ups and push-ups left unticked.
  let log = tick('2026-10-11', {}, [0, 2]);
  assert.equal(workout('2026-10-13', log).items[0].reps, 3); // pull-ups already at the minimum
  assert.equal(workout('2026-10-13', log).items[2].reps, 10); // push-ups 12 - 2
  log = tick('2026-10-13', log, [0, 2]);
  assert.equal(workout('2026-10-20', log).items[0].reps, 3); // pull-ups floor
  assert.equal(adjustments(log, '2026-10-14').push, -2); // push-ups floor: a second drop from 10 is capped
  assert.equal(workout('2026-10-20', log).items[2].reps, 12); // week 1 base 14, still 2 down
  assert.equal(adjustments(log, '2026-10-18').dip, 1); // dips were ticked both times
});

test('hidden math: untouched days and light weeks change nothing', () => {
  assert.deepEqual(adjustments({}, LAST), { pull: 0, dip: 0, push: 0 });
  let log = {};
  for (const d of ['2026-10-18', '2026-10-20', '2026-10-22', '2026-10-25']) log = tick(d, log); // week 1 is light
  assert.deepEqual(adjustments(log, '2026-10-26'), { pull: 0, dip: 0, push: 0 });
});

test('a day counts only when everything is ticked', () => {
  const d = '2026-10-20';
  assert.equal(counted(d, {}), false);
  assert.equal(counted(d, tick(d, {}, [4])), false);
  assert.equal(counted(d, tick(d, {})), true);
  assert.equal(counted('2026-10-16', tick('2026-10-16', {})), true); // Friday rest
});

test('streaks include rest days and wait for today', () => {
  let log = {};
  for (const d of ['2026-10-15', '2026-10-16', '2026-10-17']) log = tick(d, log);
  assert.deepEqual(streaks(log, '2026-10-18'), { current: 3, longest: 3 }); // today not ticked yet
  assert.deepEqual(streaks(log, '2026-10-19'), { current: 0, longest: 3 }); // Sunday missed
});

test('totals: reps and run minutes ticked through a date', () => {
  // Practice Sunday: pull 2 × 3, dip 2 × 3, push 2 × 12, squat, hollow. Leave dips unticked.
  let log = tick('2026-10-11', {}, [1]);
  assert.deepEqual(totals(log, '2026-10-11'), { run: 0, pull: 6, dip: 0, push: 24 });
  // Practice Monday run: 6 × 30 s jogging = 3 min, plus nothing else.
  log = tick('2026-10-12', log);
  assert.equal(totals(log, '2026-10-12').run, 3);
  assert.equal(totals(log, '2026-10-11').run, 0); // later days don't count toward an earlier date
  assert.deepEqual(totals({}, LAST), { run: 0, pull: 0, dip: 0, push: 0 });
  // Week 1 Monday: 8 × 1 min run, then 2 × 7 push-ups (half of 14).
  log = tick('2026-10-19', {});
  assert.deepEqual(totals(log, '2026-10-19'), { run: 8, pull: 0, dip: 0, push: 14 });
});

test('run minutes leave out walking', () => {
  assert.equal(runMinutes([['Walk', '5 min'], ['Run', '20 min'], ['Walk', '5 min']]), 20);
  assert.equal(runMinutes([['Run / walk', '5 min / 2.5 min']]), 5);
  assert.equal(runMinutes([['Steady / easy', '6 × 1 min / 2 min']]), 18);
  assert.equal(runMinutes([['Strides', '4 × 20 s']]), 80 / 60);
  // Every run in the block parses.
  for (const d of allDates()) for (const it of workout(d).items) if (it.lines) assert.ok(runMinutes(it.lines) > 0, d);
});

test('dates', () => {
  assert.equal(today(new Date('2026-11-01T04:30:00Z')), '2026-10-31'); // 11:30pm in Chicago
  assert.equal(label('2026-10-11'), 'Sun, Oct 11');
});
