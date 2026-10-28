import fs from 'node:fs';

/** Read the JSON chunk of a GLB without decoding any geometry. */
function glbJson(path) {
  const buf = fs.readFileSync(path);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error('not a GLB');
  const len = buf.readUInt32LE(12);
  const type = buf.readUInt32LE(16);
  if (type !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  return JSON.parse(buf.slice(20, 20 + len).toString('utf8'));
}

const files = [
  ['buildings', 'public/assets/city/buildings.glb'],
  ['roads', 'public/assets/city/roads.glb'],
  ['terrain', 'public/assets/city/terrain.glb'],
  ['bridges', 'public/assets/city/coastal-bridges.glb'],
  ['shoreline', 'public/assets/city/coastal-shoreline.glb'],
  ['palm', 'public/assets/city/palm.glb'],
  ['lifehub', 'public/assets/city/life-hub.glb'],
  ['car', 'public/assets/vehicles/car.glb'],
  ['helicopter', 'public/assets/air/helicopter.glb'],
  ['jet', 'public/assets/air/jet.glb'],
  ['soldier', 'public/assets/characters/soldier.glb'],
];

for (const [name, path] of files) {
  try {
    const j = glbJson(path);
    const meshes = j.meshes?.length || 0;
    const nodes = j.nodes?.length || 0;
    let prims = 0, verts = 0, tris = 0;
    for (const m of j.meshes || []) {
      for (const p of m.primitives || []) {
        prims++;
        const acc = j.accessors?.[p.attributes.POSITION];
        if (acc) verts += acc.count;
        if (p.indices !== undefined) tris += (j.accessors[p.indices].count / 3);
      }
    }
    console.log(`${name.padEnd(12)} meshes=${String(meshes).padEnd(6)} nodes=${String(nodes).padEnd(6)} prims=${String(prims).padEnd(6)} verts=${String(verts).padEnd(9)} tris=${Math.round(tris)}`);
  } catch (e) {
    console.log(`${name}: ERROR ${e.message}`);
  }
}
