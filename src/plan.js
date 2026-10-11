// Turns the plan data + your saved state into the workout for a given date.
// Pure functions: no DOM, no storage. Everything here is covered by test/plan.test.js.

import running from './plan/running.json' with { type: 'json' };
import strength from './plan/strength.json' with { type: 'json' };
import about from './plan/about.json' with { type: 'json' };
import practice from './plan/practice.json' with { type: 'json' };
import { addDays, diffDays, weekday } from './dates.js';

export { running, strength, about, practice };

export const START = about.start; // Monday, Oct 19, 2026: first workout
export const WEEK1 = addDays(START, -1); // Sunday, Oct 18: weeks run Sunday through Saturday
export const PRACTICE = addDays(WEEK1, -7); // Sunday, Oct 11: optional practice week ("week 0")
export const TARGET = about.target; // Thursday, Dec 31, 2026
export const MOVEMENTS = ['pull', 'dip', 'push'];

// ---------- calendar ----------

export function dayType(date) {
  if (date < PRACTICE) return 'prep';
  return about.schedule[String(weekday(date))];
}

// Calendar training week, 1-based, Sunday through Saturday. Oct 18-24 is week 1.
// The practice week (Oct 11-17) is week 0, and so is everything before it.
export function isPractice(date) {
  return date >= PRACTICE && date < WEEK1;
}

export function calWeek(date) {
  if (date < WEEK1) return 0;
  return Math.floor(diffDays(WEEK1, date) / 7) + 1;
}

// The Sunday that opens calendar week c
export function weekStart(c) {
  return addDays(WEEK1, (c - 1) * 7);
}

export function weekDates(c) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart(c), i));
}

// A repeat entry r means "calendar week r + 1 repeats the program week of r".
// Weeks up to and including r keep their numbers, so finished history never changes.
function repeatsBefore(list, c) {
  return (list || []).filter((r) => r < c).length;
}

export function runWeek(state, c) {
  const startWeek = state.setup?.runStartWeek || 1;
  return c - repeatsBefore(state.repeats?.run, c) + (startWeek - 1);
}

export function liftWeek(state, c) {
  return c - repeatsBefore(state.repeats?.lift, c);
}

export function isRepeat(state, track, c) {
  return (state.repeats?.[track] || []).includes(c - 1);
}

// ---------- running ----------

const RUN_DAYS = { 1: 0, 3: 1, 6: 2 }; // Mon, Wed, Sat -> run index

export function runPlanWeek(p) {
  return running.weeks[Math.min(p, running.weeks.length) - 1];
}

function runSession(p, index) {
  const wk = runPlanWeek(p);
  let s = wk.runs[index];
  if (s.same) s = wk.runs[s.same - 1];
  return { wk, s };
}

function buildRun(state, date) {
  const c = calWeek(date);
  const p = runWeek(state, c);
  const index = RUN_DAYS[weekday(date)];
  const { wk, s } = runSession(p, index);
  return {
    type: 'run',
    title: s.check ? '5K check (optional)' : 'Run',
    planWeek: p,
    planLabel: wk.repeat ? `${wk.title}` : `${wk.title}, run ${index + 1} of 3`,
    proposal: !!wk.proposal,
    minutes: s.minutes,
    summary: s.summary,
    effort: running.effort,
    note: s.note || '',
    advance: wk.advance,
    isCheck: !!s.check,
    repeatOf: isRepeat(state, 'run', c),
    items: [
      { id: 'warmup', name: 'Warm-up', detail: running.warmup },
      { id: 'main', name: s.summary, steps: s.steps },
      { id: 'cooldown', name: 'Cool-down', detail: running.cooldown },
    ],
  };
}

// ---------- strength ----------

export function weekType(p) {
  const wt = strength.weekTypes;
  if (wt[String(p)]) return wt[String(p)];
  if (p >= wt.cycleFrom) return wt.cycle[(p - wt.cycleFrom) % wt.cycle.length];
  return 'normal';
}

