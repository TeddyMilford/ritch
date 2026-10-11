// Testing mode: open the app with ?test (or ?test=2026-10-22) to simulate "today"
// and step through days. It uses its own storage key, so real logs are never touched.

import { isDate } from './dates.js';
import { START } from './plan.js';

export const TEST_STORAGE_KEY = 'workout.test.v1';
const DATE_KEY = 'workout.test.today';

const params = new URLSearchParams(globalThis.location?.search || '');
export const TEST = params.has('test');

function get(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function set(k, v) {
  try { localStorage.setItem(k, v); } catch {}
}

export function initTest() {
  if (!TEST) return;
  const d = params.get('test');
  if (isDate(d)) set(DATE_KEY, d);
  else if (!isDate(get(DATE_KEY))) set(DATE_KEY, START);
}

export function testToday() {
  const d = get(DATE_KEY);
  return isDate(d) ? d : START;
}

export function setTestToday(d) {
  set(DATE_KEY, d);
}

export function clearTest() {
  try {
    localStorage.removeItem(DATE_KEY);
    localStorage.removeItem(TEST_STORAGE_KEY);
  } catch {}
}

// Same page without ?test
export function exitUrl() {
  return location.pathname;
}
