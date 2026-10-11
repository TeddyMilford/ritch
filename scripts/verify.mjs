// End-to-end check of the built app in real browsers at iPhone size.
// Usage: npm run verify   (builds, serves dist/ on :4317, drives Chromium + WebKit)
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const PORT = 4317;
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS || 'test-results';
await mkdir(SHOTS, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve());
  server.on('exit', reject);
  setTimeout(() => reject(new Error('preview server timeout')), 15000);
});

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
    console.log('  ok  ', name);
  } catch (e) {
    results.push(['FAIL', name]);
    console.log('  FAIL', name, '\n       ', e.message.split('\n').slice(0, 6).join(' | '));
  }
}

// Noon in Chicago on a given date (CDT until Nov 1, CST after).
const chicagoNoon = (d) => new Date(`${d}T12:00:00${d < '2026-11-01' ? '-05:00' : '-06:00'}`);

const iphone = devices['iPhone 13'];
const h1 = (page) => page.locator('h1').first().innerText();

// Days are a deck of cards. Rewind to the first card, then step forward to the one whose label matches.
async function toCard(page, name) {
  const prev = page.getByRole('button', { name: 'Previous step' });
  while (await prev.count() && !(await prev.isDisabled())) await prev.click();
  for (let i = 0; i < 12; i++) {
    const l = await page.locator('.pager-l').innerText();
    if (name instanceof RegExp ? name.test(l) : l.startsWith(name)) return;
    await page.getByRole('button', { name: 'Next step' }).click();
  }
  throw new Error(`no card ${name}`);
}
const lastCard = async (page) => {
  const next = page.getByRole('button', { name: 'Next step' });
  while (!(await next.isDisabled())) await next.click();
};
const finish = async (page) => {
  await lastCard(page);
  await page.getByRole('button', { name: 'Finish workout' }).click();
};
const tab = (page, name) => page.locator('.tabbar').getByRole('button', { name, exact: true }).click();
const seg = (page, name) => page.locator('.segtabs').first().getByRole('tab', { name, exact: true }).click();

// No page scrolling: the content pane fits the screen.
async function fits(page, what) {
  const o = await page.evaluate(() => {
    const p = document.querySelector('.pane');
    return { over: p.scrollHeight - p.clientHeight, page: document.documentElement.scrollHeight - innerHeight };
  });
  assert.ok(o.over <= 1 && o.page <= 0, `${what} overflows: ${JSON.stringify(o)}`);
}

async function noHorizontalScroll(page) {
  const o = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    app: document.getElementById('app').scrollWidth,
    w: window.innerWidth,
  }));
  assert.ok(o.doc <= o.w && o.app <= o.w, `overflow: ${JSON.stringify(o)}`);
}

