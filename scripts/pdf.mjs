// Prints the whole plan to ritch.pdf, one row per day, with a box to tick.
// Usage: npm run pdf

import { chromium } from 'playwright';
import { FIRST, LAST, workout, howMuch, label, addDays } from '../site/plan.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

let rows = '';
let lastTag = '';
for (let date = FIRST; date <= LAST; date = addDays(date, 1)) {
  const w = workout(date);
  if (w.tag !== lastTag) {
    rows += `<tr class="week"><td colspan="4">${esc(w.tag)}</td></tr>`;
    lastTag = w.tag;
  }
  const lines = (w.rest ? [] : w.items)
    .flatMap((it) => (it.lines ? it.lines : [[it.name, howMuch(it)]]))
    .map(([what, how]) => `${esc(what)} <b>${esc(how)}</b>`)
    .join('<br>');
  rows += `<tr><td class="box">${w.rest ? "" : "☐"}</td><td class="date">${label(date)}</td><td class="title">${w.title}</td><td>${lines}${w.note ? `<br><i>${esc(w.note)}</i>` : ''}</td></tr>`;
}

const html = `<!doctype html><meta charset="utf-8"><style>
  body { font: 10px/1.4 -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 28px; font-weight: 600; margin: 0 0 4px; }
  .sub { color: #666; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  td { border-top: 1px solid #ccc; padding: 4px 6px 4px 0; vertical-align: top; }
  tr { break-inside: avoid; }
  tr.week td { border-top: 2px solid #111; font-weight: bold; padding-top: 10px; }
  .box { width: 16px; font-size: 13px; }
  .date { width: 80px; white-space: nowrap; }
  .title { width: 40px; font-weight: 600; }
  b { font-weight: 600; }
  i { font-style: normal; color: #666; }
</style>
<h1>Ritch</h1>
<p class="sub">Starting numbers. The app moves the reps up or down from what you log.</p>
<table>${rows}</table>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
await page.pdf({ path: 'ritch.pdf', format: 'Letter', margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' } });
await browser.close();
console.log('Wrote ritch.pdf');
