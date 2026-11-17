# Agent instructions

This file is for AI coding agents. People should start with [README.md](README.md) and
[CONTRIBUTING.md](CONTRIBUTING.md); the rules are the same.

## What this repository is

Plugins for the Orca desktop app, one folder per plugin under `plugins/<id>/`. Plugins with a
worker run as the user, unsandboxed, and Orca updates them automatically. Treat every change as code
that will run on strangers' machines.

## Layout

```text
plugins/<id>/          what Orca installs: orca-plugin.json, README.md, CHANGELOG.md, LICENSE, code
policy/<id>.json       the Node modules, programs, dynamic-program exceptions and hosts it may use
tests/<id>/            unit tests and cleaned fixtures (plain node --test)
tools/<id>/            harness and smoke test
scripts/               check-policy, check-catalog, check-versions, list-plugins, tag-release,
                       apply-repo-settings
tests/scripts/         tests for the scripts, with the policy corpus in tests/scripts/corpus/
docs/                  adding-a-plugin, plugin-standards, releasing, repository-settings
orca-catalog.json      the catalog; listed releases are permanent
.orca-version          the Orca release CI uses, with its sha512
```

## Commands

```sh
npm ci --ignore-scripts                    # dev tools only
npm run check                              # everything below except the Orca CLI checks
npm run format                             # Prettier
node scripts/check-policy.mjs [--base <ref>]
node scripts/check-catalog.mjs [--base <ref>] [--with-orca] [--require-current]
node scripts/check-versions.mjs
node --test 'tests/scripts/**/*.test.mjs'
node --test 'tests/<id>/**/*.test.ts'
orca plugin validate plugins/<id> --json
orca plugin check plugins/<id> --json
orca plugin test plugins/<id> --json
```

## Rules

- Work on a branch and open a pull request. Never push to `main`.
- One plugin and one topic per pull request.
- Never run `scripts/tag-release.sh` without `--dry-run`, and never run
  `scripts/apply-repo-settings.sh --settings` or `--rulesets`. Both are for the maintainer.
- Never pass `--approve` to an `orca plugin` command, and never install, load or enable a plugin in
  the user's Orca app, unless the user asked for exactly that.
- Never change or remove an existing release in `orca-catalog.json`.
- Never move or rename a released plugin's folder.
- A change under `plugins/<id>/` needs a higher `version` before the next release, and an access
  change needs a line under "Access" in that plugin's `CHANGELOG.md`.

## Standards (full text in docs/plugin-standards.md)

- No network access unless the README names the hosts and `policy/<id>.json` lists them.
- No `eval`, `new Function`, `.constructor(...)`, `vm`, `worker_threads`, `node:module`,
  non-literal `import()` or `require()`, or computed access on `globalThis`, `global`, `window`,
  `self` or `process`.
- Child processes only through `execFile` or `spawn`, called directly, with a string-literal
  absolute program path from the policy allowlist. No `shell` option, no shells or interpreters.
  A non-literal program is allowed only inside the one exported function a `dynamicPrograms`
  entry names.
- Panels never put text into HTML: no `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `createContextualFragment`, `srcdoc`, `setHTMLUnsafe`, or inline event
  handler attributes. Use `textContent` and DOM nodes.
- No npm dependencies, `package.json` or `node_modules` inside a plugin. No binaries, archives,
  symlinks or TTF/OTF fonts. Lines of code at most 200 characters; no minified files.
- No telemetry or data collection.
- No comments in source. Erasable TypeScript only, `.ts` extensions on relative imports.
- Prettier: no semicolons, single quotes, print width 100.
- Test fixtures hold no personal data. Use `/Users/user`, `host.local`, `192.0.2.x`,
  `2001:db8::` and `00:00:5e:00:53:xx` as placeholders.
- Tests for bug fixes are written to fail first. Only tests that need `orca/testing` live inside
  the plugin folder.
