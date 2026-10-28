/**
 * Checks the agent-training API inside a real page, without the relay.
 *
 * tools/rl_smoke.py exercises the WebSocket transport, which needs the relay
 * running locally. This one talks to `window.HyperCity` directly, so it can
 * validate a deployment that only serves static files - a GitHub Pages build,
 * for example - where no relay process exists.
 *
 *   node tools/api_check.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || process.env.URL || 'http://localhost:12000/';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: 'shell', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await page.click('#start-btn');
await new Promise((r) => setTimeout(r, 3000));

const result = await page.evaluate(async () => {
  const api = window.HyperCity;
  if (!api) return { ok: false, reason: 'window.HyperCity is missing' };

  const ping = await api.request({ id: 1, cmd: 'ping' });
  const made = await api.request({ id: 2, cmd: 'make', archetype: 'xbot' });
  const env = made.env;
  if (!env) return { ok: false, reason: `make returned no env: ${JSON.stringify(made)}` };

  // The reply id must survive the round trip, or a trainer cannot match it.
  const echo = await api.request({ id: 3, cmd: 'reset', env });

  await api.request({ id: 4, cmd: 'goal', env, x: 0, z: 0 });
  let step = null;
  for (let i = 0; i < 60; i++) {
    step = await api.request({ id: 100 + i, cmd: 'step', env, action: [1, 0, 0, 1] });
  }
  const obs = await api.request({ id: 5, cmd: 'observe', env });
  await api.request({ id: 6, cmd: 'close', env });

  return {
    ok: true, env, pingOk: ping.ok === true, resetEchoId: echo.id,
    lastStepId: step.id, obsSize: obs.obs?.length,
    rewardIsFinite: Number.isFinite(step.reward), doneIsBool: typeof step.done === 'boolean',
  };
});

await browser.close();

const checks = [
  ['window.HyperCity is exposed', result.ok === true],
  ['ping answers', result.pingOk === true],
  ['make returns an env id', typeof result.env === 'string' && result.env.length > 0],
  ['replies echo the request id', result.resetEchoId === 3 && result.lastStepId === 159],
  ['observation is 9 floats', result.obsSize === 9],
  ['step returns a finite reward and a done flag', result.rewardIsFinite && result.doneIsBool],
  ['page ran without errors', errors.length === 0],
];
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
if (errors.length) console.log('errors:', errors);
const failed = checks.filter(([, p]) => !p).length;
console.log(failed ? `\n${failed} FAILED` : '\ntraining API OK');
process.exit(failed ? 1 : 0);