// The session layout for a lifting date, before any rep targets are filled in.
export function sessionDef(state, date) {
  const c = calWeek(date);
  const p = liftWeek(state, c);
  const type = weekType(p);
  const day = weekday(date) === 2 ? 'A' : 'B';
  const key = type === 'test' ? `${day}_test` : day;
  const def = strength.sessions[key];
  const lighter = type === 'intro' || type === 'lighter';
  const items = def.items.map((it) => {
    const sets = it.sets ?? strength.accessories[it.accessory]?.sets ?? 1;
    return { ...it, sets: lighter && !it.test ? Math.max(1, sets - 1) : sets };
  });
  return { key, day, planWeek: p, weekType: type, title: def.title, focus: def.focus, minutes: def.minutes - (lighter ? 10 : 0), items };
}

function movementMode(m, max) {
  if (max == null) return 'unknown';
  return max < strength.movements[m].fullFrom ? 'regression' : 'working';
}

export function startReps(max) {
  const { startFraction, reserve } = strength.progression;
  return Math.max(1, Math.min(max - reserve, Math.round(max * startFraction)));
}

// "6, 6, 5" -> [6, 6, 5]
export function parseReps(s) {
  return String(s ?? '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
}

function initialWorking(state) {
  const out = {};
  for (const m of MOVEMENTS) {
    const max = numOrNull(state.setup?.[m]);
    const mode = movementMode(m, max);
    out[m] = { max, mode, W: mode === 'working' ? startReps(max) : null, source: max == null ? 'none' : 'setup' };
  }
  return out;
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

// How one lifting session went for one movement: clean | hard | short | skip | pain
export function outcome(log, item, W) {
  if (!log || log.status === 'skipped') return 'skip';
  if (log.pain) return 'pain';
  const m = item.movement;
  const total = item.sets + (item.long ? 1 : 0);
  const checked = Array.from({ length: total }, (_, i) => !!log.checks?.[`${m}:${i}`]).filter(Boolean).length;
  if (checked === 0 && !log.actual?.[m]?.reps) return log.status === 'done' ? 'short' : 'skip';
  const reps = parseReps(log.actual?.[m]?.reps);
  const missed = reps.some((r) => r < W) || (reps.length > 0 && reps.length < total);
  if (checked < total || missed) return 'short';
  return log.effort?.[m] === 'hard' ? 'hard' : 'clean';
}

// Replays your lifting logs up to (not including) `date` to get today's targets.
// Tests and first logged reps update immediately; weekly progression applies after a week ends.
export function workingState(state, date) {
  const w = initialWorking(state);
  const lastWeek = calWeek(date);
  for (let c = 1; c <= lastWeek; c++) {
    const results = { pull: [], dip: [], push: [] };
    let progressible = true;
    for (const d of [addDays(weekStart(c), 2), addDays(weekStart(c), 4)]) { // Tue, Thu
      if (d >= date) continue;
      const def = sessionDef(state, d);
      if (def.weekType === 'test' || def.weekType === 'lighter') progressible = false;
      const log = state.logs?.[d];
      const edited = !!state.edits?.[d];
      for (const item of def.items) {
        const m = item.movement;
        if (!m) continue;
        if (item.test) {
          const n = parseReps(log?.actual?.[m]?.reps)[0];
          if (!edited && n != null && log?.status !== 'skipped') {
            const mode = movementMode(m, n);
            const W = mode === 'working' ? Math.min(n - strength.progression.reserve, Math.max(w[m].W || 0, startReps(n))) : null;
            w[m] = { max: n, mode, W: W && W >= 1 ? W : mode === 'working' ? 1 : null, source: d };
          }
          continue;
        }
        if (w[m].mode === 'unknown') {
          const reps = parseReps(log?.actual?.[m]?.reps);
          if (!edited && reps.length && log?.status !== 'skipped') {
            const low = Math.min(...reps);
            const est = low + strength.progression.reserve;
            const mode = movementMode(m, est);
            w[m] = { max: est, mode, W: mode === 'working' ? Math.max(1, low) : null, source: d, estimated: true };
          }
          continue;
        }
        if (w[m].mode !== 'working') continue;
        results[m].push(edited ? 'skip' : outcome(log, item, w[m].W));
      }
    }
    // Weekly decision, only once the whole week is behind us.
    const weekOver = addDays(weekStart(c), 7) <= date;
    if (!weekOver || !progressible) continue;
    for (const m of MOVEMENTS) {
      const r = results[m];
      if (w[m].mode !== 'working' || r.length < 2) continue;
      const step = strength.movements[m].step;
      if (r.every((x) => x === 'clean')) {
        w[m] = { ...w[m], W: w[m].W + step, source: `week ${c}` };
      } else if (r.every((x) => x === 'short')) {
        w[m] = { ...w[m], W: Math.max(1, w[m].W - step), source: `week ${c}` };
      }
    }
  }
  return w;
}

function hasEquipment(state, key) {
  if (!key) return true;
  const v = state.setup?.equipment?.[key];
  return v !== false; // unknown counts as available; the alternative is shown alongside
}

function movementItem(state, item, ws, weekTypeName) {
  const mv = strength.movements[item.movement];
  const m = item.movement;
  const base = { id: m, movement: m, rest: item.rest, standard: mv.standard, goal: mv.goal };

  if (!hasEquipment(state, mv.needs) && mv.noEquipment) {
    const alt = mv.noEquipment;
    return { ...base, kind: 'alt', name: alt.name, detail: `${alt.sets} × ${alt.reps}`, how: alt.how, sets: setList(m, alt.sets, alt.reps), inputs: true };
  }

  if (item.test) {
    return {
      ...base,
      kind: 'test',
      name: `${mv.name}: clean-rep check`,
      detail: '1 set to the standard. Stop when the next rep would not be clean.',
      how: 'Warm up well first. Record the number of clean reps.',
      sets: [{ id: `${m}:0`, label: 'Done' }],
      inputs: true,
      testHint: ws.max != null ? `Last known: ${ws.max}${ws.estimated ? ' (estimated)' : ''}` : '',
    };
  }

  if (ws.mode === 'regression') {
    const useBands = state.setup?.equipment?.bands === true;
    const r = mv.regression[useBands ? 'bands' : 'none'];
    const sets = item.sets + (item.long ? 1 : 0);
    const other = !useBands && mv.regression.bands.name !== r.name ? ` With a resistance band: ${mv.regression.bands.name.toLowerCase()} instead.` : '';
    return {
      ...base,
      kind: 'regression',
      name: r.name,
      detail: `${Math.min(sets, r.sets)} × ${r.reps}`,
      how: r.how + other,
      sets: setList(m, Math.min(sets, r.sets), r.reps),
      inputs: true,
      hint: `Builds toward strict ${mv.name.toLowerCase()}. Your next check-in shows when to switch.`,
    };
  }

  if (ws.mode === 'unknown') {
    const sets = item.sets + (item.long ? 1 : 0);
    const reg = mv.regression.none;
    return {
      ...base,
      kind: 'unknown',
      name: mv.name,
      detail: `${sets} sets, each stopping with 2-3 clean reps left`,
      how: strength.progression.unknown,
      sets: setList(m, sets, ''),
      inputs: true,
      hint: `Can't do ${mv.fullFrom} clean reps yet? Do ${reg.name.toLowerCase()} (${reg.sets} × ${reg.reps}) and leave reps blank.`,
    };
  }

  const W = ws.W;
  const sets = [];
  if (item.long) {
    const L = ws.max != null ? Math.max(W, Math.min(ws.max - strength.progression.reserve, Math.round(W * 1.3))) : W;
    sets.push({ id: `${m}:0`, label: `${L}+`, long: true });
  }
  for (let i = 0; i < item.sets; i++) sets.push({ id: `${m}:${sets.length}`, label: String(W) });
  const longText = item.long ? `1 longer set of about ${sets[0].label.replace('+', '')} (stop with 2 clean reps left), then ` : '';
  const progressible = weekTypeName === 'normal' || weekTypeName === 'intro';
  return {
    ...base,
    kind: 'working',
    name: mv.name,
    detail: `${longText}${item.sets} × ${W}`,
    sets,
    inputs: true,
    target: W,
    hint: progressible ? `Next week: ${W + mv.step} per set if both sessions this week are clean.` : 'Targets hold this week.',
  };
}

function setList(m, n, label) {
  return Array.from({ length: n }, (_, i) => ({ id: `${m}:${i}`, label: String(label || i + 1) }));
}

function accessoryItem(state, item) {
  const a = strength.accessories[item.accessory];
  const useAlt = a.alt && !hasEquipment(state, a.needs);
  const unknownGear = a.alt && state.setup?.equipment?.[a.needs] == null;
  const name = useAlt ? a.alt.name : a.name;
  const reps = useAlt ? a.alt.reps : a.reps;
  const how = useAlt ? a.alt.how : a.how + (unknownGear ? ` No weights? ${a.alt.name}, ${a.alt.reps}.` : '');
  return {
    id: item.accessory,
    kind: 'accessory',
    name,
    detail: `${item.sets} × ${reps}`,
    rest: a.rest,
    how,
    sets: setList(item.accessory, item.sets, ''),
    inputs: true,
    weight: !useAlt && a.needs === 'weights',
  };
}

function buildLift(state, date) {
  const def = sessionDef(state, date);
  const ws = workingState(state, date);
  return {
    type: 'lift',
    title: def.title,
    planWeek: def.planWeek,
    planLabel: `Lifting week ${def.planWeek}`,
    weekType: def.weekType,
    weekNote: strength.weekTypeNotes[def.weekType],
    minutes: def.minutes,
    summary: 'Pull-ups, dips, push-ups, legs, trunk',
    focus: def.focus,
    warmup: strength.warmup,
    repeatOf: isRepeat(state, 'lift', calWeek(date)),
    proposal: true,
    items: def.items.map((it) => (it.movement ? movementItem(state, it, ws[it.movement], def.weekType) : accessoryItem(state, it))),
  };
}

// ---------- practice week ----------

function buildPractice(state, date) {
  if (dayType(date) === 'run') {
    const r = practice.run;
    return {
      type: 'run', title: r.title, planLabel: 'Practice week', practice: true, minutes: r.minutes, summary: r.summary,
      effort: running.effort, note: r.note, items: [
        { id: 'warmup', name: 'Warm-up', detail: running.warmup },
        { id: 'main', name: r.summary, steps: r.steps },
        { id: 'cooldown', name: 'Cool-down', detail: running.cooldown },
      ],
    };
  }
  const day = weekday(date) === 2 ? 'A' : 'B';
  const def = practice.lift[day];
  const ws = initialWorking(state);
  const moves = MOVEMENTS.map((m) => {
    if (def.check) return movementItem(state, { movement: m, test: true, rest: '3-5 min' }, ws[m], 'test');
    const mv = strength.movements[m];
    if (!hasEquipment(state, mv.needs) && mv.noEquipment) return movementItem(state, { movement: m, sets: def.movement.sets }, ws[m], 'normal');
    const reg = mv.regression.none;
    return {
      id: m, movement: m, kind: 'practice', name: mv.name, standard: mv.standard, rest: def.movement.rest,
      detail: def.movement.detail, how: def.movement.how, sets: setList(m, def.movement.sets, ''), inputs: true,
      hint: `Easier version: ${reg.name.toLowerCase()}, ${reg.sets} × ${reg.reps}.`,
    };
  });
  const acc = practice.lift.accessories.map((a, i) => ({
    id: `practice${i}`, kind: 'accessory', name: a.name, detail: `${a.sets} × ${a.reps}`, rest: a.rest, how: a.how,
    sets: setList(`practice${i}`, a.sets, ''), inputs: true,
  }));
  return {
    type: 'lift', title: def.title, planLabel: 'Practice week', practice: true, weekType: def.check ? 'test' : 'practice',
    weekNote: '', minutes: def.minutes, summary: 'Practice: pull-ups, dips, push-ups', focus: def.focus, warmup: strength.warmup,
    items: [...moves, ...acc],
  };
}

// Clean reps from the practice rep check, for "use as my starting numbers".
export function practiceChecks(state) {
  const out = {};
  for (let d = PRACTICE; d < WEEK1; d = addDays(d, 1)) {
    const l = state.logs?.[d];
    if (!l || l.status === 'skipped' || state.edits?.[d]) continue;
    for (const it of workoutFor(state, d).items) {
      if (it.kind !== 'test') continue;
      const n = parseReps(l.actual?.[it.id]?.reps)[0];
      if (n != null) out[it.id] = n;
    }
  }
  return out;
}

// ---------- public ----------

export function workoutFor(state, date) {
  const type = dayType(date);
  const c = calWeek(date);
  let w;
  if (type === 'prep') w = { type: 'prep', title: 'Before you start', items: [] };
  else if (type === 'rest') w = { type: 'rest', title: about.rest.title, summary: 'Optional easy walk', note: about.rest.text, items: [], practice: isPractice(date) };
  else if (isPractice(date)) w = buildPractice(state, date);
  else if (type === 'run') w = buildRun(state, date);
  else w = buildLift(state, date);
  w = { ...w, date, calWeek: c };

  const edit = state.edits?.[date];
  if (edit && type !== 'prep') w = applyEdit(w, edit);
  return w;
}

function applyEdit(w, edit) {
  if (edit.rest) {
    return { ...w, type: 'rest', originalType: w.type, title: 'Rest day', summary: 'Changed to rest', note: about.rest.text, items: [], edited: true };
  }
  const items = (edit.items || []).map((it, i) => ({
    id: `e${i}`,
    kind: 'edited',
    name: it.name,
    detail: it.detail || '',
    sets: [{ id: `e${i}:0`, label: 'Done' }],
    inputs: w.type === 'lift',
  }));
  return { ...w, title: edit.title || w.title, minutes: edit.minutes || w.minutes, note: edit.note ?? w.note, items, edited: true, focus: '', effort: w.effort };
}

// Plain-text lines for the edit form: "Name | detail"
export function itemsToText(w) {
  return w.items.map((it) => [it.name, it.detail || (it.steps || []).join('; ')].filter(Boolean).join(' | ')).join('\n');
}

export function textToItems(text) {
  return String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, ...rest] = l.split('|');
      return { name: name.trim(), detail: rest.join('|').trim() };
    });
}

