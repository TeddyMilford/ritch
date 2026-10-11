// Local, on-device storage. One localStorage key holds everything.
// The key and shape are stable across app updates; `migrate` upgrades older data in place.

import { isDate } from './dates.js';

export const STORAGE_KEY = 'workout.v1';
let key = STORAGE_KEY;

// Testing mode stores under a different key so practice logs never mix with real ones.
export function useStorageKey(k) {
  key = k;
}
export const SCHEMA = 1;

export function emptyState() {
  return {
    schema: SCHEMA,
    setup: {
      pull: null, // null = "I don't know yet", never zero
      dip: null,
      push: null,
      jogMinutes: null,
      runStartWeek: 1,
      equipment: { bar: null, dipBars: null, bands: null, weights: null, parallettes: null },
      limitations: '',
    },
    // 'YYYY-MM-DD' -> { status, checks, actual, effort, pain, note, distance, time, snapshot,
    //                  startedAt, finishedAt, clockStart, clockSec }
    logs: {},
    edits: {}, // 'YYYY-MM-DD' -> { rest } or { title, minutes, items, note }
    repeats: { run: [], lift: [] },
    meta: { createdAt: null, updatedAt: null, persistRequested: false },
  };
}

function num(v, min = 0, max = 1000) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}

function bool(v) {
  return v === true ? true : v === false ? false : null;
}

function str(v, max = 2000) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

// Accepts anything (old data, imported JSON) and returns a clean, current-schema state.
export function migrate(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw.setup || {};
  const eq = s.equipment || {};
  const out = {
    schema: SCHEMA,
    setup: {
      pull: num(s.pull),
      dip: num(s.dip),
      push: num(s.push),
      jogMinutes: num(s.jogMinutes, 0, 300),
      runStartWeek: num(s.runStartWeek, 1, 9) || 1,
      equipment: { bar: bool(eq.bar), dipBars: bool(eq.dipBars), bands: bool(eq.bands), weights: bool(eq.weights), parallettes: bool(eq.parallettes) },
      limitations: str(s.limitations),
    },
    logs: {},
    edits: {},
    repeats: {
      run: cleanWeeks(raw.repeats?.run),
      lift: cleanWeeks(raw.repeats?.lift),
    },
    meta: { ...base.meta, ...(raw.meta && typeof raw.meta === 'object' ? raw.meta : {}) },
  };
  for (const [d, l] of Object.entries(raw.logs || {})) {
    if (!isDate(d) || !l || typeof l !== 'object') continue;
    out.logs[d] = {
      status: l.status === 'done' || l.status === 'skipped' ? l.status : null,
      checks: cleanFlags(l.checks),
      actual: cleanActual(l.actual),
      effort: cleanEffort(l.effort),
      pain: l.pain === true,
      note: str(l.note),
      distance: str(l.distance, 20),
      time: str(l.time, 20),
      snapshot: l.snapshot && typeof l.snapshot === 'object' ? { type: str(l.snapshot.type, 10), title: str(l.snapshot.title, 200), summary: str(l.snapshot.summary, 300), kinds: cleanKinds(l.snapshot.kinds) } : null,
      updatedAt: str(l.updatedAt, 40) || null,
      startedAt: str(l.startedAt, 40) || null, // first set or check logged
      finishedAt: str(l.finishedAt, 40) || null,
      clockStart: str(l.clockStart, 40) || null, // run timer: running since (null when paused)
      clockSec: num(l.clockSec, 0, 86400) || 0, // run timer: seconds banked before clockStart
    };
  }
  for (const [d, e] of Object.entries(raw.edits || {})) {
    if (!isDate(d) || !e || typeof e !== 'object') continue;
    if (e.rest === true) out.edits[d] = { rest: true };
    else if (Array.isArray(e.items)) {
      out.edits[d] = {
        title: str(e.title, 120),
        minutes: num(e.minutes, 0, 600),
        note: str(e.note),
        items: e.items.filter((i) => i && typeof i.name === 'string').map((i) => ({ name: str(i.name, 200), detail: str(i.detail, 500) })),
      };
    }
  }
  return out;
}

function cleanWeeks(a) {
  return Array.isArray(a) ? [...new Set(a.filter((n) => Number.isInteger(n) && n >= 1 && n < 500))].sort((x, y) => x - y) : [];
}

function cleanFlags(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (v === true) out[k.slice(0, 40)] = true;
  return out;
}

function cleanActual(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (!v || typeof v !== 'object') continue;
    out[k.slice(0, 40)] = { reps: str(v.reps, 60), weight: str(v.weight, 30) };
  }
  return out;
}

// Which version of each movement was done that day: working, test, regression, alt...
function cleanKinds(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (typeof v === 'string') out[k.slice(0, 40)] = v.slice(0, 20);
  return out;
}

function cleanEffort(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (['easy', 'right', 'hard'].includes(v)) out[k.slice(0, 40)] = v;
  return out;
}

// ---------- browser persistence ----------

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(key);
    return raw ? migrate(JSON.parse(raw)) : emptyState();
  } catch (e) {
    console.warn('Could not read saved data', e);
    return emptyState();
  }
}

export function save(state, storage = globalThis.localStorage) {
  const now = new Date().toISOString();
  state.meta.updatedAt = now;
  if (!state.meta.createdAt) state.meta.createdAt = now;
  try {
    storage.setItem(key, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('Could not save', e);
    return false;
  }
}

// ---------- backup ----------

export function exportJSON(state) {
  return JSON.stringify({ app: 'workout', exportedAt: new Date().toISOString(), ...state }, null, 2);
}

// Throws a readable error if the file isn't a backup from this app.
export function importJSON(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!raw || raw.app !== 'workout' || typeof raw.logs !== 'object') {
    throw new Error("That file doesn't look like a backup from this app.");
  }
  return migrate(raw);
}
