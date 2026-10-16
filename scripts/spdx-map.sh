# SPDX-License-Identifier: Apache-2.0
#
# The license map of scripts/check-spdx.sh (sourced by it): the files it checks and the license of each path, first
# match wins. Everything hand-written in this repository is Apache-2.0; dependencies and build output are skipped.
# shellcheck shell=bash disable=SC2034 # spdx_files is read by check-spdx.sh

spdx_files=('*.ts' '*.tsx' '*.mjs' '*.js' '*.css' '*.sh' '*.yml' 'Dockerfile')

license_for() {
  case "$1" in
    */node_modules/* | node_modules/* | server/public/* | test-results/*) echo skip ;;
    *) echo Apache-2.0 ;;
  esac
}
