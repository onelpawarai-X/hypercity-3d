/**
 * Keeps a headless browser attached to the game so the training relay has a
 * client to talk to. Run this, then drive it from tools/rl_smoke.py.
 *
 *   node tools/hold.mjs [seconds] [url]
 */
import puppeteer from 'puppeteer-core';

const seconds = Number(process.argv[2] || 300);
const url = process.argv[3] || process.env.URL || 'http://localhost:12000/';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: 'shell', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await page.click('#start-btn');
console.log('game running, relay attached for', seconds, 's');
await new Promise((r) => setTimeout(r, seconds * 1000));
await browser.close();
