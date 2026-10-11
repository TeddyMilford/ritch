import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, migrate } from '../src/store.js';
import { progress, movementLog, parseTime, formatSeconds, restSeconds } from '../src/progress.js';

function withPull(max) {
  const s = emptyState();
  s.setup.pull = max;
  s.setup.dip = 10;
  return s;
}

test('parseTime and formatSeconds', () => {
  assert.equal(parseTime('31:20'), 1880);
  assert.equal(parseTime('1:02:05'), 3725);
  assert.equal(parseTime('31 min'), null);
  assert.equal(parseTime(''), null);
  assert.equal(formatSeconds(1880), '31:20');
  assert.equal(formatSeconds(3725), '1:02:05');
  assert.equal(formatSeconds(5), '0:05');
});

test('restSeconds takes the low end of the plan text', () => {
  assert.equal(restSeconds('2-3 min'), 120);
  assert.equal(restSeconds('90 sec'), 90);
  assert.equal(restSeconds('60-90 sec'), 60);
  assert.equal(restSeconds(undefined), null);
});

test('movementLog reads reps per set and which version was done', () => {
  const s = withPull(10);
  s.logs['2026-10-20'] = { status: 'done', actual: { pull: { reps: '6, 6, 5, 5' } } };
  const x = movementLog(s, '2026-10-20', 'pull');
  assert.deepEqual(x.reps, [6, 6, 5, 5]);
  assert.equal(x.best, 6);
  assert.equal(x.total, 22);
  assert.equal(x.kind, 'working');
  assert.equal(x.full, true);
  s.logs['2026-10-22'] = { status: 'skipped', actual: { pull: { reps: '6' } } };
  assert.equal(movementLog(s, '2026-10-22', 'pull'), null, 'skipped days do not count');
});

test('easier versions are tracked but kept out of full-movement totals', () => {
  const s = withPull(1); // below 3: regression
  s.logs['2026-10-20'] = { status: 'done', actual: { pull: { reps: '5, 5, 5' } } };
  const p = progress(s, '2026-10-21');
  assert.equal(p.movements.pull.total, 0);
  assert.equal(p.movements.pull.easierSessions, 1);
});

test('the version saved at Finish wins over a recomputed plan', () => {
  const s = withPull(1);
  s.logs['2026-10-20'] = { status: 'done', actual: { pull: { reps: '4, 4' } }, snapshot: { type: 'lift', title: 'Strength A', summary: '', kinds: { pull: 'working' } } };
  assert.equal(movementLog(migrate(s), '2026-10-20', 'pull').full, true);
});

test('progress sums weeks Sunday to Saturday and counts consistency fairly', () => {
  const s = withPull(10);
  s.logs['2026-10-19'] = { status: 'done', time: '29:10', effort: { session: 'right' } };
  s.logs['2026-10-20'] = { status: 'done', actual: { pull: { reps: '6, 6, 6, 6' }, dip: { reps: '6, 6, 6' } } };
  s.logs['2026-10-21'] = { status: 'skipped' };
  s.logs['2026-10-25'] = { status: null }; // Sunday rest, week 2
  const p = progress(s, '2026-10-22'); // Thursday: today, not yet logged

  assert.equal(p.weeks.length, 1);
  assert.equal(p.weeks[0].start, '2026-10-18');
  assert.deepEqual(p.weeks[0].cells.map((c) => c.type), ['rest', 'run', 'lift', 'run', 'lift', 'future', 'future']);
  assert.equal(p.due, 3, "today's open workout is not counted as missed");
  assert.equal(p.done, 2);
  assert.equal(p.skipped, 1);
  assert.equal(p.weeks[0].reps.pull, 24);
  assert.equal(p.weeks[0].reps.dip, 18);
  assert.equal(p.runsDone, 1);
  assert.equal(p.runSeconds, 1750);
  assert.equal(p.movements.pull.bestSet, 6);
  assert.equal(p.movements.pull.baseline, 10);

  const next = progress(s, '2026-10-25');
  assert.equal(next.weeks.length, 2, 'Sunday opens week 2');
});

test('rep checks give a before and after', () => {
  const s = withPull(10);
  s.logs['2026-11-17'] = { status: 'done', actual: { pull: { reps: '11' } } }; // week 5 Tuesday check
  s.logs['2026-12-29'] = { status: 'done', actual: { pull: { reps: '14' } } }; // week 11 Tuesday check
  const p = progress(s, '2026-12-31');
  assert.equal(p.movements.pull.firstTest, 11);
  assert.equal(p.movements.pull.lastTest, 14);
  assert.equal(p.movements.pull.max, 14);
});

test('migrate keeps timing fields and drops junk', () => {
  const m = migrate({ logs: { '2026-10-19': { status: 'done', startedAt: '2026-10-19T12:00:00Z', finishedAt: '2026-10-19T12:35:00Z', clockStart: null, clockSec: 1750, snapshot: { type: 'lift', title: 'A', kinds: { pull: 'working', bad: 5 } } } } });
  const l = m.logs['2026-10-19'];
  assert.equal(l.clockSec, 1750);
  assert.equal(l.startedAt, '2026-10-19T12:00:00Z');
  assert.deepEqual(l.snapshot.kinds, { pull: 'working' });
  assert.equal(migrate({ logs: { '2026-10-19': { clockSec: 'x' } } }).logs['2026-10-19'].clockSec, 0);
});
