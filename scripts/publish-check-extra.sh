# SPDX-License-Identifier: Apache-2.0
#
# This repository's additions to scripts/publish-check.sh (sourced by it): the owner's private pattern list in a
# sibling checkout of the internal repository is read when it exists.
# shellcheck shell=bash disable=SC2034,SC2154 # the variables are read by publish-check.sh, `here` comes from it

extra_lists=("$here/../tavrn-internal/publish-check.private")
