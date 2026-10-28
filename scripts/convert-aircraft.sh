#!/usr/bin/env bash
# Converts the ir-engine aircraft (Apache-2.0) from the legacy
# KHR_materials_pbrSpecularGlossiness encoding to modern metal/rough, then
# resizes textures and meshopt-compresses them so they stream well in a browser.
# The models themselves are untouched: geometry, UVs, rigs and animations are preserved.
set -u
cd "$(dirname "$0")/.."
AIR=public/assets/air
TMP=.convert-tmp
mkdir -p "$TMP"

convert () { # convert <name>
  local n="$1" src="$AIR/$1.glb"
  [ -s "$src" ] || { echo "missing $src"; return 1; }
  echo "== $n: metalrough -> resize -> meshopt"
  npx --yes @gltf-transform/cli@^4 metalrough "$src" "$TMP/$n.1.glb" || return 1
  npx --yes @gltf-transform/cli@^4 resize --width 1024 --height 1024 "$TMP/$n.1.glb" "$TMP/$n.2.glb" || return 1
  npx --yes @gltf-transform/cli@^4 meshopt --level high "$TMP/$n.2.glb" "$TMP/$n.3.glb" || return 1
  npx --yes @gltf-transform/cli@^4 dedup "$TMP/$n.3.glb" "$TMP/$n.4.glb" || return 1
  mv "$TMP/$n.4.glb" "$src"
  echo "   -> $src ($(du -h "$src" | cut -f1))"
}

for n in helicopter jet airplane drone; do convert "$n"; done
rm -rf "$TMP"
echo "DONE"
