#!/usr/bin/env node
/**
 * Download real interior props from Poly Haven (CC0) and convert each to a
 * single self-contained GLB.
 *
 * Poly Haven serves models as a .gltf plus an "include" map of relative .bin
 * and texture files. This script recreates that relative layout in a temp
 * directory, then runs gltf-transform to bake everything into one GLB with
 * embedded textures, which is what the game loads.
 *
 *   node scripts/fetch-furniture.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const OUT_DIR = 'public/assets/interior';
const TMP = '/tmp/ph-furniture';
const RES = '1k'; // 1k textures keep each prop well under a megabyte

/** name -> how it is used in a room */
const ITEMS = [
  // sleeping
  'GothicBed_01', 'old_bed_frame', 'vintage_day_bed',
  // seating
  'ArmChair_01', 'WoodenChair_01', 'Sofa_01', 'folding_wooden_stool', 'GreenChair_01',
  // tables
  'WoodenTable_01', 'WoodenTable_02', 'coffee_table_round_01', 'SchoolDesk_01', 'metal_office_desk',
  // storage / wardrobe
  'Shelf_01', 'drawer_cabinet', 'chinese_cabinet', 'GothicCabinet_01',
  'painted_wooden_cabinet', 'vintage_cabinet_01', 'wooden_bookshelf_worn',
  // decor + clothing
  'ornate_mirror_01', 'potted_plant_01', 'life_jacket', 'large_castle_door',
  'desk_lamp_arm_01', 'ceramic_vase_01', 'old_military_crate',
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return buf.length;
}

async function convertOne(name) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${name}`);
  // The API nests the download description one level down: gltf["1k"].gltf.
  const entry = files.gltf?.[RES]?.gltf;
  if (!entry) throw new Error(`${name}: no gltf/${RES}`);

  const dir = path.join(TMP, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  // The main .gltf and the binary buffer sit side by side; textures live in
  // a "textures/" subdirectory, matching the relative paths inside the gltf.
  const gltfName = path.basename(new URL(entry.url).pathname);
  await download(entry.url, path.join(dir, gltfName));
  for (const [rel, meta] of Object.entries(entry.include || {})) {
    await download(meta.url, path.join(dir, rel));
  }

  const out = path.join(OUT_DIR, `${name}.glb`);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await exec('npx', [
    'gltf-transform', 'optimize',
    path.join(dir, gltfName), out,
    '--texture-size', '512',
    '--compress', 'meshopt',
    '--no-simplify',
  ], { maxBuffer: 1024 * 1024 * 64 });

  const st = await fs.stat(out);
  return st.size;
}

async function main() {
  let ok = 0, failed = [];
  for (const name of ITEMS) {
    try {
      const size = await convertOne(name);
      console.log(`  ok   ${name.padEnd(24)} ${(size / 1024).toFixed(0)} KB`);
      ok++;
    } catch (e) {
      console.log(`  FAIL ${name.padEnd(24)} ${e.message.split('\n')[0]}`);
      failed.push(name);
    }
  }
  console.log(`\n${ok}/${ITEMS.length} interior props ready in ${OUT_DIR}`);
  if (failed.length) console.log('failed:', failed.join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
