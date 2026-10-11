// All views. One render() per change; text fields save without re-rendering so focus is kept.

import { todayStr, addDays, formatDate, diffDays, weekday } from './dates.js';
import {
  START, WEEK1, PRACTICE, TARGET, parseReps, practice, isPractice, practiceChecks, about, strength, running, workoutFor, dayType, calWeek, weekDates, weekStart, runWeek, liftWeek,
  isFinished, canRepeat, repeatWeek, undoRepeat, runTrouble, projections, workingState, MOVEMENTS,
  itemsToText, textToItems, runPlanWeek,
} from './plan.js';
import { load, save, exportJSON, importJSON, migrate, emptyState, useStorageKey } from './store.js';
import { TEST, TEST_STORAGE_KEY, initTest, testToday, setTestToday, clearTest, exitUrl } from './testmode.js';
import { esc, on, reset, debounce } from './ui.js';
import { progress, formatSeconds, restSeconds } from './progress.js';
import { lineChart } from './chart.js';

const root = document.getElementById('app');

let state;
let today;
let view = { name: 'day', date: null };
let flash = ''; // one-line confirmation shown once
let pendingImport = null;
const openLogs = new Set(); // log disclosures the user opened, kept open across re-renders
let counter = null; // rep counter in progress: { date, id, n, restFrom }; saved to the log only when a set is saved
let ticker = null; // 1 s interval for the rest timer and run timer
let wakeLock = null;

const saveSoon = debounce(() => save(state), 400);
export function flushSave() {
  saveSoon.flush();
}

function currentDay() {
  return TEST ? testToday() : todayStr();
}

export function start() {
  if (TEST) {
    initTest();
    useStorageKey(TEST_STORAGE_KEY);
  }
  state = load();
  today = currentDay();
  view = { name: 'day', date: today };
  render();
}

// Called on resume and every 30 s. Past midnight in Chicago, jump back to the new today.
export function checkDate() {
  if (TEST) return; // the simulated day only moves with the test bar
  const t = todayStr();
  if (t === today) return;
  const wasOnToday = view.date === today;
  today = t;
  if (view.name === 'day' && wasOnToday) view.date = t;
  if (view.name !== 'day' || wasOnToday) render();
}

function commit() {
  save(state);
  render();
}

function go(name, date = view.date) {
  view = { name, date };
  openLogs.clear();
  flash = '';
  render();
  root.scrollTop = 0;
}

function logFor(date) {
  return (state.logs[date] ??= { status: null, checks: {}, actual: {}, effort: {}, pain: false, note: '', distance: '', time: '', snapshot: null, startedAt: null, finishedAt: null, clockStart: null, clockSec: 0 });
}

// Marks when the workout actually started: the first set, check or timer start.
function touch(l) {
  l.startedAt ??= new Date().toISOString();
  return l;
}

function clockSeconds(l) {
  return (l?.clockSec || 0) + (l?.clockStart ? (Date.now() - Date.parse(l.clockStart)) / 1000 : 0);
}

function pauseClock(l) {
  if (!l.clockStart) return;
  l.clockSec = Math.round(clockSeconds(l));
  l.clockStart = null;
  l.time = formatSeconds(l.clockSec);
}

function emptyLog(l) {
  return !l || (!l.status && !Object.keys(l.checks || {}).length && !l.note && !l.pain && !Object.keys(l.actual || {}).length && !Object.keys(l.effort || {}).length && !l.distance && !l.time);
}

// ---------------------------------------------------------------- render

export function render() {
  reset(root);
  clearInterval(ticker);
  ticker = null;
  const v = view.name;
  if (v === 'history') root.innerHTML = historyHtml();
  else if (v === 'progress') root.innerHTML = progressHtml();
  else if (v === 'count') root.innerHTML = countHtml(view.date);
  else if (v === 'setup') root.innerHTML = setupHtml();
  else if (v === 'about') root.innerHTML = aboutHtml();
  else if (v === 'edit') root.innerHTML = editHtml(view.date);
  else if (v === 'repeat') root.innerHTML = repeatHtml();
  else root.innerHTML = dayHtml(view.date);
  if (TEST) root.insertAdjacentHTML('afterbegin', testBarHtml());
  bind();
  if (root.querySelector('[data-tick]')) {
    tick();
    ticker = setInterval(tick, 1000);
  }
  keepAwake(v === 'count' || !!root.querySelector('[data-clock][data-tick]'));
}

// Updates timers in place, without a re-render, so taps and typing aren't interrupted.
function tick() {
  const clock = root.querySelector('[data-clock]');
  if (clock) clock.textContent = formatSeconds(clockSeconds(state.logs[view.date]));
  const rest = root.querySelector('[data-rest]');
  if (rest && counter?.restFrom) {
    const sec = (Date.now() - counter.restFrom) / 1000;
    const aim = Number(rest.dataset.aim) || 0;
    rest.classList.toggle('ready', aim > 0 && sec >= aim);
    rest.querySelector('.rest-t').textContent = formatSeconds(sec);
  }
}

// Keeps the screen on while counting reps or timing a run, where supported (iOS 16.4+).
async function keepAwake(want) {
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}

// ---------------------------------------------------------------- day

function navHtml(date) {
  const isToday = date === today;
  return `
    <nav class="daynav">
      <button class="icon" data-go-day="${addDays(date, -1)}" aria-label="Previous day">‹</button>
      <div class="daynav-mid">
        <div class="date">${esc(formatDate(date))}</div>
        ${isToday ? '<div class="muted small">Today</div>' : `<button class="link small" data-go-day="${today}">Back to today</button>`}
      </div>
      <button class="icon" data-go-day="${addDays(date, 1)}" aria-label="Next day">›</button>
    </nav>`;
}

function weekStripHtml(date) {
  const c = isPractice(date) ? 0 : Math.max(1, calWeek(date));
  const label = { run: 'Run', lift: 'Lift', rest: 'Rest' };
  const cells = weekDates(c).map((d) => {
    const w = workoutFor(state, d);
    const l = state.logs[d];
    const mark = l?.status === 'done' ? '<span class="ok">✓</span>' : l?.status === 'skipped' ? '<span class="muted">skip</span>' : '';
    const cls = ['wk', d === date ? 'sel' : '', d === today ? 'today' : '', w.type].join(' ');
    return `<button class="${cls}" data-go-day="${d}" aria-label="${esc(formatDate(d))}: ${w.title}">
      <span class="wk-d">${formatDate(d, { weekday: 'narrow' })}</span>
      <span class="wk-n">${Number(d.slice(8))}</span>
      <span class="wk-t">${label[w.type] || ''}</span>
      <span class="wk-s">${mark}</span>
    </button>`;
  });
  return `<div class="week" role="group" aria-label="${c ? `Week ${c}` : 'Practice week'}">${cells.join('')}</div>`;
}

function weekLine(date, w) {
  if (isPractice(date)) {
    const n = diffDays(date, START);
    return `Practice week · week 1 starts ${n === 1 ? 'tomorrow' : `in ${n} days`}`;
  }
  const c = calWeek(date);
  let s = `Week ${c}`;
  if (w.type === 'run') s += ` · ${w.planLabel}${w.repeatOf ? ' (repeat)' : ''}`;
  if (w.type === 'lift') s += ` · ${w.planLabel}${w.repeatOf ? ' (repeat)' : ''}`;
  if (date === TARGET) s += ' · target date';
  if (date > TARGET) s += ' · past Dec 31 target, plan continues';
  return s;
}

