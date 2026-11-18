# Repository settings

This page records every GitHub setting this repository depends on, and why.
`scripts/apply-repo-settings.sh` applies them with `gh api`, so the configuration is reviewable and
repeatable. To see the current state, run:

```sh
scripts/apply-repo-settings.sh --read-back
```

It prints each setting, marks the ones that differ from this page, and exits with an error if any
differ or cannot be read.

## Applying the settings

The script takes the repository as an argument, `pblobp/orca-plugins` by default, so the same
script can configure a test repository. It has two phases, because the rulesets must come after CI
has passed under the new Actions policy:

1. `scripts/apply-repo-settings.sh --settings`: repository options, the Actions policy, the
   security features and the issue labels.
2. Re-run CI and CodeQL on `main`, and continue only when both pass.
3. `scripts/apply-repo-settings.sh --rulesets --with-tag-check`: the branch ruleset for `main` and
   the two tag rulesets. `--with-tag-check` selects the tag ruleset that also requires `ci-ok`. It
   is the one applied to this repository (see below).
4. `scripts/apply-repo-settings.sh --read-back --with-tag-check`, which must show no differences.

Both phases are safe to run again. A ruleset that already exists, found by name, is updated in
place.

## What the settings protect, and what they cannot

1. **The maintainer reads every diff before merging.** This is the real control. A pull request runs
   its own copy of the workflow files, so it can weaken the checks that judge it.
2. **Rules on git operations.** Nothing reaches `main` without a pull request and passing checks. A
   release tag cannot be moved or deleted, and only the owner can create one.
3. **The owner's account.** The rules bind the owner's pushes too, but the owner's account, its
   `gh` token and its SSH key can change the rules or push a tag. The repository cannot enforce
   their safety. The owner's checklist at the end of this page covers it.

If CI itself breaks and blocks every merge, the way out is to relax the ruleset through
`scripts/rulesets/` and `scripts/apply-repo-settings.sh --rulesets`, in a commit that says why, and
to restore it right after.

## Branch ruleset for `main`

File: `scripts/rulesets/main.json`.

| Rule                                         | Setting                                                                                      | Reason                                                                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changes arrive by pull request               | Required, 0 approvals, conversations resolved, squash merge only                             | A single maintainer cannot approve their own pull request. The pull request still forces CI and leaves a record. When a second maintainer joins, raise approvals to 1 and require code-owner review |
| Required status check                        | `ci-ok`, accepted only from GitHub Actions (app id 15368), and the branch must be up to date | One stable name, so adding a job never needs a ruleset edit. Pinning the source stops another integration from reporting it                                                                         |
| Code scanning results                        | CodeQL: block on high or critical security alerts and on errors                              | Stops a merge that introduces a known flaw                                                                                                                                                          |
| Linear history, no force pushes, no deletion | On                                                                                           | History is append-only                                                                                                                                                                              |
| Signed commits                               | Not required                                                                                 | Every commit on `main` is a squash commit that GitHub makes and signs. The rule would also check each pull request's own commits, and so block unsigned ones with nobody able to bypass             |
| Bypass                                       | Nobody, the owner included                                                                   | The owner merges through a pull request like everyone else                                                                                                                                          |

## Tag rulesets for `v*`

There are two tag rulesets, because a bypass list applies to a whole ruleset.

| Ruleset                            | File                                                      | Rules                                                                                                               | Bypass                                                  |
| ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| release tags: who may create       | `tags-create.json`                                        | Creation is restricted                                                                                              | The repository admin role, which here is only the owner |
| release tags: immutable and tested | `tags-immutable.json` or `tags-immutable-with-check.json` | Update, deletion and force-update are blocked. The `-with-check` variant also requires `ci-ok` on the tagged commit | Nobody                                                  |

GitHub does not document whether a required status check stops a tag on an untested commit, so it
was tested in a throwaway repository with these rulesets:

- A tag on a commit with no passing `ci-ok` was refused: "Required status check "ci-ok" is expected".
- The owner's tag on a commit that passed `ci-ok` was accepted.
- Deleting a release tag was refused.
- Moving a release tag was not tried.

So `tags-immutable-with-check.json` is the variant applied here. GitHub offers no rule that limits
which commit a tag may point at, and tag-name patterns need an Enterprise plan, so
`scripts/tag-release.sh` checks both.

## GitHub Actions

