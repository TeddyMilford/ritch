// Turns the log into progress numbers: reps per session, weekly totals, runs, consistency.
// Pure functions, like plan.js. Covered by test/progress.test.js.

import { addDays } from './dates.js';
import { MOVEMENTS, WEEK1, calWeek, weekStart, weekDates, workoutFor, workingState, parseReps } from './plan.js';

// Versions that count as the real movement. Regressions and no-equipment substitutes are tracked separately.
const FULL = ['working', 'unknown', 'test'];

// The version of movement m that was on the plan for that date.
function kindOn(state, date, m, log) {
  return log?.snapshot?.kinds?.[m] ?? workoutFor(state, date).items.find((i) => i.id === m)?.kind ?? null;
}

// Reps per set for movement m on one date, or null if nothing usable was logged.
export function movementLog(state, date, m) {
  const log = state.logs?.[date];
  if (!log || log.status === 'skipped') return null;
  const reps = parseReps(log.actual?.[m]?.reps);
  if (!reps.length) return null;
  const kind = kindOn(state, date, m, log);
  return { date, kind, full: FULL.includes(kind), test: kind === 'test', reps, best: Math.max(...reps), total: reps.reduce((a, b) => a + b, 0) };
}

// "31:20" or "1:02:05" -> seconds
export function parseTime(s) {
  const parts = String(s ?? '').trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((t, p) => t * 60 + Number(p), 0);
}

export function formatSeconds(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function datesThrough(today) {
  const out = [];
  for (let d = WEEK1; d <= today; d = addDays(d, 1)) out.push(d);
  return out;
}

// Everything the Progress screen shows, for all days up to and including `today`.
export function progress(state, today) {
  const days = datesThrough(today);
  const plans = Object.fromEntries(days.map((d) => [d, workoutFor(state, d)]));
  const current = workingState(state, addDays(today, 1));

  const movements = {};
  for (const m of MOVEMENTS) {
    const sessions = days.map((d) => movementLog(state, d, m)).filter(Boolean);
    const full = sessions.filter((s) => s.full);
    const tests = full.filter((s) => s.test);
    movements[m] = {
      sessions,
      full,
      total: full.reduce((a, s) => a + s.total, 0),
      bestSet: full.length ? Math.max(...full.map((s) => s.best)) : null,
      baseline: state.setup?.[m] ?? null,
      firstTest: tests[0]?.best ?? null,
      lastTest: tests.at(-1)?.best ?? null,
      max: current[m].max,
      estimated: !!current[m].estimated,
      mode: current[m].mode,
      target: current[m].W,
      easierSessions: sessions.length - full.length,
    };
  }

  const runs = days
    .filter((d) => plans[d].type === 'run')
    .map((d) => {
      const l = state.logs?.[d];
      return { date: d, title: plans[d].title, planLabel: plans[d].planLabel, planMinutes: plans[d].minutes, status: l?.status ?? null, distance: l?.distance || '', time: l?.time || '', seconds: parseTime(l?.time), effort: l?.effort?.session ?? null, pain: !!l?.pain };
    });

  const weeks = [];
  for (let c = 1; c <= calWeek(today); c++) {
    const wd = weekDates(c);
    const cells = wd.map((d) => ({ date: d, type: d > today ? 'future' : plans[d]?.type, status: state.logs?.[d]?.status ?? null }));
    const past = cells.filter((x) => x.type === 'run' || x.type === 'lift');
    const reps = {};
    for (const m of MOVEMENTS) reps[m] = movements[m].full.filter((s) => s.date >= wd[0] && s.date <= wd[6]).reduce((a, s) => a + s.total, 0);
    weeks.push({
      c,
      start: weekStart(c),
      cells,
      planned: past.length,
      done: past.filter((x) => x.status === 'done').length,
      skipped: past.filter((x) => x.status === 'skipped').length,
      runsDone: past.filter((x) => x.type === 'run' && x.status === 'done').length,
      liftsDone: past.filter((x) => x.type === 'lift' && x.status === 'done').length,
      reps,
      runSeconds: runs.filter((r) => r.date >= wd[0] && r.date <= wd[6] && r.status === 'done').reduce((a, r) => a + (r.seconds || 0), 0),
    });
  }

  // Workouts due so far. Today counts only once it's finished, so the morning doesn't look like a miss.
  const due = days.filter((d) => ['run', 'lift'].includes(plans[d].type) && (d < today || state.logs?.[d]?.status));
  const done = due.filter((d) => state.logs?.[d]?.status === 'done').length;

  return {
    movements,
    runs,
    weeks,
    due: due.length,
    done,
    skipped: due.filter((d) => state.logs?.[d]?.status === 'skipped').length,
    runsDone: runs.filter((r) => r.status === 'done').length,
    runSeconds: runs.filter((r) => r.status === 'done').reduce((a, r) => a + (r.seconds || 0), 0),
    longestRun: Math.max(0, ...runs.filter((r) => r.status === 'done').map((r) => r.seconds || 0)),
  };
}

// Rest strings from the plan ("2-3 min", "90 sec", "60-90 sec") -> the low end, in seconds.
export function restSeconds(text) {
  const m = String(text ?? '').match(/(\d+)(?:\s*-\s*\d+)?\s*(min|sec)/);
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'min' ? 60 : 1);
}
