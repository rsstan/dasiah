#!/usr/bin/env bash
# Lighthouse of the main pages, desktop and mobile, against a running production build (the
# end-to-end stack by default: pnpm e2e:up). Writes an HTML and a JSON report per page and form
# factor and prints a table of the scores.
#
#   scripts/lighthouse.sh [base-url] [out-dir]      defaults: http://localhost:8088 .lighthouse
#
# Needs Chrome or Chromium (CHROME_PATH to choose one); Lighthouse itself is fetched by npx.
# Headless Chrome draws WebGL in software (SwiftShader) unless told to use the GPU, which makes
# the map page look far slower than on any real device; the GPU is used by default here.
# LIGHTHOUSE_GPU=0 measures with software rendering instead.
set -euo pipefail

base=${1:-http://localhost:8088}
out=${2:-.lighthouse}
chrome=${CHROME_PATH:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}
if [ -z "$chrome" ]; then
  echo "Chrome or Chromium not found; set CHROME_PATH" >&2
  exit 1
fi
mkdir -p "$out"
flags="--headless=new"
if [ "${LIGHTHOUSE_GPU:-1}" = 1 ]; then
  flags="$flags --enable-gpu --ignore-gpu-blocklist --use-angle=vulkan --enable-features=Vulkan"
fi

names=(home sign-in map)
paths=("/" "/sign-in" "/cities/waw?lat=52.2002&lon=21.0302")

for form in desktop mobile; do
  preset=()
  if [ "$form" = desktop ]; then
    preset=(--preset=desktop)
  fi
  for i in "${!names[@]}"; do
    echo "lighthouse ${names[$i]} ($form)" >&2
    npx -y lighthouse@13.6.0 "$base${paths[$i]}" "${preset[@]}" \
      --only-categories=performance,accessibility,best-practices,seo \
      --output=json --output=html --output-path="$out/${names[$i]}-$form" \
      --chrome-path="$chrome" --chrome-flags="$flags" --quiet
  done
done

node - "$out" "${names[@]}" <<'EOF'
const { readFileSync } = require('node:fs');
const [out, ...names] = process.argv.slice(2);
const cats = ['performance', 'accessibility', 'best-practices', 'seo'];
const metrics = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift'];
console.log('| Page | Form | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const form of ['desktop', 'mobile']) {
  for (const name of names) {
    const r = JSON.parse(readFileSync(`${out}/${name}-${form}.report.json`, 'utf8'));
    const scores = cats.map((c) => Math.round((r.categories[c]?.score ?? 0) * 100));
    const values = metrics.map((m) => r.audits[m].displayValue);
    console.log(`| ${name} | ${form} | ${scores.join(' | ')} | ${values.join(' | ')} |`);
  }
}
EOF