| Setting                             | Value                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed actions                     | Selected only: GitHub's own (`actions/*`, `github/*`) and `ossf/scorecard-action`                                                                   |
| SHA pinning                         | Required. Every `uses:` names a full commit SHA, with the version in a trailing comment so Dependabot can update it                                 |
| Default token                       | Read-only. Each workflow starts with `permissions: {}`, and each job asks only for what it needs                                                    |
| Write access to repository contents | No workflow has it. Releases are made from the maintainer's machine                                                                                 |
| Token cannot approve pull requests  | Set                                                                                                                                                 |
| Fork pull requests                  | Approval required for all outside contributors, not only first-time ones                                                                            |
| Triggers                            | `pull_request`, `push` to `main`, a weekly schedule, and manual runs. Never `pull_request_target`                                                   |
| Secrets                             | None. CI needs no credentials, so there is nothing to steal                                                                                         |
| Checkout                            | `persist-credentials: false` everywhere                                                                                                             |
| Downloads                           | The Orca package, pinned by version and sha512 in `.orca-version`. The dev tools, pinned by `package-lock.json` and installed with scripts disabled |

## Workflows

| Workflow        | Jobs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`        | `changes` lists the plugins a pull request touches (every plugin on `main`, and every plugin when scripts, CI, the Orca pin or the dev tools change). `validate` runs `orca plugin validate`, `check` and `test` for each. `typecheck` writes Orca's typings and runs `tsc`. `policy` runs the policy, catalog and version checks, Prettier and the script tests on the whole repository. `smoke` runs each plugin's unit and smoke tests on Ubuntu, macOS and Windows. `ci-ok` fails unless every job succeeded; `validate` and `smoke` may be skipped only when no plugin changed |
| `codeql.yml`    | CodeQL for `actions` and `javascript-typescript`, on every pull request, on pushes to `main` and weekly. It ignores `tests/scripts/corpus/`, which holds deliberately bad code                                                                                                                                                                                                                                                                                                                                                                                                      |
| `scorecard.yml` | OpenSSF Scorecard, weekly and on pushes to `main`, with results published                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

`ci.yml` and `codeql.yml` have no path filters: a filtered-out workflow would leave a required
check waiting forever. There is no release workflow. The directory lists a tag the moment it
exists, so a workflow that runs after the tag cannot stop a release, and a workflow started by a tag
runs whatever workflow file that tag's commit contains.

Orca's version for CI is pinned in `.orca-version` and raised on purpose, because the directory
validates against the latest Orca release. To raise it, copy the new version and the sha512 of
`orca-ide_<version>_amd64.deb` from that release's `latest-linux.yml`, download the package once
and check that its hash matches.

## Security features

| Feature                                | State                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret scanning and push protection    | On                                                                                                                                                                                                                                                                                                                                 |
| Private vulnerability reporting        | On                                                                                                                                                                                                                                                                                                                                 |
| Dependabot alerts and security updates | On                                                                                                                                                                                                                                                                                                                                 |
| Dependabot version updates             | `github-actions` and `npm` (dev tools), weekly, grouped, waiting 7 days after a release. Major TypeScript updates are ignored, because TypeScript 7 has no compiler API for `scripts/check-policy.mjs`. Major `@types/node` updates are ignored too, because the typings must match Node 24, the Node version Orca runs plugins on |
| CodeQL                                 | The workflow above. GitHub's one-click default setup stays off: it skips pull requests from forks, which would leave the code scanning rule waiting forever                                                                                                                                                                        |
| OpenSSF Scorecard                      | Weekly and on pushes to `main`; results published, badge in the README                                                                                                                                                                                                                                                             |
| Immutable releases                     | On. It locks the tag and the files of each published release; the notes stay editable                                                                                                                                                                                                                                              |

## Repository options

- Squash merge only, with the pull request title and body as the commit message. Merge commits and
  rebase merges off. Head branches deleted after merge. Auto-merge allowed. Updating a branch from
  the pull request allowed.
- Wiki and Projects off. Issues on.
- Description set. A homepage is set once the directory lists a plugin.
- The `orca-plugin` topic is added only at the first release, because it is what makes the
  directory list the repository. The settings script never sets it.
- Labels for the issue forms: `bug`, `enhancement`, `plugin-proposal` and `triage`.
- `CODEOWNERS`: `* @pblobp`.

## Not available here

A personal account on the free plan cannot use required workflows, push rules that restrict file
paths, tag-name patterns, a dry-run mode for rulesets, or secret scanning for custom patterns.
Nothing here relies on them.

## For the account owner

These cannot be seen or set from the repository:

- Two-factor authentication or a passkey on the GitHub account.
- A `gh` token with only the scopes this work needs. A token with `admin:public_key` could add an
  SSH key to the account and push a release tag. Prefer a fine-grained token limited to this
  repository.
- A passphrase on the SSH key, or a hardware-backed key. That key can push a release tag.
- A regular look through the account's SSH keys and authorized apps.
