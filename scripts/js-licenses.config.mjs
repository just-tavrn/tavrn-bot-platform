// SPDX-License-Identifier: Apache-2.0
// The configuration of scripts/check-js-licenses.mjs: the production dependencies of the platform (the server and
// the bot runtime; the web UI's packages are development dependencies bundled at build time: Preact (MIT), the Inter
// typeface (OFL-1.1), Tailwind (MIT)).
export default {
  packages: ["."],
  allowed: [],
  verified: {},
  exceptions: {},
};
