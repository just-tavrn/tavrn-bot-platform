#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/ci-changes.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$work" init -q
git -C "$work" config user.name 'CI test'
git -C "$work" config user.email 'ci@example.invalid'
git -C "$work" commit --allow-empty -qm initial
base="$(git -C "$work" rev-parse HEAD)"
check() {
  local file="$1" expected="$2" result
  git -C "$work" reset --hard -q "$base"
  git -C "$work" clean -fdq
  mkdir -p "$work/$(dirname "$file")"
  echo changed > "$work/$file"
  git -C "$work" add --all
  git -C "$work" commit -qm change
  result="$(cd "$work" && BASE="$base" HEAD="$(git rev-parse HEAD)" EVENT_NAME=pull_request REF=refs/pull/1/merge bash "$script")"
  [ "$result" = "build=$expected" ] || { echo "FAIL $file: $result" >&2; exit 1; }
  echo "ok - $file: $result"
}
check README.md false
check CLA.md false
check docs/GITHUB.md false
check .github/workflows/cla.yml false
check .github/ISSUE_TEMPLATE/bug_report.yml false
check src/content/docs/guide.md true
check src/content/pages/roadmap.md true
check src/pages/legal/privacy.astro true
check sources/tavrn true
check .gitmodules true
check pnpm-lock.yaml true
check scripts/ci-changes.sh true
check .github/workflows/ci.yml true
check .github/workflows/image.yml true
check deploy/Caddyfile true
check server/index.ts true
check web/index.tsx true
check LICENSE true
check unknown.file true
cd "$work"
# Moving a rendered page into an ignored directory must still rebuild its removal.
git reset --hard -q "$base"
git clean -fdq
mkdir -p src/content/docs docs
echo 'rendered documentation' > src/content/docs/page.md
git add --all
git commit -qm content
content_base="$(git rev-parse HEAD)"
git mv src/content/docs/page.md docs/page.md
git commit -qm move
[ "$(BASE="$content_base" HEAD="$(git rev-parse HEAD)" bash "$script")" = build=true ]
echo 'ok - moving a rendered page into docs still rebuilds'
[ "$(BASE=missing HEAD=missing bash "$script")" = build=true ]
[ "$(BASE="$base" HEAD="$base" EVENT_NAME=workflow_dispatch bash "$script")" = build=true ]
[ "$(BASE="$base" HEAD="$base" REF=refs/tags/v1 bash "$script")" = build=true ]
[ "$(BASE="$base" HEAD="$base" bash "$script")" = build=false ]
echo 'ok - unknown base and forced runs build; empty diff skips'