// ---------------------------------------------------------------- Chromium: behaviour + offline
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined, acceptDownloads: true });
  delete context.isMobile;
  const page = await context.newPage();
  await context.clock.setFixedTime(chicagoNoon('2026-10-09'));
  console.log('Chromium @ iPhone 13 viewport');

  await step('before Oct 19 shows a preparation screen, nothing overdue', async () => {
    await page.goto(URL);
    assert.equal(await h1(page), 'Training starts Monday, October 19');
    assert.ok(await page.getByText('10 days to go').isVisible());
    assert.equal(await page.getByRole('button', { name: 'Finish workout' }).count(), 0);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/01-prep.png`, fullPage: false });
  });

  await step('optional setup accepts "I don\'t know yet" (blank) and saves', async () => {
    await page.getByRole('button', { name: 'Open setup' }).click();
    await page.fill('input[name=dip]', '8');
    await seg(page, 'Notes');
    await page.fill('textarea[name=limitations]', 'Right shoulder stiff in the mornings');
    await seg(page, 'Reps');
    assert.equal(await page.inputValue('input[name=dip]'), '8', 'switching tabs keeps unsaved fields');
    await page.getByRole('button', { name: 'Save setup' }).click();
    assert.ok(await page.getByText('Setup saved.').isVisible());
    await page.screenshot({ path: `${SHOTS}/02-setup.png`, fullPage: true });
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('workout.v1')).setup);
    assert.equal(s.pull, null);
    assert.equal(s.dip, 8);
  });

  await step('Oct 19 is the first run, week 1 of Couch to 5K', async () => {
    await context.clock.setFixedTime(chicagoNoon('2026-10-19'));
    await page.goto(URL);
    assert.equal(await h1(page), 'Run');
    assert.match(await page.locator('.weekline').innerText(), /Mon, Oct 19 · Week 1 · Couch to 5K, week 1, run 1 of 3/);
    await toCard(page, 'Session');
    assert.ok(await page.getByText('Run 1 min, walk 90 sec').isVisible());
    assert.ok(await page.locator('.items').getByText('Brisk walk, 5 min').first().isVisible());
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/03-run-day.png`, fullPage: true });
  });

  await step('week strip runs Sunday to Saturday: Oct 18 rest, M/W/S run, Tue/Thu lift, Fri rest', async () => {
    const types = await page.locator('.week .wk-t').allInnerTexts();
    assert.deepEqual(types, ['Rest', 'Run', 'Lift', 'Run', 'Lift', 'Rest', 'Run']);
    assert.deepEqual(await page.locator('.week .wk-d').allInnerTexts(), ['S 18', 'M 19', 'T 20', 'W 21', 'T 22', 'F 23', 'S 24']);
  });

  await step('Oct 19 - Jan 3, day by day: M/W/S run, Sun/Tue/Thu lift, Fri rest', async () => {
    await toCard(page, 'Overview');
    const expect = [/^(Run|5K check)/, /^Strength|^Check-in/, /^(Run|5K check)/, /^Strength|^Check-in/, /^Rest day$/, /^(Run|5K check)/, /^Strength C/];
    for (let i = 0; i < 77; i++) {
      const title = await h1(page);
      assert.match(title, expect[i % 7], `day ${i}: ${title}`);
      const wl = await page.locator('.weekline').innerText();
      assert.match(wl, new RegExp(`· Week ${Math.floor((i + 1) / 7) + 1}( |$)`), `day ${i}: ${wl}`); // Sundays open a week
      await page.getByRole('button', { name: 'Next day' }).click();
    }
    await page.getByRole('button', { name: 'Back to today' }).click();
    assert.equal(await h1(page), 'Run');
  });

  await step('complete a run: checks, effort, note, Finish; survives reload', async () => {
    await toCard(page, 'Session');
    for (const box of await page.locator('input[type=checkbox][data-check]').all()) await box.check();
    await lastCard(page);
    await page.getByRole('button', { name: 'About right' }).click();
    await page.fill('input[data-log=distance]', '2.4 km');
    await page.fill('textarea[data-log=note]', 'Felt fine');
    await page.getByRole('button', { name: 'Finish workout' }).click();
    assert.equal(await page.locator('.pager-l').innerText(), 'Overview 1/4', 'back to the overview after Finish');
    assert.ok(await page.locator('.done-box').isVisible());
    await page.reload();
    assert.ok(await page.locator('.done-box').isVisible());
    assert.match(await page.locator('.done-box').innerText(), /Felt fine/);
    assert.ok((await page.locator('.wk.sel .wk-s').innerText()).includes('✓'), 'strip mark: ' + await page.locator('.wk.sel .wk-s').innerText());
  });

  await step('Oct 20 lifting: baseline-unknown effort sets + known dips; reps & weight saved', async () => {
    await context.clock.setFixedTime(chicagoNoon('2026-10-20'));
    await page.reload();
    assert.equal(await h1(page), 'Strength A');
    assert.ok(await page.getByText('Your note:').isVisible());
    assert.match(await page.locator('.glance').innerText(), /Parallel-bar dips\s+5 · 5 · 5/);
    await page.screenshot({ path: `${SHOTS}/04-lift-day.png` });
    await toCard(page, 'Parallel-bar dips');
    assert.match(await page.locator('.item').innerText(), /3 × 5/); // max 8 -> 5, intro week = one fewer set
    await toCard(page, 'Pull-ups');
    const pull = page.locator('.item');
    assert.match(await pull.innerText(), /stopping with 2-3 clean reps left/);
    await pull.locator('button.set').first().click();
    await pull.locator('details.log summary').click();
    await pull.locator('input[data-field=reps]').fill('5, 4');
    await toCard(page, 'Goblet squat');
    await page.locator('details.log summary').click();
    await page.locator('input[data-field=weight]').fill('35 lb');
    await page.waitForTimeout(600);
    await page.reload();
    await toCard(page, 'Pull-ups');
    assert.equal(await page.locator('button.set.on').count(), 1);
    assert.equal(await page.locator('input[data-field=reps]').inputValue(), '5, 4');
    await toCard(page, 'Goblet squat');
    assert.equal(await page.locator('input[data-field=weight]').inputValue(), '35 lb');
    await finish(page);
  });

  await step('logged reps set the next session target (no max test needed)', async () => {
    await page.getByRole('button', { name: 'Next day' }).click();
    await page.getByRole('button', { name: 'Next day' }).click();
    await toCard(page, 'Pull-ups');
    assert.match(await page.locator('.item').innerText(), /2 × 4/);
  });

  await step('edit a future workout; survives reload', async () => {
    await lastCard(page);
    await page.getByRole('button', { name: 'Edit this workout' }).click();
    await page.fill('input[name=title]', 'Short strength');
    await page.fill('textarea[name=items]', 'Pull-ups | 3 × 3\nPush-ups | 2 × 10');
    await page.getByRole('button', { name: 'Save changes' }).click();
    assert.equal(await h1(page), 'Short strength');
    await page.reload(); // reload returns to today
    await page.getByRole('button', { name: 'Next day' }).click();
    await page.getByRole('button', { name: 'Next day' }).click();
    assert.equal(await h1(page), 'Short strength');
    assert.match(await page.locator('.glance').innerText(), /Pull-ups[\s\S]*Push-ups/);
    assert.equal(await page.locator('.pager .dot').count(), 4, 'overview, two exercises, finish');
  });

  await step('mark skipped: next run unchanged (no doubling)', async () => {
    await context.clock.setFixedTime(chicagoNoon('2026-10-21'));
    await page.reload();
    await toCard(page, 'Session');
    const before = await page.locator('.items').innerText();
    await lastCard(page);
    await page.getByRole('button', { name: 'Mark skipped' }).click();
    assert.ok(await page.locator('.skip-box').isVisible());
    await page.getByRole('button', { name: 'Next day' }).click();
    await page.getByRole('button', { name: 'Next day' }).click();
    await page.getByRole('button', { name: 'Next day' }).click();
    assert.equal(await h1(page), 'Run');
    assert.match(await page.locator('.meta').innerText(), /About 29 min/);
    await toCard(page, 'Session');
    assert.equal(await page.locator('.items').innerText(), before);
  });

  await step('Saturday after the run: asks to continue or repeat next week', async () => {
    await context.clock.setFixedTime(chicagoNoon('2026-10-24'));
    await page.reload();
    assert.equal(await page.getByText('Next week:').count(), 0, 'not before the run is done');
    await finish(page);
    assert.match(await page.locator('.callout', { hasText: 'Next week:' }).innerText(), /Couch to 5K, week 2[\s\S]*Repeat week 1/);
  });

  await step('repeat this week: next week repeats, past logs preserved', async () => {
    await lastCard(page);
    await page.getByRole('button', { name: 'Repeat this week…' }).click();
    await page.getByRole('button', { name: 'Repeat running week 1' }).click();
    assert.ok(await page.getByText('Next week repeats running week 1.').first().isVisible());
    assert.match(await page.locator('.item', { hasText: 'Timeline' }).innerText(), /Dec 26, 2026, after the Dec 31 target|Sat, Dec 26, 2026/);
    await page.screenshot({ path: `${SHOTS}/05-repeat.png` });
    await context.clock.setFixedTime(chicagoNoon('2026-10-26'));
    await page.reload();
    assert.match(await page.locator('.weekline').innerText(), /Week 2 · Couch to 5K, week 1, run 1 of 3 \(repeat\)/);
    await tab(page, 'History');
    const hist = await page.locator('.history').innerText();
    assert.match(hist, /Mon, Oct 19[\s\S]*Done/);
    assert.match(hist, /Felt fine/);
    assert.match(hist, /Skipped/);
    await page.screenshot({ path: `${SHOTS}/06-history.png` });
  });

  let backup;
  await step('export JSON downloads a backup', async () => {
    await tab(page, 'Setup');
    await seg(page, 'Backup');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
    backup = `${SHOTS}/backup.json`;
    await dl.saveAs(backup);
    const json = JSON.parse(await readFile(backup, 'utf8'));
    assert.equal(json.app, 'workout');
    assert.equal(json.logs['2026-10-19'].status, 'done');
    assert.deepEqual(json.repeats.run, [1]);
  });

  await step('import JSON restores everything after data is wiped', async () => {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await tab(page, 'History');
    assert.ok(await page.getByText('Nothing logged yet.').isVisible(), 'history after wipe: ' + await page.locator('#app').innerText());
    await tab(page, 'Setup');
    await seg(page, 'Backup');
    await page.setInputFiles('input[data-import]', backup);
    await page.getByRole('button', { name: 'Replace' }).click();
    assert.ok(await page.getByText('Backup imported.').isVisible());
    assert.equal(await page.inputValue('input[name=dip]'), '8');
    await tab(page, 'Today');
    assert.match(await page.locator('.weekline').innerText(), /\(repeat\)/);
    await tab(page, 'History');
    assert.match(await page.locator('.history').innerText(), /Felt fine/);
  });

  await step('works offline after first load (service worker)', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page is SW-controlled');
    await context.setOffline(true);
    await page.reload();
    assert.equal(await page.locator('.wk').count(), 7);
    await tab(page, 'History');
    assert.match(await page.locator('.history').innerText(), /Felt fine/);
    await context.setOffline(false);
  });

  await step('manifest is valid for install (standalone, icons)', async () => {
    const m = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some((i) => i.sizes === '512x512'));
    const touch = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=apple-touch-icon]').href)).status);
    assert.equal(touch, 200);
  });

  await browser.close();
}