function dayHtml(date) {
  if (date < PRACTICE) return prepHtml(date);
  const w = workoutFor(state, date);
  const log = state.logs[date];
  const future = date > today;
  const status = log?.status;

  let body = '';
  if (w.type === 'rest') body = restHtml(w, date);
  else body = workoutHtml(w, date, log, future);

  return `
    ${navHtml(date)}
    ${weekStripHtml(date)}
    <p class="muted small weekline">${esc(weekLine(date, w))}</p>
    ${flash ? `<p class="flash">${esc(flash)}</p>` : ''}
    ${isPractice(date) ? practiceNoteHtml() : ''}
    ${bannerHtml(date)}
    ${body}
    ${footerHtml()}
  `;
}

function restHtml(w, date) {
  const editedNote = w.edited ? `<p class="muted">Changed from a ${w.originalType === 'lift' ? 'lifting' : 'run'} day. <button class="link" data-act="restore" data-date="${date}">Restore planned workout</button></p>` : '';
  return `
    <h1>Rest day</h1>
    <p class="lede">${esc(about.rest.text)}</p>
    ${date === WEEK1 ? `<p class="callout">Week 1 starts here. First workout tomorrow: ${esc(workoutFor(state, START).title.toLowerCase())}, about ${workoutFor(state, START).minutes} min. <button class="link" data-go="setup">Optional setup</button></p>` : ''}
    ${editedNote}
    ${weekEndHtml(date)}
  `;
}

function minutes(w) {
  return w.minutes ? `About ${w.minutes} min` : '';
}

function workoutHtml(w, date, log, future) {
  const status = log?.status;
  const done = status === 'done';
  const skipped = status === 'skipped';
  const locked = future || done || skipped;
  const weekKind = { test: w.practice ? 'optional rep check' : 'check-in week', intro: 'first week', lighter: 'lighter week', practice: 'easy sets' }[w.weekType];
  const meta = [minutes(w), w.type === 'lift' ? cap(weekKind || '') : '', w.edited ? 'Edited' : ''].filter(Boolean).join(' · ');

  const limitations = state.setup.limitations ? `<p class="callout"><b>Your note:</b> ${esc(state.setup.limitations)}</p>` : '';

  let intro = '';
  if (w.type === 'run' && !w.edited) {
    intro = `${w.isCheck ? '' : `<p class="lede">${esc(w.effort)}</p>`}${w.note ? `<p class="callout">${esc(w.note)}</p>` : ''}`;
  } else if (w.type === 'lift' && !w.edited) {
    intro = `<p class="lede">${esc(w.focus)}</p>${w.weekNote ? `<p class="callout">${esc(w.weekNote)}</p>` : ''}
      <div class="item warm"><div class="item-h"><span class="item-name">Warm-up</span></div><p class="small muted">${esc(w.warmup)}</p></div>`;
  } else if (w.note) {
    intro = `<p class="lede">${esc(w.note)}</p>`;
  }

  const statusBox = done
    ? `<div class="done-box"><p><b>Finished.</b> ${esc(durationText(log))} ${log.note ? esc(log.note) : ''}</p><button class="link" data-act="reopen">Edit log</button></div>`
    : skipped
      ? `<div class="skip-box"><p><b>Skipped.</b> Nothing moves or doubles up. The next session stays as planned.</p><button class="link" data-act="reopen">Undo skip</button></div>`
      : '';

  const items = w.items.map((it) => (w.type === 'run' ? runItemHtml(it, log, locked) : liftItemHtml(it, log, locked, w))).join('');

  const extra = locked ? '' : w.type === 'run' ? runExtraHtml(log) : liftExtraHtml(log);

  const actions = future
    ? `<div class="actions"><button class="wide" data-act="edit">Edit this workout</button></div><p class="muted small center">Future workouts are view-only. Log on the day.</p>`
    : locked
      ? ''
      : `<button class="primary wide" data-act="finish">Finish workout</button>
         <div class="row2">
           <button data-act="skip">Mark skipped</button>
           ${date >= today ? '<button data-act="edit">Edit</button>' : ''}
         </div>`;

  const clock = w.type === 'run' && !locked && date === today ? clockHtml(log) : '';

  return `
    <h1>${esc(w.title)}</h1>
    ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
    ${statusBox}
    ${clock}
    ${intro}
    ${limitations}
    <div class="items">${items}</div>
    ${extra}
    ${w.type === 'run' && w.advance && !w.edited ? `<p class="muted small">Moving on: ${esc(w.advance)}</p>` : ''}
    ${actions}
    ${weekEndHtml(date)}
    <details class="safety"><summary>When to stop</summary><p>${esc(about.safety)}</p></details>
  `;
}

// "Took 42 min" from the first logged set to Finish. Left out if it looks wrong (over 4 hours).
function durationText(log) {
  if (!log?.startedAt || !log?.finishedAt) return '';
  const min = Math.round((Date.parse(log.finishedAt) - Date.parse(log.startedAt)) / 60000);
  return min >= 1 && min <= 240 ? `Took ${min} min.` : '';
}

