import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));
const out = await p.evaluate(() => {
  const g = window.game;
  const info = (name) => {
    const cc = g.world.meshes[name];
    const c0 = cc.chunks[0];
    const m = c0.mesh;
    m.geometry.computeBoundingBox();
    const gb = m.geometry.boundingBox;
    const ws = m.matrixWorld.determinant();
    return {
      name, chunks: cc.chunks.length, drawDistance: cc.drawDistance,
      chunk0: {
        center: [+c0.center.x.toFixed(1), +c0.center.y.toFixed(1), +c0.center.z.toFixed(1)],
        radius: +c0.radius.toFixed(1),
        geomBoxNoMatrix: [[+gb.min.x.toFixed(2),+gb.min.y.toFixed(2),+gb.min.z.toFixed(2)],[+gb.max.x.toFixed(2),+gb.max.y.toFixed(2),+gb.max.z.toFixed(2)]],
        matrixDet: +ws.toFixed(3),
        matrixAutoUpdate: m.matrixAutoUpdate,
      },
      centersSpread: (() => {
        let min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
        for (const c of cc.chunks) {
          min=[Math.min(min[0],c.center.x),Math.min(min[1],c.center.y),Math.min(min[2],c.center.z)];
          max=[Math.max(max[0],c.center.x),Math.max(max[1],c.center.y),Math.max(max[2],c.center.z)];
        }
        return { min: min.map(v=>+v.toFixed(1)), max: max.map(v=>+v.toFixed(1)) };
      })(),
    };
  };
  return {
    camera: [+g.camera.position.x.toFixed(1), +g.camera.position.y.toFixed(1), +g.camera.position.z.toFixed(1)],
    groupMatrix: g.world.group.matrixWorld.elements.map(v=>+v.toFixed(3)),
    terrain: info('terrain'),
    roads: info('roads'),
    buildings: info('buildings'),
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