export function isFinished(log) {
  return log?.status === 'done' || log?.status === 'skipped';
}

// ---------- repeats & projections ----------

export function canRepeat(state, track, today) {
  const c = calWeek(today);
  return c >= 1 && !(state.repeats?.[track] || []).includes(c);
}

export function repeatWeek(state, track, c) {
  const list = new Set(state.repeats?.[track] || []);
  list.add(c);
  return { ...state, repeats: { ...state.repeats, [track]: [...list].sort((a, b) => a - b) } };
}

export function undoRepeat(state, track, c) {
  return { ...state, repeats: { ...state.repeats, [track]: (state.repeats?.[track] || []).filter((r) => r !== c) } };
}

// Run days in a calendar week that were skipped, painful or marked hard.
export function runTrouble(state, c) {
  return weekDates(c)
    .filter((d) => dayType(d) === 'run' && !state.edits?.[d]?.rest)
    .filter((d) => {
      const l = state.logs?.[d];
      return l?.status === 'skipped' || l?.pain || l?.effort?.session === 'hard';
    });
}

function dateOfProgramWeek(state, track, p, wd) {
  const fn = track === 'run' ? runWeek : liftWeek;
  let last = null;
  for (let c = 1; c < 200; c++) {
    const pw = fn(state, c);
    if (pw === p) last = c;
    if (pw > p) break;
  }
  if (last == null) return null;
  return addDays(weekStart(last), wd);
}

// Honest projection: when week 9 (30 min) and the 5K check land, given repeats so far.
export function projections(state) {
  const run30 = dateOfProgramWeek(state, 'run', 9, 6);
  const check5k = dateOfProgramWeek(state, 'run', 11, 3);
  return { run30, check5k, run30Late: run30 > TARGET, checkLate: check5k > TARGET };
}