// ---------------------------------------------------------------- Testing mode
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: iphone.viewport });
  const page = await context.newPage();
  await context.clock.setFixedTime(chicagoNoon('2026-10-09'));
  console.log('Testing mode');
  await step('?test simulates day one and steps through a week, separate from real data', async () => {
    await page.goto(URL);
    await page.evaluate(() => localStorage.setItem('workout.v1', JSON.stringify({ logs: { '2026-10-19': { status: 'skipped' } } })));
    await page.getByRole('link', { name: 'Try week 1 in testing mode' }).click();
    assert.match(await page.locator('.testbar').innerText(), /Testing mode · Mon, Oct 19/);
    assert.equal(await h1(page), 'Run');
    assert.equal(await page.locator('.skip-box').count(), 0, 'real log not shown');
    await finish(page);
    const titles = [];
    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: 'Simulate next day' }).click();
      titles.push(await h1(page));
    }
    assert.deepEqual(titles, ['Strength A', 'Run', 'Strength B', 'Rest day', 'Run', 'Strength C']);
    await page.reload();
    assert.match(await page.locator('.testbar').innerText(), /Sun, Oct 25/, 'simulated day survives reload');
    const real = await page.evaluate(() => JSON.parse(localStorage.getItem('workout.v1')).logs);
    assert.deepEqual(Object.keys(real), ['2026-10-19']);
    assert.equal(real['2026-10-19'].status, 'skipped', 'real data untouched');
    await page.getByRole('button', { name: 'Reset' }).click();
    assert.match(await page.locator('.testbar').innerText(), /Mon, Oct 19/);
    assert.equal(await page.locator('.done-box').count(), 0);
    await page.getByRole('button', { name: 'Exit' }).click();
    await page.waitForURL(URL);
    assert.equal(await page.locator('.testbar').count(), 0);
    assert.equal(await h1(page), 'Training starts Monday, October 19');
  });
  await browser.close();
}

