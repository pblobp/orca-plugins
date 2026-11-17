# Security

## Report a vulnerability

Report it privately through GitHub's form:
[github.com/pblobp/orca-plugins/security/advisories/new](https://github.com/pblobp/orca-plugins/security/advisories/new).
Never report a security problem in a public issue, a pull request or a discussion.

If the form is not available, open an issue that asks for a private way to report, and leave out
every detail of the problem.

Include what you can: the plugin and its version, the Orca version, your operating system, what an
attacker could do, and the steps to reproduce it.

## What happens next

One person maintains this repository, so these are targets, not promises:

- An answer within 7 days.
- An assessment within 14 days.
- A fixed release within 30 days for a serious problem, sooner when users are at risk.

You are credited in the advisory unless you ask not to be.

## Supported versions

Only the latest release of each plugin gets fixes. A fix is always a new version; a version that is
already listed is never changed.

## Scope

In scope:

- The plugins in `plugins/`.
- The scripts, workflows and settings that check and release them.
- `orca-catalog.json`.

Out of scope: Orca itself. Report problems in the app, its plugin host or its sandbox to the Orca
project at [github.com/stablyai/orca](https://github.com/stablyai/orca).

## What a plugin can do on your machine

A plugin with a worker (execution level `trusted-worker`) runs as a Node process with your user
account. Orca does not sandbox it. It can read and write your files, start programs and use the
network. Orca keeps `PATH`, `HOME`, locale and temp variables in its environment.

Orca updates installed plugins on its own. An update that asks for no new access installs without a
new approval, about 12 hours after it is listed. One bad release would reach every user of that
plugin.

## How releases are protected

Three layers stand between a change and your machine. They are listed by how much they are worth.

1. **The maintainer reads every diff before it merges.** This is the real control. A pull request
   runs its own copy of the workflow files, so it can weaken the checks that judge it. A green check
   shows quality, not safety.
2. **Rules on git operations.** Nothing reaches `main` without a pull request and a passing `ci-ok`
   check. Only the owner can create a release tag, and nobody can move or delete one. Releases are
   tagged only with `scripts/tag-release.sh`, which refuses unless the commit is exactly `main` and
   CI passed on it.
3. **The owner's account.** The rules bind the owner too. But the owner's account, its tokens and
   its SSH key can change the rules or push a tag. The repository cannot protect itself from that;
   [docs/repository-settings.md](docs/repository-settings.md) lists what the owner does about it.

The automated checks in [docs/plugin-standards.md](docs/plugin-standards.md) catch mistakes and the
obvious. They cannot prove a plugin is safe: a determined author can hide a network call or
generated code from any static check. That is why review is the control.

Other protections:

- CI has no secrets and no write access to the repository. Every action is pinned to a full commit
  SHA, and only GitHub's own actions and the OpenSSF Scorecard action may run.
- CodeQL scans every pull request, and a merge waits for its result.
- The Orca package CI uses is pinned by version and sha512.
- Secret scanning with push protection is on.
- Releases are immutable once published: their tag and files cannot change.

The full list of settings, and why each one is set, is in
[docs/repository-settings.md](docs/repository-settings.md). `scripts/apply-repo-settings.sh`
applies them, and its `--read-back` mode shows what GitHub reports right now.
