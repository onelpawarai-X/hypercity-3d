import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--window-size=1280,800'] });
const p = await b.newPage();
await p.setViewport({width:1280,height:800});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)',{timeout:300000});
await new Promise(r=>setTimeout(r,2500));
await p.screenshot({path:'/tmp/g0-select.png'});
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));
await p.screenshot({path:'/tmp/g1-street.png'});
// spawn and drive a car
await p.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit1'})));
await new Promise(r=>setTimeout(r,2500));
await p.screenshot({path:'/tmp/g2-car.png'});
// helicopter
await p.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit4'})));
await new Promise(r=>setTimeout(r,3000));
await p.screenshot({path:'/tmp/g3-heli.png'});
console.log('ERR', errs.slice(0,4));
await b.close();
