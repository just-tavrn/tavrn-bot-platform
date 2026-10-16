# Contributing

Thank you for helping. The rules of the tavrn organization apply here too: read its
[contributing guide](https://github.com/just-tavrn/.github/blob/main/CONTRIBUTING.md) and the
[code of conduct](https://github.com/just-tavrn/.github/blob/main/CODE_OF_CONDUCT.md). Your first pull request asks
you to sign the [contributor license agreement](CLA.md).

For this repository:

- `pnpm check` must pass (SPDX headers, dependency licenses, typecheck, Vitest). Run `pnpm e2e` when you change the
  web UI (locally; the CI does not run it).
- A new module is one directory under `server/modules/` with its tests next to it (README.md, "Adding a module").
- Keep it small: one obvious way, few dependencies, no UI code for settings (the schema renders the form).
- Everything in the repository is English; the UI strings exist in English and German (`web/src/i18n.ts`).
