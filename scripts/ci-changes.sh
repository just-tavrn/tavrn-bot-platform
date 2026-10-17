#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Decide whether a change needs application checks and an image. Unknown changes build by default.
set -euo pipefail
build=true
if [ "${EVENT_NAME:-}" != workflow_dispatch ] && [[ "${REF:-}" != refs/tags/* ]] \
  && [ -n "${BASE:-}" ] && [ -n "${HEAD:-}" ] \
  && git cat-file -e "$BASE^{commit}" 2>/dev/null && git cat-file -e "$HEAD^{commit}" 2>/dev/null; then
  files="$(git diff --no-renames --name-only "$BASE" "$HEAD")"
  build=false
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    case "$file" in
      README.md|CLA.md|TRADEMARK.md|GOVERNANCE.md|CONTRIBUTING.md|CODE_OF_CONDUCT.md|SECURITY.md|SUPPORT.md|LICENSE.md|CHANGELOG.md|docs/*|.github/ISSUE_TEMPLATE/*|.github/PULL_REQUEST_TEMPLATE.md|.github/CODEOWNERS|.github/dependabot.yml|.github/workflows/cla.yml|.github/workflows/gitleaks.yml|.github/workflows/dependency-review.yml)
        # Repository administration only. Website content under src/ and sources/ never matches this list.
        ;;
      *) build=true; break ;;
    esac
  done <<< "$files"
fi
printf 'build=%s\n' "$build"