// ---------------------------------------------------------------- Tracking: rep counter, rest timer, run timer, progress
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: iphone.viewport, hasTouch: true });
  const page = await context.newPage();
  console.log('Tracking');
  await context.clock.install({ time: new Date('2026-10-20T18:00:00-05:00') });
  await page.goto(URL);
  await page.evaluate(() => localStorage.setItem('workout.v1', JSON.stringify({ setup: { pull: 10 } })));
  await page.reload();
  const pull = () => page.locator('.item', { hasText: 'Pull-ups' }).first(); // on the Pull-ups card
  const tapN = async (n) => { for (let i = 0; i < n; i++) await page.locator('button.tap').tap(); };

  await step('rep counter: tap per rep, save each set, rest timer, undo', async () => {
    assert.equal(await h1(page), 'Strength A');
    await toCard(page, 'Pull-ups');
    await pull().getByRole('button', { name: 'Count reps · set 1 of 4' }).click();
    await fits(page, 'counter');
    assert.match(await page.locator('.meta').innerText(), /Set 1 of 4 · target 6/);
    assert.ok(await page.locator('button[data-act=set-save]').isDisabled(), 'nothing to save at 0');
    await tapN(7);
    await page.getByRole('button', { name: 'Remove one rep' }).click();
    assert.equal(await page.locator('.tap-n').innerText(), '6');
    await page.getByRole('button', { name: 'Save set 1' }).click();
    assert.match(await page.locator('.meta').innerText(), /Set 2 of 4/);
    assert.match(await page.locator('.rest').innerText(), /Rest 0:00 · aim for 2-3 min/);
    await context.clock.runFor(125_000);
    assert.match(await page.locator('.rest').innerText(), /Rest 2:0\d · aim for 2-3 min · ready for set 2/);
    await tapN(6);
    assert.equal(await page.locator('.rest').count(), 0, 'rest timer clears when the next set starts');
    await page.getByRole('button', { name: 'Save set 2' }).click();
    await page.getByRole('button', { name: 'Undo last saved set' }).click();
    assert.match(await page.locator('.meta').innerText(), /Set 2 of 4/);
    assert.equal(await page.locator('.tap-n').innerText(), '6', 'undo puts the count back');
    await page.getByRole('button', { name: 'Save set 2' }).click();
    await tapN(5);
    await page.getByRole('button', { name: 'Save set 3' }).click();
    await tapN(5);
    await page.getByRole('button', { name: 'Save set 4' }).click();
    assert.match(await page.locator('.done-box').innerText(), /All 4 sets saved: 6, 6, 5, 5/);
    await page.getByRole('button', { name: 'Hard' }).click();
    await page.screenshot({ path: `${SHOTS}/07-counter-done.png` });
    await page.getByRole('button', { name: 'Back to workout', exact: true }).click();
    assert.match(await page.locator('.pager-l').innerText(), /^Pull-ups/, 'returns to the same card');
    assert.equal(await pull().locator('input[data-field=reps]').inputValue(), '6, 6, 5, 5');
    assert.deepEqual(await pull().locator('button.set.on').allInnerTexts(), ['6', '6', '5', '5']);
    assert.ok(await pull().getByRole('button', { name: 'Hard' }).getAttribute('aria-pressed') === 'true');
  });

  await step('Finish records how long the session took', async () => {
    await context.clock.runFor(30 * 60_000);
    await finish(page);
    assert.match(await page.locator('.done-box').innerText(), /Took 3\d min/);
    const l = await page.evaluate(() => JSON.parse(localStorage.getItem('workout.v1')).logs['2026-10-20']);
    assert.equal(l.snapshot.kinds.pull, 'working');
  });

  await step('run session timer keeps time across reloads and fills in Time', async () => {
    await context.clock.setSystemTime(new Date('2026-10-21T07:00:00-05:00'));
    await page.reload();
    assert.equal(await h1(page), 'Run');
    await toCard(page, 'Session');
    await page.getByRole('button', { name: 'Start session timer' }).click();
    await context.clock.runFor(10 * 60_000);
    await page.reload(); // e.g. the app was closed mid-run
    assert.match(await page.locator('.pager-l').innerText(), /^Session/, 'reopens on the running session');
    await context.clock.runFor(19 * 60_000 + 15_000);
    // The installed clock also moves in real time during reloads, so allow a few seconds.
    assert.match(await page.locator('.clock-t').innerText(), /^29:(1[5-9]|2\d)$/);
    await page.getByRole('button', { name: 'Pause' }).click();
    const clock = await page.locator('.clock-t').innerText();
    await lastCard(page);
    const time = await page.inputValue('input[data-log=time]');
    assert.match(time, /^29:(1[5-9]|2\d)$/);
    assert.equal(clock, time, 'paused clock and Time agree');
    await page.getByRole('button', { name: 'Finish workout' }).click();
  });

  await step('Progress: consistency grid, rep totals, chart, runs, weekly table', async () => {
    await tab(page, 'Progress');
    assert.equal(await h1(page), 'Progress');
    const text = () => page.locator('.pane').innerText();
    assert.match(await text(), /2 of 3 workouts done so far/); // Monday's run was never logged
    assert.match(await text(), /Pull-ups\s+22 reps logged · goal 25/);
    await fits(page, 'progress summary');
    await seg(page, 'Days');
    assert.equal(await page.locator('.cg.miss').count(), 1);
    assert.equal(await page.locator('.cg.done').count(), 2);
    await seg(page, 'Lifts');
    assert.match(await text(), /Total reps logged\s+22/);
    assert.match(await text(), /Best set logged\s+6/);
    assert.match(await text(), /At setup\s+10/);
    assert.equal(await page.locator('svg.chart').count(), 1, 'one chart: pull-ups');
    await fits(page, 'progress lifts');
    await page.screenshot({ path: `${SHOTS}/08-progress.png` });
    await seg(page, 'Runs');
    assert.match(await page.locator('.history').innerText(), /29:\d\d/);
    await seg(page, 'Weeks');
    assert.match(await page.locator('table.weeks').innerText(), /1\s+2\/3\s+22/);
    await noHorizontalScroll(page);
  });

  await step('Sunday: week recap and the choice to repeat last week', async () => {
    await context.clock.setSystemTime(new Date('2026-10-25T12:00:00-05:00'));
    await page.goto(URL);
    assert.equal(await h1(page), 'Strength C');
    assert.match(await page.locator('.weekline').innerText(), /· Week 2/);
    const box = await page.locator('.callout', { hasText: 'Week 1:' }).innerText();
    assert.match(box, /2 of 5 workouts done · 22 pull-ups · 29:\d\d running/);
    assert.match(box, /This week:[\s\S]*Repeat week 1/);
    await page.getByRole('button', { name: 'Repeat week 1' }).click();
    assert.match(await page.locator('.callout', { hasText: 'Week 1:' }).innerText(), /This week repeats running week 1/);
    await page.getByRole('button', { name: 'Next day' }).click();
    assert.match(await page.locator('.weekline').innerText(), /Couch to 5K, week 1, run 1 of 3 \(repeat\)/);
  });
  await browser.close();
}

