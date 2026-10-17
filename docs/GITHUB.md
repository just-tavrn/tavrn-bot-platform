# GitHub setup of tavrn-bot-platform

Nothing runs on GitHub until the owner switches it on. Only fast checks run here; the Playwright spec runs locally.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` → `JavaScript` | push to `main`, pull requests, by hand | the organization's `js-ci.yml`: install from the lockfile, SPDX headers, dependency licenses, `pnpm typecheck`, `pnpm test` (Vitest, two workers), `pnpm build` |
| `ci.yml` → `Publication hygiene` | same | `scripts/publish-check.sh`: no private files, domains or secrets |
| `ci.yml` → `shared-scripts` | same | the copies in `scripts/` equal the organization's shared scripts |
| `image.yml` | push to `main` (`edge`), tags `v*` | the organization's `docker-publish.yml`: builds `Dockerfile` for amd64 and arm64 and pushes `ghcr.io/just-tavrn/tavrn-bot-platform` |
| `gitleaks.yml` | push to `main`, pull requests | secret scan of the full history |
| `dependency-review.yml` | pull requests | refuses vulnerable dependencies and licenses outside the allow-list (public repositories) |
| `cla.yml` | pull requests, comments | the CLA bot |

Every job carries `if: ${{ vars.CI_ENABLED == 'true' }}`.

## Variables and secrets (Settings → Secrets and variables → Actions)

| Name | Kind | Set by | Purpose |
|---|---|---|---|
| `CI_ENABLED` | variable | orchestrator | `true` switches all workflows on |
| `PUBLISH_CHECK_PRIVATE` | secret (repository or organization) | owner | comma-separated private domains and hosts for the hygiene check; also as a Dependabot secret |
| `CLA_PAT` | secret (organization; repository secret while organization secrets do not reach the repository) | owner | the CLA bot's token (`contents: write` on `just-tavrn/cla-signatures`) |

## Package

After the first image push: package settings of `tavrn-bot-platform` → visibility public, and link it to this
repository.

## Repository settings

- Branch protection or ruleset on `main`: pull requests only, checks `JavaScript`, `Publication hygiene`,
  `gitleaks`, `Dependency review` and `cla / Contributor license agreement` required (the organization's
  `scripts/github-rulesets.sh`; inspect its generated check names).
- Labels: `scripts/github-labels.sh` (common set plus `scripts/labels.txt`).
- Private vulnerability reporting on (Security → Settings).

## Builds and documentation changes

`ci.yml` and `image.yml` use `scripts/ci-changes.sh` to skip application checks and container builds for
repository administration only (root contribution/brand/readme documents, `docs/`, issue templates and the
CLA, secret-scan and dependency-review workflows). CLA, secret scans, publication hygiene and the lightweight
change-filter/SPDX check still run. Unknown paths, application code, dependencies, deployment files and the
CI/image workflows trigger checks and builds. Manual runs and release tags always build.