function clockHtml(log) {
  const running = !!log?.clockStart;
  const sec = clockSeconds(log);
  return `
    <div class="clock">
      <div class="clock-t" data-clock ${running ? 'data-tick' : ''}>${formatSeconds(sec)}</div>
      <div class="row2">
        <button class="primary" data-act="clock">${running ? 'Pause' : sec ? 'Resume' : 'Start session timer'}</button>
        ${!running && sec ? '<button data-act="clock-reset">Reset</button>' : ''}
      </div>
      <p class="small muted">Times the whole session, warm-up included. It keeps counting with the screen locked. Pausing fills in Time below.</p>
    </div>`;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A set button. Once done it shows the reps you logged for that set, or a check mark.
function checkBtn(id, label, checked, locked, cls = '', reps = null) {
  const shown = checked ? (reps != null ? reps : '✓') : label;
  return `<button class="set ${cls} ${checked ? 'on' : ''}" data-check="${esc(id)}" aria-pressed="${checked}" ${locked ? 'disabled' : ''}>${esc(shown)}</button>`;
}

function runItemHtml(it, log, locked) {
  const checked = !!log?.checks?.[it.id];
  const steps = it.steps ? `<ol class="steps">${it.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
  return `
    <div class="item run-item ${checked ? 'is-done' : ''}">
      <label class="tick">
        <input type="checkbox" data-check="${esc(it.id)}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''} />
        <span>
          <span class="item-name">${esc(it.name)}</span>
          ${it.detail ? `<span class="item-detail">${esc(it.detail)}</span>` : ''}
        </span>
      </label>
      ${steps}
    </div>`;
}

function liftItemHtml(it, log, locked, w) {
  const actual = log?.actual?.[it.id] || {};
  const logged = it.movement ? parseReps(actual.reps) : [];
  const sets = (it.sets || []).map((s, i) => checkBtn(s.id, s.label, !!log?.checks?.[s.id], locked, s.long ? 'long' : '', logged[i])).join('');
  const countable = it.movement && !locked && w.date === today;
  const countBtn = countable
    ? `<button class="wide count-open" data-count="${esc(it.id)}">${logged.length >= it.sets.length ? 'Counter · all sets saved' : `Count reps · set ${logged.length + 1} of ${it.sets.length}`}</button>`
    : '';
  const effort = log?.effort?.[it.id];
  const showInputs = it.inputs && !locked;
  const repsLabel = it.kind === 'test' ? 'Clean reps' : 'Actual reps';
  const hasLog = !!(actual.reps || actual.weight || effort);
  const logLabel = it.kind === 'test' ? 'Record clean reps' : it.movement ? 'Log reps and effort' : 'Log reps or weight';
  const inputs = showInputs
    ? `<details class="log" data-log-id="${esc(it.id)}" ${hasLog || it.kind === 'test' || openLogs.has(it.id) ? 'open' : ''}><summary>${logLabel}</summary><div class="fields">
        <label>${repsLabel}<input inputmode="${it.kind === 'test' ? 'numeric' : 'text'}" data-actual="${esc(it.id)}" data-field="reps" value="${esc(actual.reps)}" placeholder="${it.kind === 'test' ? 'e.g. 8' : 'e.g. 6, 6, 5'}" autocomplete="off" /></label>
        ${it.weight || it.kind === 'edited' ? `<label>Weight<input data-actual="${esc(it.id)}" data-field="weight" value="${esc(actual.weight)}" placeholder="e.g. 35 lb" autocomplete="off" /></label>` : ''}
      </div>
      ${it.movement && it.kind !== 'test' ? effortHtml(it.id, effort) : ''}</details>`
    : locked && (actual.reps || actual.weight || effort)
      ? `<p class="small muted">${[actual.reps && `Reps: ${esc(actual.reps)}`, actual.weight && `Weight: ${esc(actual.weight)}`, effort && `Felt ${effort}`].filter(Boolean).join(' · ')}</p>`
      : '';
  const standard = it.standard ? `<details><summary>Rep standard</summary><p>${esc(it.standard)}</p></details>` : '';
  return `
    <div class="item">
      <div class="item-h">
        <span class="item-name">${esc(it.name)}</span>
        ${it.rest ? `<span class="muted small">Rest ${esc(it.rest)}</span>` : ''}
      </div>
      <p class="item-detail">${esc(it.detail)}</p>
      ${sets ? `<div class="sets">${sets}</div>` : ''}
      ${countBtn}
      ${it.how ? `<p class="small muted">${esc(it.how)}</p>` : ''}
      ${it.testHint ? `<p class="small muted">${esc(it.testHint)}</p>` : ''}
      ${it.hint && !locked ? `<p class="small muted">${esc(it.hint)}</p>` : ''}
      ${inputs}
      ${standard}
    </div>`;
}

function effortHtml(id, current) {
  const opts = [['easy', 'Easy'], ['right', 'About right'], ['hard', 'Hard']];
  return `<div class="seg" role="group" aria-label="How it felt">${opts
    .map(([v, l]) => `<button class="${current === v ? 'on' : ''}" data-effort="${esc(id)}" data-value="${v}" aria-pressed="${current === v}">${l}</button>`)
    .join('')}</div>`;
}

function runExtraHtml(log) {
  return `
    <div class="item">
      <div class="item-h"><span class="item-name">Optional</span></div>
      <div class="fields">
        <label>Distance<input data-log="distance" value="${esc(log?.distance)}" placeholder="e.g. 3.2 km" autocomplete="off" /></label>
        <label>Time<input data-log="time" value="${esc(log?.time)}" placeholder="e.g. 31:20" autocomplete="off" /></label>
      </div>
      <p class="small muted">How it felt</p>
      ${effortHtml('session', log?.effort?.session)}
      ${painNoteHtml(log)}
    </div>`;
}

function liftExtraHtml(log) {
  return `<div class="item">${painNoteHtml(log)}</div>`;
}

function painNoteHtml(log) {
  return `
    <label class="tick pain">
      <input type="checkbox" data-pain ${log?.pain ? 'checked' : ''} />
      <span>Pain that changed how I moved, or got worse</span>
    </label>
    <label class="block">Note<textarea data-log="note" rows="2" maxlength="500" placeholder="Optional">${esc(log?.note)}</textarea></label>`;
}

// Monday: last week had trouble on runs and nothing has been logged this week.
function bannerHtml(date) {
  if (date !== today) return '';
  const c = calWeek(date);
  if (c < 2) return '';
  const key = `run-${c}`;
  if (state.meta.dismissed?.[key] || state.meta.dismissed?.[`end-${c - 1}`]) return '';
  if ((state.repeats.run || []).includes(c - 1)) return '';
  const thisWeekRunLogged = weekDates(c).some((d) => dayType(d) === 'run' && !emptyLog(state.logs[d]));
  if (thisWeekRunLogged) return '';
  const trouble = runTrouble(state, c - 1);
  if (!trouble.length) return '';
  const p = runWeek(state, c - 1);
  return `
    <div class="callout">
      <p>Last week ${trouble.length === 1 ? 'one run was' : `${trouble.length} runs were`} skipped, hard or painful. Repeating running week ${p} this week is a sensible option. Lifting is unaffected.</p>
      <div class="row2">
        <button data-act="repeat-prev" data-week="${c - 1}">Repeat week ${p}</button>
        <button data-act="dismiss" data-key="${key}">Move on</button>
      </div>
    </div>`;
}

// Weeks run Sunday through Saturday. On Saturday after the run, recap the week and decide on next week.
// On Sunday the new week has started, but no run has happened yet, so last week can still be repeated.
function weekEndHtml(date) {
  if (date !== today) return '';
  if (isPractice(date) || date === WEEK1) return practiceEndHtml(date);
  const c = calWeek(date);
  const wd = weekday(date);
  let wc;
  if (wd === 6 && isFinished(state.logs[date])) wc = c;
  else if (wd === 0 && c >= 2) wc = c - 1;
  else return '';
  const which = wc === c ? 'Next week' : 'This week';
  const recap = recapHtml(wc);
  const repeating = (state.repeats.run || []).includes(wc);
  const p = runWeek(state, wc);
  const cur = runPlanWeek(p);
  if (repeating) {
    return `<div class="callout">${recap}<p>${which} repeats running week ${p}.</p><button class="link" data-act="undo-repeat" data-track="run" data-week="${wc}">Undo</button></div>`;
  }
  if (cur.repeat || state.meta.dismissed?.[`end-${wc}`]) return `<div class="callout">${recap}</div>`;
  return `
    <div class="callout">
      ${recap}
      <p><b>${which}:</b> ${esc(runPlanWeek(p + 1).title)}.</p>
      <p class="small">${esc(cur.advance)}</p>
      <div class="row2">
        <button data-act="dismiss" data-key="end-${wc}">Continue</button>
        <button data-act="repeat-week" data-track="run" data-week="${wc}">Repeat week ${p}</button>
      </div>
    </div>`;
}

function practiceNoteHtml() {
  return `<p class="callout">${esc(practice.banner)} <button class="link" data-go="setup">Setup</button> · <button class="link" data-go="about">Rep standards</button></p>`;
}

// Saturday after the practice run, or Sunday Oct 18: how practice went, and the option to
// use the practice rep check as starting numbers. Nothing changes unless you tap the button.
function practiceEndHtml(date) {
  if (!(date === WEEK1 || (weekday(date) === 6 && isFinished(state.logs[date])))) return '';
  const days = weekDates(0).filter((d) => ['run', 'lift'].includes(dayType(d)));
  const done = days.filter((d) => state.logs[d]?.status === 'done').length;
  const checks = practiceChecks(state);
  const name = { pull: 'pull-ups', dip: 'dips', push: 'push-ups' };
  const found = MOVEMENTS.filter((m) => checks[m] != null);
  const same = found.every((m) => state.setup[m] === checks[m]);
  const checkText = found.length
    ? `<p>Rep check: ${esc(found.map((m) => `${checks[m]} ${name[m]}`).join(', '))}.</p>
       ${same ? '<p class="small">These are your starting numbers.</p>' : `<button class="wide" data-act="use-practice">Use as my starting numbers</button><p class="small muted">Sets your setup numbers, which set week 1 targets. You can change them in Setup.</p>`}`
    : '<p class="small">No rep check logged. Week 1 will work it out from your first sessions, or add numbers in Setup.</p>';
  return `
    <div class="callout">
      <p><b>Practice week:</b> ${done} of ${days.length} sessions done.</p>
      ${checkText}
      <p class="small">Week 1 starts Monday, October 19, with Couch to 5K week 1.</p>
    </div>`;
}

function recapHtml(c) {
  const wk = progress(state, today).weeks[c - 1];
  if (!wk) return '';
  const name = { pull: 'pull-ups', dip: 'dips', push: 'push-ups' };
  const bits = [`${wk.done} of ${wk.planned} workouts done`];
  for (const m of MOVEMENTS) if (wk.reps[m]) bits.push(`${wk.reps[m]} ${name[m]}`);
  if (wk.runSeconds) bits.push(`${formatSeconds(wk.runSeconds)} running`);
  return `<p><b>Week ${c}:</b> ${esc(bits.join(' · '))}. <button class="link" data-go="progress">Progress</button></p>`;
}

function prepHtml(date) {
  const days = diffDays(today, START);
  const first = weekDates(1).map((d) => {
    const w = workoutFor(state, d);
    return `<li><button class="link" data-go-day="${d}">${esc(formatDate(d, { weekday: 'short', month: 'short', day: 'numeric' }))}</button> · ${esc(w.title)}${w.minutes ? `, about ${w.minutes} min` : ''}</li>`;
  });
  const setupDone = MOVEMENTS.some((m) => state.setup[m] != null) || Object.values(state.setup.equipment).some((v) => v != null);
  return `
    ${date === today ? '' : navHtml(date)}
    <p class="muted small weekline">${date === today ? esc(formatDate(today)) : 'Preparation'}</p>
    <h1>Training starts Monday, October 19</h1>
    <p class="lede">${days > 0 ? `${days} day${days === 1 ? '' : 's'} to go.` : ''} Nothing is due yet.</p>
    <div class="item">
      <div class="item-h"><span class="item-name">Optional setup</span></div>
      <p class="small muted">Add your current clean reps, how long you can jog, your equipment and any aches. Any of it can stay "I don't know yet". The plan works either way.</p>
      <button class="wide" data-go="setup">${setupDone ? 'Review setup' : 'Open setup'}</button>
    </div>
    <div class="item">
      <div class="item-h"><span class="item-name">Before the 19th</span></div>
      <ul class="plain">
        <li>Read the rep standards so every rep you log means the same thing. <button class="link" data-go="about">About the plan</button></li>
        <li>Pick a flat route of about 2-3 km, and shoes you can run in.</li>
        <li>Check that your pull-up bar and dip bars are secure.</li>
        <li>Add this app to your home screen so it works offline.</li>
        <li>An optional practice week runs Sunday, October 11 to Saturday, October 17.</li>
      </ul>
    </div>
    <div class="item">
      <div class="item-h"><span class="item-name">Week 1</span></div>
      <ul class="plain">${first.join('')}</ul>
      ${TEST ? '' : '<a class="button wide" href="?test">Try week 1 in testing mode</a>'}
    </div>
    ${footerHtml()}
  `;
}

function footerHtml() {
  return `
    <footer class="foot">
      <button class="link" data-go="progress">Progress</button>
      <button class="link" data-go="history">History</button>
      ${calWeek(today) >= 1 ? '<button class="link" data-go="repeat">Repeat week</button>' : ''}
      <button class="link" data-go="setup">Setup</button>
      <button class="link" data-go="about">About</button>
    </footer>`;
}

function testBarHtml() {
  return `
    <div class="testbar" role="region" aria-label="Testing mode">
      <div class="testbar-top">
        <span><b>Testing mode</b> · today is ${esc(formatDate(today, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>
        <button class="link small" data-act="test-exit">Exit</button>
      </div>
      <div class="testbar-row">
        <button data-act="test-day" data-step="-1" aria-label="Simulate previous day">‹ Day</button>
        <button data-act="test-day" data-step="1" aria-label="Simulate next day">Day ›</button>
        <button data-act="test-reset">Reset</button>
      </div>
      <p class="small">Practice data is kept apart from your real log.</p>
    </div>`;
}

// ---------------------------------------------------------------- history

function historyHtml() {
  const entries = Object.entries(state.logs)
    .filter(([, l]) => !emptyLog(l))
    .sort(([a], [b]) => (a < b ? 1 : -1));
  const ws = workingState(state, addDays(today, 1));
  const name = { pull: 'Pull-ups', dip: 'Dips', push: 'Push-ups' };
  const targets = MOVEMENTS.map((m) => {
    const x = ws[m];
    const val = x.mode === 'unknown' ? 'baseline not set' : x.mode === 'regression' ? `using easier version (max ${x.max})` : `sets of ${x.W}${x.max != null ? ` · max ${x.max}${x.estimated ? ' est.' : ''}` : ''}`;
    return `<tr><th>${name[m]}</th><td>${esc(val)}</td></tr>`;
  }).join('');
  const rows = entries.map(([d, l]) => {
    const w = l.snapshot || workoutFor(state, d);
    const status = l.status === 'done' ? 'Done' : l.status === 'skipped' ? 'Skipped' : 'In progress';
    const bits = [];
    for (const [k, a] of Object.entries(l.actual || {})) if (a.reps || a.weight) bits.push(`${exerciseName(k, d)}: ${[a.reps, a.weight].filter(Boolean).join(' @ ')}`);
    if (l.distance || l.time) bits.push([l.distance, l.time].filter(Boolean).join(' in '));
    if (durationText(l)) bits.push(durationText(l).replace('.', ''));
    return `<li><button class="hist" data-go-day="${d}">
      <span class="hist-top"><span>${esc(formatDate(d, { weekday: 'short', month: 'short', day: 'numeric' }))}</span><span class="${l.status === 'done' ? 'ok' : 'muted'}">${status}</span></span>
      <span class="hist-title">${esc(w.title)}${l.pain ? ' · pain noted' : ''}</span>
      ${bits.length ? `<span class="small muted">${esc(bits.join(' · '))}</span>` : ''}
      ${l.note ? `<span class="small">${esc(l.note)}</span>` : ''}
    </button></li>`;
  });
  return `
    ${backHtml()}
    <h1>History</h1>
    <table class="targets"><caption class="muted small">Current targets</caption>${targets}</table>
    ${rows.length ? `<ul class="history">${rows.join('')}</ul>` : '<p class="muted">Nothing logged yet.</p>'}
  `;
}

function exerciseName(id, date) {
  return strength.movements[id]?.name || strength.accessories[id]?.name || workoutFor(state, date).items.find((i) => i.id === id)?.name || id;
}

function backHtml() {
  return `<nav class="back"><button class="link" data-go-day="${today}">‹ Today</button></nav>`;
}

// ---------------------------------------------------------------- rep counter

// What to aim for on set i, in words.
function setTarget(it, i) {
  if (it.kind === 'working') return `target ${it.sets[i]?.label ?? it.target}`;
  if (it.kind === 'test') return 'clean reps until the next one would not be clean';
  if (it.kind === 'unknown') return 'stop with 2-3 clean reps left';
  if (it.kind === 'practice') return 'easy: stop with 3-4 clean reps left';
  const reps = String(it.detail).split('×')[1];
  return reps ? `target ${reps.trim()}` : '';
}

function countHtml(date) {
  const w = workoutFor(state, date);
  const it = w.items.find((i) => i.id === view.item && i.movement);
  const log = state.logs[date];
  if (!it || date !== today || isFinished(log)) {
    return `${backHtml()}<h1>Counter closed</h1><p class="muted">The counter is for today's open workout.</p>`;
  }
  if (counter?.date !== date || counter?.id !== it.id) counter = { date, id: it.id, n: 0, restFrom: null };
  const done = parseReps(log?.actual?.[it.id]?.reps);
  const total = it.sets.length;
  const allDone = done.length >= total;
  const aim = restSeconds(it.rest);
  const chips = done.map((r, i) => `<span class="chip"><span class="muted">Set ${i + 1}</span> ${r}</span>`).join('');
  const hint = it.movement === 'push' ? 'Tip for push-ups: put the phone under your chest and touch the screen at the bottom of each rep.' : 'Tap once per rep, or tap the count in quickly right after the set.';
  const rest = counter.restFrom && !allDone
    ? `<p class="rest" data-rest data-tick data-aim="${aim || ''}">Rest <span class="rest-t">0:00</span>${it.rest ? ` · aim for ${esc(it.rest)}` : ''}<span class="rest-ready"> · ready for set ${done.length + 1}</span></p>`
    : '';
  const body = allDone
    ? `<div class="done-box"><p><b>All ${total} set${total === 1 ? '' : 's'} saved:</b> ${done.join(', ')}.</p></div>
       ${it.kind !== 'test' ? `<p class="small muted">How did it feel?</p>${effortHtml(it.id, log?.effort?.[it.id])}` : ''}
       <button class="primary wide" data-act="count-close">Back to workout</button>`
    : `${rest}
       <button class="tap" data-act="tap" aria-label="Add one rep. Count: ${counter.n}"><span class="tap-n">${counter.n}</span><span class="tap-l">tap = 1 rep</span></button>
       <div class="row2 tap-row">
         <button data-act="tap-minus" aria-label="Remove one rep">−1</button>
         <button class="primary" data-act="set-save" ${counter.n ? '' : 'disabled'}>Save set ${done.length + 1}</button>
       </div>
       <p class="small muted center">${esc(hint)}</p>`;
  return `
    <nav class="back"><button class="link" data-act="count-close">‹ Back to workout</button></nav>
    <h1>${esc(it.name)}</h1>
    <p class="meta">${allDone ? `${total} of ${total} sets` : `Set ${done.length + 1} of ${total} · ${esc(setTarget(it, done.length))}`}</p>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${body}
    ${done.length ? '<p class="center"><button class="link small" data-act="set-undo">Undo last saved set</button></p>' : ''}
    ${it.standard ? `<details><summary>Rep standard</summary><p>${esc(it.standard)}</p></details>` : ''}
  `;
}

// ---------------------------------------------------------------- progress

function progressHtml() {
  if (today < WEEK1) {
    return `${backHtml()}<h1>Progress</h1><p class="muted">Progress starts with week 1 on Sunday, October 18. The practice week isn't counted; its logs are in History.</p>`;
  }
  const pr = progress(state, today);
  const c = calWeek(today);
  const name = { pull: 'Pull-ups', dip: 'Dips', push: 'Push-ups' };
  const goal = { pull: 25, dip: 50, push: 100 };
  const to = today > TARGET ? today : TARGET;

  const moves = MOVEMENTS.map((m) => {
    const x = pr.movements[m];
    const now = x.max != null ? `${x.max}${x.estimated ? ' (estimated)' : ''}` : 'not known yet';
    const rows = [
      ['At setup', x.baseline != null ? String(x.baseline) : "didn't know"],
      ['Clean max now', now],
      x.firstTest != null ? ['Rep checks', x.firstTest === x.lastTest ? String(x.firstTest) : `${x.firstTest} → ${x.lastTest}`] : null,
      ['Best set logged', x.bestSet != null ? String(x.bestSet) : '—'],
      ['Total reps logged', String(x.total)],
      ['Goal', String(goal[m])],
    ].filter(Boolean);
    const points = x.full.map((s) => ({ date: s.date, y: s.best, mark: s.test }));
    const chart = points.length
      ? lineChart(points, { from: START, to, label: `${name[m]}: best set per session` })
      : '<p class="small muted">Log reps to see a chart.</p>';
    const easier = x.easierSessions ? `<p class="small muted">Plus ${x.easierSessions} session${x.easierSessions === 1 ? '' : 's'} of the easier version, not counted above.</p>` : '';
    return `
      <h2>${name[m]}</h2>
      <table class="targets">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      ${chart}
      ${points.length ? '<p class="small muted">Best set per session. Filled dots are rep checks.</p>' : ''}
      ${easier}`;
  }).join('');

  const head = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span class="cg-h">${d}</span>`).join('');
  const grid = pr.weeks.map((wk) => {
    const cells = wk.cells.map((x) => {
      let cls = 'rest', txt = '';
      if (x.type === 'future') cls = 'future';
      else if (x.status === 'done') (cls = 'done'), (txt = '✓');
      else if (x.status === 'skipped') (cls = 'skip'), (txt = '–');
      else if (x.type === 'run' || x.type === 'lift') (cls = x.date === today ? 'open' : 'miss'), (txt = x.type === 'run' ? 'R' : 'L');
      return `<button class="cg ${cls}" data-go-day="${x.date}" aria-label="${esc(formatDate(x.date))}: ${cls}">${txt}</button>`;
    }).join('');
    return `<span class="cg-w">${wk.c}</span>${cells}`;
  }).join('');

  const weekRows = pr.weeks.map((wk) => `<tr><th>${wk.c}</th><td>${wk.done}/${wk.planned}</td><td>${wk.reps.pull || '—'}</td><td>${wk.reps.dip || '—'}</td><td>${wk.reps.push || '—'}</td><td>${wk.runSeconds ? formatSeconds(wk.runSeconds) : '—'}</td></tr>`).join('');

  const runs = pr.runs.filter((r) => r.status === 'done').reverse().map((r) => `<li><button class="hist" data-go-day="${r.date}">
      <span class="hist-top"><span>${esc(formatDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</span><span class="muted">${esc([r.time, r.distance].filter(Boolean).join(' · ') || 'no time logged')}</span></span>
      <span class="small muted">${esc(r.planLabel || r.title)}${r.effort ? ` · felt ${r.effort === 'right' ? 'about right' : r.effort}` : ''}${r.pain ? ' · pain noted' : ''}</span>
    </button></li>`).join('');

  return `
    ${backHtml()}
    <h1>Progress</h1>
    <p class="lede">Week ${c}. ${pr.done} of ${pr.due} workouts done so far${pr.skipped ? `, ${pr.skipped} skipped` : ''}.</p>
    <p class="small muted">The fairest before-and-after is the optional rep checks in weeks 5 and 11, done the same way each time.</p>
    <h2>Consistency</h2>
    <div class="cgrid"><span></span>${head}${grid}</div>
    <p class="small muted">✓ done · – skipped · R/L run or lift not logged · blank rest. Tap a day to open it.</p>
    ${moves}
    <h2>Running</h2>
    <table class="targets">
      <tr><th>Runs done</th><td>${pr.runsDone} of ${pr.runs.filter((r) => r.date < today || r.status).length}</td></tr>
      <tr><th>Time logged</th><td>${pr.runSeconds ? formatSeconds(pr.runSeconds) : '—'}</td></tr>
      <tr><th>Longest session</th><td>${pr.longestRun ? formatSeconds(pr.longestRun) : '—'}</td></tr>
      <tr><th>Running week now</th><td>${esc(runPlanWeek(runWeek(state, c)).title)}</td></tr>
    </table>
    ${runs ? `<ul class="history">${runs}</ul>` : '<p class="small muted">Use the session timer on run days, or type a time, to track runs here.</p>'}
    <h2>By week</h2>
    <table class="weeks"><tr><th>Wk</th><th>Done</th><th>Pull</th><th>Dip</th><th>Push</th><th>Run</th></tr>${weekRows}</table>
  `;
}

// ---------------------------------------------------------------- repeat

function repeatHtml() {
  const c = calWeek(today);
  const rows = ['run', 'lift'].map((track) => {
    const p = track === 'run' ? runWeek(state, c) : liftWeek(state, c);
    const label = track === 'run' ? 'Running' : 'Lifting';
    const set = (state.repeats[track] || []).includes(c);
    return `
      <div class="item">
        <div class="item-h"><span class="item-name">${label}: week ${p}</span></div>
        ${set
          ? `<p>Next week repeats ${label.toLowerCase()} week ${p}.</p><button class="wide" data-act="undo-repeat" data-track="${track}">Undo</button>`
          : `<p class="small muted">Next week repeats week ${p} instead of moving to ${p + 1}. Weekdays stay the same, and finished days keep their history.</p><button class="wide" data-act="repeat-now" data-track="${track}">Repeat ${label.toLowerCase()} week ${p}</button>`}
      </div>`;
  });
  const pr = projections(state);
  return `
    ${backHtml()}
    <h1>Repeat this week</h1>
    <p class="lede">Repeating a week is normal. Later weeks move back by one week rather than being squeezed in.</p>
    ${rows.join('')}
    ${timelineHtml(pr)}
  `;
}

function timelineHtml(pr) {
  const fmt = (d) => (d ? formatDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const lines = [
    `First 30 min continuous run week ends ${fmt(pr.run30)}${pr.run30Late ? ', after the Dec 31 target' : ''}.`,
    `Optional 5K check lands on ${fmt(pr.check5k)}${pr.checkLate ? ', after Dec 31. The plan is not compressed to fit. Do the check when you get there' : ''}.`,
  ];
  return `<div class="item"><div class="item-h"><span class="item-name">Timeline as it stands</span></div>${lines.map((l) => `<p class="small">${esc(l)}</p>`).join('')}</div>`;
}

// ---------------------------------------------------------------- edit

function editHtml(date) {
  const w = workoutFor(state, date);
  const planned = workoutFor({ ...state, edits: {} }, date);
  if (date < today || planned.type === 'rest' || planned.type === 'prep') {
    return `${backHtml()}<h1>Can't edit this day</h1><p class="muted">Only today and future run or lifting days can be edited.</p>`;
  }
  const isEdited = !!state.edits[date];
  const text = w.type === 'rest' ? itemsToText(planned) : itemsToText(w);
  return `
    <nav class="back"><button class="link" data-go-day="${date}">‹ Back</button></nav>
    <h1>Edit ${esc(formatDate(date, { weekday: 'long', month: 'short', day: 'numeric' }))}</h1>
    <p class="muted small">This changes only this date. It stays a ${planned.type === 'run' ? 'run' : 'lifting'} day or becomes a rest day, so runs never land on consecutive days.</p>
    <form class="form" data-form="edit">
      <label class="block">Title<input name="title" value="${esc(w.type === 'rest' ? planned.title : w.title)}" maxlength="120" /></label>
      <label class="block">Minutes<input name="minutes" inputmode="numeric" value="${esc(w.minutes || planned.minutes || '')}" /></label>
      <label class="block">Exercises, one per line, as "Name | sets, reps or time"<textarea name="items" rows="9">${esc(text)}</textarea></label>
      <label class="block">Note<textarea name="note" rows="2" maxlength="500">${esc(state.edits[date]?.note || '')}</textarea></label>
      <button class="primary wide" type="submit">Save changes</button>
    </form>
    <div class="row2">
      <button data-act="make-rest" data-date="${date}">Make it a rest day</button>
      ${isEdited ? `<button data-act="restore" data-date="${date}">Restore plan</button>` : ''}
    </div>
    <p class="muted small">After editing, rep targets for this day aren't used for automatic progression.</p>
  `;
}

// ---------------------------------------------------------------- setup

function numField(name, label, help) {
  const v = state.setup[name];
  return `<label class="block">${label}
    <input name="${name}" inputmode="numeric" pattern="[0-9]*" value="${v == null ? '' : v}" placeholder="I don't know yet" />
    ${help ? `<span class="small muted">${help}</span>` : ''}</label>`;
}

function triField(key, label) {
  const v = state.setup.equipment[key];
  const opt = (val, text) => `<label class="seg-opt"><input type="radio" name="eq-${key}" value="${val}" ${String(v) === val ? 'checked' : ''} /><span>${text}</span></label>`;
  return `<fieldset class="tri"><legend>${label}</legend><div class="seg">${opt('true', 'Yes')}${opt('false', 'No')}${opt('null', 'Not sure')}</div></fieldset>`;
}

function setupHtml() {
  const s = state.setup;
  const suggest = s.jogMinutes == null ? 'Start at week 1 unless you know you can already jog comfortably.' : s.jogMinutes >= 20 ? 'You could start at week 5 or 6, but week 4 is a safer first step if you are unsure.' : s.jogMinutes >= 8 ? 'Week 3 or 4 is a reasonable start. Week 1 is never wrong.' : 'Start at week 1.';
  const weeks = Array.from({ length: 9 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${s.runStartWeek === n ? 'selected' : ''}>Week ${n}</option>`).join('');
  const started = today >= START;
  return `
    ${backHtml()}
    <h1>Setup</h1>
    <p class="lede">Everything is optional. Leave a box empty for "I don't know yet". Empty is never treated as zero, and no max test is required.</p>
    ${flash ? `<p class="flash">${esc(flash)}</p>` : ''}
    <form class="form" data-form="setup">
      <h2>Current clean reps</h2>
      <p class="small muted">Count only reps that meet the standards in About. Your best recent guess is fine.</p>
      ${numField('pull', 'Strict pull-ups')}
      ${numField('dip', 'Parallel-bar dips')}
      ${numField('push', 'Strict push-ups')}
      <h2>Running</h2>
      ${numField('jogMinutes', 'Comfortable continuous jogging (minutes)')}
      <label class="block">Start Couch to 5K at
        <select name="runStartWeek">${weeks}</select>
        <span class="small muted">${esc(suggest)}${started ? ' Changing this after you start shifts every run week.' : ''}</span>
      </label>
      <h2>Equipment</h2>
      ${triField('bar', 'Pull-up bar')}
      ${triField('dipBars', 'Parallel bars or dip station')}
      ${triField('bands', 'Resistance bands')}
      ${triField('weights', 'Dumbbells or kettlebell')}
      <h2>Pain or limitations</h2>
      <label class="block"><span class="small muted">Shown at the top of each workout as a reminder. Not used to diagnose anything.</span>
        <textarea name="limitations" rows="3" maxlength="500">${esc(s.limitations)}</textarea></label>
      <button class="primary wide" type="submit">Save setup</button>
    </form>
    <h2>Back up your data</h2>
    <p class="small muted">Everything is stored only on this device, in this app. There's no account and no sync. Export a backup now and then, for example before changing phones.</p>
    <div class="row2">
      <button data-act="export">Export JSON</button>
      <label class="button">Import JSON<input type="file" accept="application/json,.json" data-import hidden /></label>
    </div>
    ${pendingImport ? importConfirmHtml() : ''}
  `;
}

function importConfirmHtml() {
  const n = Object.keys(pendingImport.logs).length;
  return `
    <div class="callout">
      <p>The backup has ${n} logged day${n === 1 ? '' : 's'}. Importing replaces everything on this device.</p>
      <div class="row2"><button class="primary" data-act="import-yes">Replace</button><button data-act="import-no">Cancel</button></div>
    </div>`;
}

// ---------------------------------------------------------------- about

function aboutHtml() {
  const mv = strength.movements;
  const pr = projections(state);
  return `
    ${backHtml()}
    <h1>About the plan</h1>
    <p class="lede">Weeks run Sunday through Saturday. Runs on Monday, Wednesday and Saturday. Strength on Tuesday and Thursday. Rest on Sunday and Friday. The first workout is Monday, October 19, 2026. Target date Thursday, December 31, 2026.</p>
    <h2>When to stop</h2>
    <p>${esc(about.safety)}</p>
    <h2>Rep standards</h2>
    ${MOVEMENTS.map((m) => `<p><b>${esc(mv[m].name)}.</b> ${esc(mv[m].standard)}</p>`).join('')}
    <h2>How lifting progresses</h2>
    <p>${esc(strength.progression.rule)}</p>
    <p>${esc(strength.progression.unknown)}</p>
    <p>If your clean max is below ${mv.pull.fullFrom} pull-ups, ${mv.dip.fullFrom} dips or ${mv.push.fullFrom} push-ups, you train an easier version until a check-in shows you're ready for the full movement.</p>
    <h2>Running</h2>
    <p>${esc(running.about)}</p>
    <h2>Practice week</h2>
    <p>${esc(practice.about)}</p>
    ${timelineHtml(pr)}
    <h2>From research</h2>
    <ul class="sources">${about.researched.map((r) => `<li>${esc(r.claim)}<br /><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.source)}</a></li>`).join('')}</ul>
    <h2>My programming choices</h2>
    <p class="small muted">These aren't from the sources above. Change them in <code>src/plan/*.json</code>.</p>
    <ul class="plain">${about.choices.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <h2>Your data</h2>
    <p>Setup, edits and logs are saved only on this device. No sync, no account, no analytics. Use Export in Setup to back up.</p>
  `;
}

// ---------------------------------------------------------------- events

function bind() {
  on(root, 'click', '[data-go-day]', (e, el) => {
    view = { name: 'day', date: el.dataset.goDay };
    flash = '';
    openLogs.clear();
    render();
  });
  on(root, 'click', '[data-go]', (e, el) => go(el.dataset.go, view.date || today));

  // Set buttons (lifting) and checkboxes (runs)
  on(root, 'click', 'button[data-check]', (e, el) => {
    const l = touch(logFor(view.date));
    const id = el.dataset.check;
    if (l.checks[id]) delete l.checks[id];
    else l.checks[id] = true;
    commit();
  });
  on(root, 'change', 'input[type=checkbox][data-check]', (e, el) => {
    const l = touch(logFor(view.date));
    if (el.checked) l.checks[el.dataset.check] = true;
    else delete l.checks[el.dataset.check];
    commit();
  });
  on(root, 'change', 'input[data-pain]', (e, el) => {
    logFor(view.date).pain = el.checked;
    commit();
  });
  on(root, 'click', '[data-effort]', (e, el) => {
    const l = logFor(view.date);
    const k = el.dataset.effort;
    l.effort[k] = l.effort[k] === el.dataset.value ? undefined : el.dataset.value;
    if (!l.effort[k]) delete l.effort[k];
    commit();
  });
  // Text fields: save without re-render to keep focus and the keyboard open.
  on(root, 'input', '[data-actual]', (e, el) => {
    const l = logFor(view.date);
    const a = (l.actual[el.dataset.actual] ??= { reps: '', weight: '' });
    a[el.dataset.field] = el.value;
    saveSoon();
  });
  on(root, 'input', '[data-log]', (e, el) => {
    logFor(view.date)[el.dataset.log] = el.value;
    saveSoon();
  });

  on(root, 'click', 'details.log > summary', (e, el) => {
    const id = el.parentElement.dataset.logId;
    if (el.parentElement.open) openLogs.delete(id);
    else openLogs.add(id);
  });
  on(root, 'click', '[data-count]', (e, el) => {
    view = { name: 'count', date: view.date, item: el.dataset.count };
    render();
    root.scrollTop = 0;
  });
  on(root, 'click', '[data-act]', (e, el) => act(el.dataset.act, el));

  on(root, 'submit', 'form[data-form="setup"]', (e, form) => {
    e.preventDefault();
    const f = new FormData(form);
    const n = (k) => {
      const v = String(f.get(k) ?? '').trim();
      return v === '' ? null : Math.max(0, Math.round(Number(v))) || (Number(v) === 0 ? 0 : null);
    };
    const tri = (k) => ({ true: true, false: false }[f.get(`eq-${k}`)] ?? null);
    state.setup = {
      ...state.setup,
      pull: n('pull'),
      dip: n('dip'),
      push: n('push'),
      jogMinutes: n('jogMinutes'),
      runStartWeek: Number(f.get('runStartWeek')) || 1,
      equipment: { bar: tri('bar'), dipBars: tri('dipBars'), bands: tri('bands'), weights: tri('weights') },
      limitations: String(f.get('limitations') || '').slice(0, 500),
    };
    flash = 'Setup saved.';
    commit();
    root.scrollTop = 0;
  });

  on(root, 'submit', 'form[data-form="edit"]', (e, form) => {
    e.preventDefault();
    const f = new FormData(form);
    const items = textToItems(f.get('items'));
    state.edits[view.date] = {
      title: String(f.get('title') || '').trim(),
      minutes: Number(f.get('minutes')) || null,
      note: String(f.get('note') || ''),
      items,
    };
    state = migrate(state);
    save(state);
    view = { name: 'day', date: view.date };
    flash = 'Workout edited for this date.';
    render();
  });

  on(root, 'change', 'input[data-import]', async (e, el) => {
    const file = el.files?.[0];
    if (!file) return;
    try {
      pendingImport = importJSON(await file.text());
      flash = '';
    } catch (err) {
      pendingImport = null;
      flash = err.message;
    }
    render();
  });
}

async function act(name, el) {
  const date = view.date;
  const w = date ? workoutFor(state, date) : null;
  switch (name) {
    case 'finish': {
      const l = logFor(date);
      pauseClock(l);
      l.status = 'done';
      l.snapshot = { type: w.type, title: w.title, summary: w.summary || '', kinds: Object.fromEntries(w.items.filter((i) => i.movement).map((i) => [i.id, i.kind])) };
      l.updatedAt = new Date().toISOString();
      l.finishedAt = l.updatedAt;
      saveSoon.flush();
      flash = l.pain ? 'Saved. You noted pain: see "When to stop" below, and hold back next time.' : 'Saved.';
      commit();
      root.scrollTop = 0;
      requestPersist().then(() => save(state));
      break;
    }
    case 'skip': {
      const l = logFor(date);
      l.status = 'skipped';
      l.snapshot = { type: w.type, title: w.title, summary: w.summary || '' };
      l.updatedAt = new Date().toISOString();
      flash = '';
      commit();
      break;
    }
    case 'reopen':
      logFor(date).status = null;
      logFor(date).finishedAt = null;
      flash = '';
      commit();
      break;
    case 'edit':
      go('edit', date);
      break;
    case 'make-rest':
      state.edits[el.dataset.date] = { rest: true };
      save(state);
      view = { name: 'day', date: el.dataset.date };
      flash = 'Changed to a rest day.';
      render();
      break;
    case 'restore':
      delete state.edits[el.dataset.date];
      save(state);
      view = { name: 'day', date: el.dataset.date };
      flash = 'Planned workout restored.';
      render();
      break;
    case 'repeat-now': {
      const c = calWeek(today);
      state = repeatWeek(state, el.dataset.track, c);
      flash = `Next week repeats ${el.dataset.track === 'run' ? 'running' : 'lifting'} week ${el.dataset.track === 'run' ? runWeek(state, c) : liftWeek(state, c)}.`;
      commit();
      break;
    }
    case 'repeat-week': {
      const wc = Number(el.dataset.week);
      state = repeatWeek(state, el.dataset.track, wc);
      flash = `${wc === calWeek(today) ? 'Next week' : 'This week'} repeats running week ${runWeek(state, wc)}.`;
      commit();
      break;
    }
    case 'undo-repeat':
      state = undoRepeat(state, el.dataset.track, Number(el.dataset.week) || calWeek(today));
      flash = 'Repeat removed.';
      commit();
      break;
    case 'repeat-prev': {
      const prev = Number(el.dataset.week);
      state = repeatWeek(state, 'run', prev);
      flash = `This week repeats running week ${runWeek(state, prev)}.`;
      commit();
      break;
    }
    case 'use-practice': {
      const checks = practiceChecks(state);
      for (const m of MOVEMENTS) if (checks[m] != null) state.setup[m] = checks[m];
      flash = 'Starting numbers set from your practice rep check.';
      commit();
      break;
    }
    case 'dismiss':
      state.meta.dismissed = { ...(state.meta.dismissed || {}), [el.dataset.key]: true };
      commit();
      break;
    case 'clock': {
      const l = touch(logFor(date));
      if (l.clockStart) pauseClock(l);
      else l.clockStart = new Date().toISOString();
      commit();
      break;
    }
    case 'clock-reset': {
      const l = logFor(date);
      l.clockStart = null;
      l.clockSec = 0;
      commit();
      break;
    }
    case 'tap': {
      counter.n += 1;
      counter.restFrom = null; // a new set has started
      const n = root.querySelector('.tap-n');
      // Update in place: no re-render between fast taps.
      if (n) {
        n.textContent = counter.n;
        el.setAttribute('aria-label', `Add one rep. Count: ${counter.n}`);
        root.querySelector('[data-act="set-save"]')?.removeAttribute('disabled');
        root.querySelector('[data-rest]')?.remove();
        navigator.vibrate?.(15);
      }
      break;
    }
    case 'tap-minus':
      counter.n = Math.max(0, counter.n - 1);
      render();
      break;
    case 'set-save': {
      const it = w.items.find((i) => i.id === view.item);
      const l = touch(logFor(date));
      const a = (l.actual[it.id] ??= { reps: '', weight: '' });
      const reps = [...parseReps(a.reps), counter.n];
      a.reps = reps.join(', ');
      const set = it.sets[reps.length - 1];
      if (set) l.checks[set.id] = true;
      counter = { ...counter, n: 0, restFrom: Date.now() };
      commit();
      break;
    }
    case 'set-undo': {
      const it = w.items.find((i) => i.id === view.item);
      const l = logFor(date);
      const reps = parseReps(l.actual[it.id]?.reps);
      const last = reps.pop();
      l.actual[it.id].reps = reps.join(', ');
      const set = it.sets[reps.length];
      if (set) delete l.checks[set.id];
      counter = { ...counter, n: last ?? 0, restFrom: null };
      commit();
      break;
    }
    case 'count-close':
      counter = null;
      openLogs.add(view.item); // show the reps just counted
      view = { name: 'day', date };
      render();
      break;
    case 'test-day':
      today = addDays(today, Number(el.dataset.step));
      setTestToday(today);
      view = { name: 'day', date: today };
      flash = '';
      openLogs.clear();
      render();
      root.scrollTop = 0;
      break;
    case 'test-reset':
      clearTest();
      initTest();
      state = emptyState();
      save(state);
      today = testToday();
      view = { name: 'day', date: today };
      flash = 'Test data cleared. Back to Monday, October 19.';
      render();
      break;
    case 'test-exit':
      location.href = exitUrl();
      break;
    case 'export':
      await exportFile();
      break;
    case 'import-yes':
      state = pendingImport;
      pendingImport = null;
      save(state);
      flash = 'Backup imported.';
      render();
      break;
    case 'import-no':
      pendingImport = null;
      render();
      break;
  }
}

async function exportFile() {
  saveSoon.flush();
  const json = exportJSON(state);
  const name = `workout-backup-${today}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // On iPhone home-screen apps, the share sheet is the reliable way to save a file.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function requestPersist() {
  if (state.meta.persistRequested || !navigator.storage?.persist) return;
  state.meta.persistRequested = true;
  try {
    await navigator.storage.persist();
  } catch {}
}