// ---------------------------------------------------------------- One screen: no page scrolling, swipe between cards
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined });
  const page = await context.newPage();
  console.log('One screen (iPhone 13 in Safari: 390 × 664)');
  await context.clock.setFixedTime(chicagoNoon('2026-10-20'));
  await page.goto(URL);
  await page.evaluate(() => localStorage.setItem('workout.v1', JSON.stringify({ setup: { pull: 8, dip: 10, push: 20, limitations: 'Right shoulder stiff in the mornings' } })));

  await step('every card of practice, run, lift and rest days fits without scrolling', async () => {
    for (const d of ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-15', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-22', '2026-10-25', '2026-11-15', '2026-11-17', '2026-12-30']) {
      await context.clock.setFixedTime(chicagoNoon(d));
      await page.goto(URL);
      const n = Math.max(1, await page.locator('.pager .dot').count());
      for (let i = 0; i < n; i++) {
        await fits(page, `${d} card ${i + 1} (${n > 1 ? await page.locator('.pager-l').innerText() : 'single'})`);
        if (i < n - 1) await page.getByRole('button', { name: 'Next step' }).click();
      }
    }
  });

  await step('swipe left and right moves between cards', async () => {
    await context.clock.setFixedTime(chicagoNoon('2026-10-20'));
    await page.goto(URL);
    const swipe = (dx) => page.evaluate((dx) => {
      const pane = document.querySelector('.pane');
      const at = (x) => new Touch({ identifier: 1, target: pane, clientX: x, clientY: 300 });
      pane.dispatchEvent(new TouchEvent('touchstart', { touches: [at(200)], changedTouches: [at(200)], bubbles: true }));
      pane.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [at(200 + dx)], bubbles: true }));
    }, dx);
    await swipe(-120);
    assert.match(await page.locator('.pager-l').innerText(), /^Warm-up 2\/9/);
    await swipe(-120);
    assert.match(await page.locator('.pager-l').innerText(), /^Pull-ups 3\/9/);
    await swipe(30); // too short: not a swipe
    assert.match(await page.locator('.pager-l').innerText(), /^Pull-ups/);
    await swipe(120);
    assert.match(await page.locator('.pager-l').innerText(), /^Warm-up/);
  });

  await step('counter, progress, history and setup fit without scrolling', async () => {
    await toCard(page, 'Pull-ups');
    await page.getByRole('button', { name: /Count reps/ }).click();
    await fits(page, 'counter');
    await page.getByRole('button', { name: '‹ Back to workout' }).click();
    await context.clock.setFixedTime(chicagoNoon('2026-12-31'));
    await page.goto(URL);
    await tab(page, 'Progress');
    for (const t of ['Summary', 'Days', 'Lifts', 'Runs', 'Weeks']) {
      await seg(page, t);
      await fits(page, `progress ${t}`);
    }
    await tab(page, 'Setup');
    for (const t of ['Reps', 'Running', 'Gear', 'Notes', 'Backup']) {
      await seg(page, t);
      await fits(page, `setup ${t}`);
    }
    await tab(page, 'About');
    for (const t of ['Plan', 'Reps', 'Lifting', 'Running']) {
      await seg(page, t);
      await fits(page, `about ${t}`);
    }
  });
  await browser.close();
}

