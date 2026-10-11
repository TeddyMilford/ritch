// Renders public/icon.svg to the PNG sizes iOS and the manifest need.
// PNGs are full-bleed squares (no rounded corners): iOS and Android mask them themselves.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const svg = (await readFile('public/icon.svg', 'utf8')).replace('rx="112"', 'rx="0"');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [size, file] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `public/${file}`, omitBackground: false });
  console.log('wrote', file);
}
await browser.close();
