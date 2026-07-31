#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
TEMPLATE="$ROOT/repair/template"

# Remove the old, simpler source without touching Git metadata or repair inputs.
find . -mindepth 1 -maxdepth 1 ! -name .git ! -name .github ! -name repair -exec rm -rf {} +
mkdir -p public/assets netlify/functions/_shared scripts

bases=(
  "https://6a6ce207087fbed20392955d--habun-mitarbeiterportal.netlify.app"
  "https://habun-mitarbeiterportal.netlify.app"
  "https://6a6c6533a553914a3e6e9a53--habun-mitarbeiterportal.netlify.app"
  "https://6a6cd5a46fbeb9824e5787cf--habun-mitarbeiterportal-test.netlify.app"
  "https://habun-mitarbeiterportal-test.netlify.app"
)

fetch_asset() {
  local rel="$1" expected="$2" target="public/$1" tmp actual
  mkdir -p "$(dirname "$target")"
  tmp="$(mktemp)"
  for base in "${bases[@]}"; do
    if curl --retry 3 --retry-delay 2 -fsSL "$base/$rel" -o "$tmp"; then
      actual="$(sha256sum "$tmp" | awk '{print $1}')"
      if [[ "$actual" == "$expected" ]]; then
        mv "$tmp" "$target"
        echo "Verified $rel"
        return 0
      fi
    fi
  done
  echo "Asset verification failed: $rel" >&2
  rm -f "$tmp"
  return 1
}

fetch_asset "app-icon-192.png" "7a3d981a68928498334c2dbd9e299dd85d4a20e03a97bc23c2a097cfc3832e20"
fetch_asset "app-icon-512.png" "6043937500c9491cd7a1709a3280499b8662146d52f56989a53bbc6c3f2dbe58"
fetch_asset "apple-touch-icon.png" "fa7720d2216b72ba2ee553a8406744d36849dc2029ae6b9987e3f8435ccb2d4f"
fetch_asset "assets/browser-BeRsew1z.js" "ff3e3555106f5107a36147ac41590096b738261f745183790855dfe6664c538b"
fetch_asset "assets/html2canvas.esm-DXEQVQnt.js" "7b07a9ca175c614e8e7de447198d35b0d161dd50db2c63b5f7fd6ea0e1e876f2"
fetch_asset "assets/index-CBs7FW29.js" "791dc0102a11fb859b9629a98edebf88086986d31ccb972147b7a37d119f453d"
fetch_asset "assets/index-DCVQ18oO.css" "186c87d6ed38a51745354e03b189099856fb6ec422d9e719f85557f996050fb2"
fetch_asset "assets/index.es-VyWH073z.js" "c62c724517cde4b1ea3125f52250bf15a1eb156c013bcc4ccaa1669b9d9cecbc"
fetch_asset "assets/jspdf.es.min-Dqzj63rK.js" "b29a733c9fec49ad7f6e6c9e8e65f866008cc04f7f309134e17bcfdf3c5cd160"
fetch_asset "assets/jspdf.plugin.autotable-B0IxatYY.js" "62f28a87b9d96f1e324e52215be570ce764f7f9cdf4f21f92b5b53bcd979ddfa"
fetch_asset "assets/purify.es-VaSPOPhr.js" "c56c10f858fa2ed9a99d2594e732197cc9d504c03fe86318c2ac3e4dcdaaae37"
fetch_asset "favicon-64.png" "c5d8d9d5006bb11a2c606d4fe320666caa76abdd6bd6b759a549f920bce22c11"
fetch_asset "habun-logo-pdf.png" "2b9d4c83dca9f9f36f722774f04dfa28220264ab3b530366086109db3d9ee490"
fetch_asset "habun-logo.png" "2c368976bd3dbae6e2c9d5db4c92d039d5f3ab6145bfca6fb9b573b017a06e33"
fetch_asset "improvements.css" "34d514950fcbf5751b69e1c56c974eea8794b521b101b384fb343980636c3175"
fetch_asset "improvements.js" "bb6f13f0a47625c694f918e9bc0a46c5f6f3477ec2a582aafa5ca1ab409d73b7"
fetch_asset "premium.css" "a67e32fc378b73e36da9dd91441f78c460ff649401cd6e9b3bf45310a23c38a0"
fetch_asset "premium.js" "a53b64957bc3459f278190f628a342910d84db2802a7bf42b75c0ab42f5c77f1"

bundle_tmp="$(mktemp)"
bundle_ok=0
for base in "${bases[@]}"; do
  if curl --retry 3 --retry-delay 2 -fsSL "$base/assets/index-anSa7LUY.js" -o "$bundle_tmp"; then
    bundle_hash="$(sha256sum "$bundle_tmp" | awk '{print $1}')"
    if [[ "$bundle_hash" == "ffdf5abb90098546d2d5c5bdc1b565b1ee21f5613acddb858893a684115ef5f8" || "$bundle_hash" == "9c9fb6a2c22d6f027e0f5b01c4a3b4a70d67a1aeb39a6504aa6fe84af97cf55c" ]]; then
      mv "$bundle_tmp" public/assets/index-anSa7LUY.js
      bundle_ok=1
      break
    fi
  fi
done
[[ "$bundle_ok" == 1 ]]

cp -R "$TEMPLATE"/. .
cp repair/patch-production-bundle.mjs scripts/patch-production-bundle.mjs
node scripts/patch-production-bundle.mjs
cp public/assets/index-anSa7LUY.js public/assets/index-habun-main-20260731-2.js
final_hash="$(sha256sum public/assets/index-anSa7LUY.js | awk '{print $1}')"
[[ "$final_hash" == "9c9fb6a2c22d6f027e0f5b01c4a3b4a70d67a1aeb39a6504aa6fe84af97cf55c" ]]

npm run check
npm run build
npm run check

# Do not leave temporary deployment machinery in the permanent source tree.
rm -rf repair
rm -f .github/workflows/habun-repair-source.yml
rmdir .github/workflows 2>/dev/null || true
rmdir .github 2>/dev/null || true