// ---------------------------------------------------------------- Practice week
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: iphone.viewport, hasTouch: true });
  const page = await context.newPage();
  console.log('Practice week');
  await context.clock.setFixedTime(chicagoNoon('2026-10-11'));
  await step('practice week Oct 11-17: easier sessions, real start still Oct 19', async () => {
    await page.goto(URL);
    assert.equal(await h1(page), 'Practice strength A');
    assert.match(await page.locator('.weekline').innerText(), /Practice week · week 1 starts in 8 days/);
    assert.deepEqual(await page.locator('.week .wk-d').allInnerTexts(), ['S 11', 'M 12', 'T 13', 'W 14', 'T 15', 'F 16', 'S 17']);
    await page.getByRole('button', { name: 'Next day' }).click();
    assert.equal(await h1(page), 'Practice run');
    assert.match(await page.locator('.meta').innerText(), /About 22 min/);
  });
  await step('practice strength: counter works, rep check offered as starting numbers', async () => {
    await context.clock.setFixedTime(chicagoNoon('2026-10-13'));
    await page.reload();
    assert.equal(await h1(page), 'Practice strength A');
    await toCard(page, 'Pull-ups');
    await page.getByRole('button', { name: /Count reps/ }).click();
    assert.match(await page.locator('.meta').innerText(), /stop with 3-4 clean reps left/);
    for (let i = 0; i < 4; i++) await page.locator('button.tap').tap();
    await page.getByRole('button', { name: 'Save set 1' }).click();
    await page.getByRole('button', { name: '‹ Back to workout' }).click();
    await finish(page);

    await context.clock.setFixedTime(chicagoNoon('2026-10-15'));
    await page.reload();
    assert.equal(await h1(page), 'Practice strength B');
    await toCard(page, 'Pull-ups: clean-rep check');
    await page.locator('input[data-field=reps]').fill('9');
    await toCard(page, 'Push-ups: clean-rep check');
    await page.locator('input[data-field=reps]').fill('22');
    await page.waitForTimeout(500);
    await finish(page);

    await context.clock.setFixedTime(chicagoNoon('2026-10-17'));
    await page.reload();
    await finish(page);
    const box = await page.locator('.callout', { hasText: 'Practice week:' }).innerText();
    assert.match(box, /3 of 6 sessions done/);
    assert.match(box, /9 pull-ups, 22 push-ups/);
    await page.screenshot({ path: `${SHOTS}/09-practice-end.png` });
    await page.getByRole('button', { name: 'Use as my starting numbers' }).click();
    const setup = await page.evaluate(() => JSON.parse(localStorage.getItem('workout.v1')).setup);
    assert.equal(setup.pull, 9);
    assert.equal(setup.push, 22);
    assert.equal(setup.dip, null, 'no dip check: still "I don\'t know yet"');

    await context.clock.setFixedTime(chicagoNoon('2026-10-20'));
    await page.reload();
    await toCard(page, 'Pull-ups');
    assert.match(await page.locator('.item').innerText(), /× 5/);
    await tab(page, 'Progress');
    assert.match(await page.locator('#app').innerText(), /0 of 1 workouts done/, 'practice not counted in progress');
  });
  await browser.close();
}

