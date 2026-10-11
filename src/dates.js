// Calendar dates as 'YYYY-MM-DD' strings. Pure functions, no DOM.
// Arithmetic happens in UTC on date-only values, so daylight saving never shifts a day.

export const TIMEZONE = 'America/Chicago';

const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Today's date in America/Chicago, wherever the device is.
export function todayStr(now = new Date()) {
  const parts = Object.fromEntries(ymd.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return fromUTC(toUTC(s) + n * 86400000);
}

// b - a in whole days
export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

// 0 = Sunday ... 6 = Saturday
export function weekday(s) {
  return new Date(toUTC(s)).getUTCDay();
}

// Monday of the week containing s
export function mondayOf(s) {
  return addDays(s, -((weekday(s) + 6) % 7));
}

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(toUTC(s)) === s;
}

export function formatDate(s, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return new Date(toUTC(s)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
