#!/bin/sh
set -eu

cd "$(git rev-parse --show-toplevel)"
if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo 'Confirma los cambios de código antes de publicar.' >&2
  exit 1
fi

npm run build
npm run audit:public
if ! grep -Eq '[a-z0-9-]+\.apps\.googleusercontent\.com' dist/assets/index-*.js; then
  echo 'El build necesita el Client ID público.' >&2
  exit 1
fi

stage=$(mktemp -d "${TMPDIR:-/tmp}/tai-pages-release.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
trap 'exit 1' HUP INT TERM
git clone --quiet --single-branch --branch gh-pages "$(git remote get-url origin)" "$stage"
git -C "$stage" rm -qr -- .
cp -R dist/. "$stage/"
touch "$stage/.nojekyll"
git -C "$stage" add --all
if ! git -C "$stage" diff --cached --quiet; then
  git -C "$stage" commit -m "Deploy TAI Hub $(git rev-parse --short HEAD)"
  git -C "$stage" push origin gh-pages
fi