// ---------------------------------------------------------------- Midnight rollover (fresh context, running clock)
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: iphone.viewport });
  const page = await context.newPage();
  console.log('Midnight rollover');
  await step('app open across midnight Chicago time switches to the new today', async () => {
    await context.clock.install({ time: new Date('2026-10-19T23:59:00-05:00') });
    await page.goto(URL);
    assert.equal(await h1(page), 'Run');
    await context.clock.runFor(90_000); // 23:59 -> 00:00:30, interval fires
    assert.equal(await h1(page), 'Strength A');
  });
  await step('resume after DST change (Nov 1) recalculates today', async () => {
    // 00:30 CST on Nov 2 = 06:30 UTC; in CDT-only math it would still look like Nov 1
    await context.clock.setFixedTime(new Date('2026-11-02T06:30:00Z'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.match(await page.locator('.dayline .date').innerText(), /Mon, Nov 2/);
  });
  await browser.close();
}

// ---------------------------------------------------------------- WebKit (Safari engine) layout at iPhone size
{
  const browser = await webkit.launch();
  console.log('WebKit @ iPhone 13 / SE');
  for (const [name, dev] of [['iphone13', devices['iPhone 13']], ['iphoneSE', devices['iPhone SE']], ['iphone15promax', devices['iPhone 15 Pro Max'] || devices['iPhone 14 Pro Max']]]) {
    const context = await browser.newContext({ ...dev });
    const page = await context.newPage();
    await context.clock.setFixedTime(chicagoNoon('2026-10-22'));
    await step(`${name}: lifting + rest + about render without horizontal scroll`, async () => {
      await page.goto(URL);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `${SHOTS}/wk-${name}-lift.png` });
      await page.getByRole('button', { name: 'Next day' }).click();
      assert.equal(await h1(page), 'Rest day');
      await noHorizontalScroll(page);
      await page.screenshot({ path: `${SHOTS}/wk-${name}-rest.png` });
      // The consistency grid shrinks its cells to fit late in the plan, so it's left out of this check.
      const smallTargets = () => page.evaluate(() => [...document.querySelectorAll('button:not(.link):not([disabled]):not(.cg)')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.className + ' ' + b.textContent.trim()));
      await tab(page, 'About');
      await noHorizontalScroll(page);
      assert.deepEqual(await smallTargets(), [], 'touch targets >= 44px');
      await tab(page, 'Progress');
      assert.equal(await h1(page), 'Progress');
      await noHorizontalScroll(page);
      assert.deepEqual(await smallTargets(), [], 'progress touch targets >= 44px');
      await page.screenshot({ path: `${SHOTS}/wk-${name}-progress.png` });
      await tab(page, 'Today');
      await toCard(page, 'Pull-ups');
      assert.deepEqual(await smallTargets(), [], 'workout touch targets >= 44px');
      await page.getByRole('button', { name: /Count reps/ }).click();
      await noHorizontalScroll(page);
      const tap = await page.locator('button.tap').boundingBox();
      assert.ok(tap.height >= 200 && tap.width >= 280, `big tap target: ${JSON.stringify(tap)}`);
      await page.screenshot({ path: `${SHOTS}/wk-${name}-counter.png` });
    });
    await context.close();
  }
  {
    const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
    const page = await context.newPage();
    await context.clock.setFixedTime(chicagoNoon('2026-12-30'));
    await step('dark mode, 5K check day on Dec 30', async () => {
      await page.goto(URL);
      assert.equal(await h1(page), '5K check (optional)');
      assert.match(await page.locator('body').innerText(), /7:00 per km/);
      await page.screenshot({ path: `${SHOTS}/wk-dark-5k.png` });
    });
    await context.close();
  }
  await browser.close();
}

server.kill();
const failed = results.filter(([r]) => r === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${SHOTS}/`);
process.exit(failed ? 1 : 0);
