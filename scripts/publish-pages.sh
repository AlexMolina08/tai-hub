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

# Cached HTML and open tabs can still request a chunk from an earlier release.
(cd dist && find assets -type f | LC_ALL=C sort) > "$stage/.tai-assets"
for release in $(git -C "$stage" rev-list --first-parent --max-count=3 HEAD); do
  if git -C "$stage" cat-file -e "$release:.tai-assets" 2>/dev/null; then
    git -C "$stage" show "$release:.tai-assets" > "$stage/.tai-retain"
  else
    git -C "$stage" ls-tree -r --name-only "$release" -- assets/ > "$stage/.tai-retain"
  fi
  while IFS= read -r asset; do
    case "$asset" in
      assets/*/*|*..*) continue ;;
      assets/*.js|assets/*.mjs|assets/*.css) ;;
      *) continue ;;
    esac
    if [ ! -f "$stage/$asset" ]; then
      git -C "$stage" show "$release:$asset" > "$stage/$asset"
    fi
  done < "$stage/.tai-retain"
done
rm -f "$stage/.tai-retain"
node scripts/check-public.mjs "$stage"

git -C "$stage" add --all
if ! git -C "$stage" diff --cached --quiet; then
  git -C "$stage" commit -m "Deploy TAI Hub $(git rev-parse --short HEAD)"
  git -C "$stage" push origin gh-pages
fi
