import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await new Promise(r=>setTimeout(r,1500));
const state = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('.roster-card')];
  return {
    cardCount: cards.length,
    labels: cards.map(c => c.querySelector('.rname').textContent),
    selected: cards.find(c=>c.classList.contains('selected'))?.dataset.id,
    previewsRendering: window.game.characterSelect.cards.filter(c=>c.model).length,
    name: document.getElementById('roster-name').textContent,
    blurb: document.getElementById('roster-blurb').textContent,
    playerRig: window.game.player.rig.root.children.length,
  };
});
// pick the robot and confirm the player rig actually swaps
const swapped = await p.evaluate(() => {
  const before = window.game.playerCharacter;
  document.querySelector('.roster-card[data-id="robot"]').click();
  return { before, after: window.game.playerCharacter,
           selected: document.querySelector('.roster-card.selected')?.dataset.id,
           name: document.getElementById('roster-name').textContent };
});
await p.screenshot({path:'/tmp/select.png'});
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));
const after = await p.evaluate(() => ({ started: window.game.started, hud: !document.getElementById('hud').classList.contains('hidden'),
  playerCharacter: window.game.playerCharacter, rigChildren: window.game.player.rig.root.children.length }));
console.log(JSON.stringify({state, swapped, after, errs: errs.slice(0,4)},null,1));
await b.close();
