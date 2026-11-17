# Contributing

Thank you for helping. Plugins from this repository run on other people's machines and update
themselves, so every change goes through review and strict checks. This page explains how to get a
change merged.

## Before you start

- For a new plugin, open a [new plugin proposal](https://github.com/pblobp/orca-plugins/issues/new?template=plugin-proposal.yml)
  and agree on it before you write code.
- For a bug or a feature, open or find the issue first.
- For a security problem, do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Prerequisites

- The Orca desktop app, with its `orca` command on your `PATH`.
- Node 24.
- Git.

## Set up

```sh
git clone https://github.com/pblobp/orca-plugins.git
cd orca-plugins
npm ci --ignore-scripts
```

The dev tools are TypeScript, the Node typings and Prettier, pinned by `package-lock.json`. Plugins
themselves have no npm dependencies.

## The development loop

For a plugin in `plugins/<id>`:

```sh
orca plugin dev watch plugins/<id>          # load it into Orca and reload on every save
orca plugin validate plugins/<id> --json    # the manifest checks Orca runs
orca plugin check plugins/<id> --json       # render components panels once
orca plugin test plugins/<id> --json        # tests that use orca/testing
node --test 'tests/<id>/**/*.test.ts'       # unit tests in plain Node
npm run check                               # formatting, policy, catalog, versions, script tests
```

`orca plugin dev watch` asks you to approve the plugin's access before its code runs. Approve only
code you have read.

Read [docs/adding-a-plugin.md](docs/adding-a-plugin.md) for the layout of a plugin and
[docs/plugin-standards.md](docs/plugin-standards.md) for the rules every plugin follows.

## Pull requests

- One plugin and one topic per pull request.
- Behaviour changes need tests. A test for a bug fix must fail before the fix.
- UI changes need screenshots in the light and the dark theme, and at the narrowest sidebar width
  (220 px).
- Fill in the "Access changes" section of the template. Any change to capabilities, commands,
  hooks, events, keybindings, panels, custom editors, the worker or the execution level also needs
  a line under an "Access" heading in the plugin's `CHANGELOG.md`. CI checks this.
- A change to a plugin's folder needs a higher version in its `orca-plugin.json` before the next
  release. See [docs/releasing.md](docs/releasing.md).
- Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/), with the
  plugin id as the scope: `fix(os-vitals): keep the process table sorted`. Pull requests are
  squash-merged, so the pull request title becomes the commit subject.
- Do not edit a release that is already in `orca-catalog.json`. CI rejects it.

## What CI does with your pull request

The `ci-ok` check sums up every job and is the only check a merge needs. On a pull request from a
fork, workflows wait until the maintainer approves them, so `ci-ok` shows "Expected" until then.

CI judges a pull request with the workflow files in that pull request. A green check therefore shows
quality, not safety. The maintainer reads every diff, and reads changes under `.github/`,
`scripts/` and `policy/` line by line.

## Code style

- Prettier formats everything: no semicolons, single quotes, a print width of 100. Run
  `npm run format`.
- No comments in source. Put explanations in the README, a doc or the commit message.
- TypeScript uses erasable syntax only (no enums, no parameter properties, `import type` for
  types), and relative imports carry the `.ts` extension. The same file then runs in Orca and in
  plain Node.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE),
the license of this repository.

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
