#!/usr/bin/env node
/**
 * Download real animated characters from KayKit (CC0) and bake each into a
 * compact GLB with embedded, downscaled textures.
 *
 * The three.js example characters already in the project cover a few rigs,
 * but the pedestrian model ships without any animation clips, so the crowd
 * needs a real animated source. KayKit's Adventurers and Skeletons packs are
 * CC0 and come with full idle/walk/run/attack/death clip sets.
 *
 *   node scripts/fetch-characters.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const OUT_DIR = 'public/assets/characters';

const BASE = 'https://raw.githubusercontent.com/KayKit-Game-Assets';

/** [repo, source path, output name] */
const CHARACTERS = [
  ['KayKit-Character-Pack-Adventures-1.0',
    'addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb', 'knight.glb'],
  ['KayKit-Character-Pack-Adventures-1.0',
    'addons/kaykit_character_pack_adventures/Characters/gltf/Mage.glb', 'mage.glb'],
  ['KayKit-Character-Pack-Adventures-1.0',
    'addons/kaykit_character_pack_adventures/Characters/gltf/Rogue.glb', 'rogue.glb'],
  ['KayKit-Character-Pack-Adventures-1.0',
    'addons/kaykit_character_pack_adventures/Characters/gltf/Barbarian.glb', 'barbarian.glb'],
  ['KayKit-Character-Pack-Skeletons-1.0',
    'addons/kaykit_character_pack_skeletons/Characters/gltf/Skeleton_Warrior.glb', 'skeleton-warrior.glb'],
  ['KayKit-Character-Pack-Skeletons-1.0',
    'addons/kaykit_character_pack_skeletons/Characters/gltf/Skeleton_Mage.glb', 'skeleton-mage.glb'],
];

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return buf.length;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  let ok = 0;
  for (const [repo, src, out] of CHARACTERS) {
    const raw = path.join('/tmp/kaykit', out);
    try {
      const size = await download(`${BASE}/${repo}/main/${src}`, raw);
      const dest = path.join(OUT_DIR, out);
      await exec('npx', [
        'gltf-transform', 'optimize', raw, dest,
        '--texture-size', '512', '--compress', 'meshopt', '--no-simplify',
      ], { maxBuffer: 1024 * 1024 * 64 });
      const st = await fs.stat(dest);
      console.log(`  ok   ${out.padEnd(26)} ${(size / 1024).toFixed(0)} KB -> ${(st.size / 1024).toFixed(0)} KB`);
      ok++;
    } catch (e) {
      console.log(`  FAIL ${out.padEnd(26)} ${e.message.split('\n')[0]}`);
    }
  }
  console.log(`\n${ok}/${CHARACTERS.length} characters ready in ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
