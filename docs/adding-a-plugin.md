# Adding a plugin

This page walks through adding a new plugin, from the proposal to its first catalog entry. The rules
each step must meet are in [plugin-standards.md](plugin-standards.md).

## 1. Propose it

Open a [new plugin proposal](https://github.com/pblobp/orca-plugins/issues/new?template=plugin-proposal.yml)
and agree on it first. The proposal names the plugin, its id and the access it needs.

The id is lowercase letters, digits and dashes, at most 64 characters, and must not start with
`orca-`, which Orca reserves. The install key becomes `pblobp.<id>`. Choose the id with care: a
released plugin's folder is never moved or renamed, because the directory treats a move as a new
identity and pauses its updates.

## 2. Scaffold it

```sh
orca plugin create plugins/<id> --template <template>
```

Templates: `theme`, `terminal-theme`, `icon-theme`, `syntax`, `language-pack`, `editor`, `panel`,
`components` and `worker-panel`. Leave out `--publisher`: Orca names the publisher after the
repository owner.

The command also writes Orca's typings into `plugins/<id>/.orca/`. That folder is git-ignored and
must never be committed.

## 3. Complete the folder

A plugin folder needs:

| File               | Contents                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `orca-plugin.json` | The manifest, with `"license": "MIT"` and `"repository": "https://github.com/pblobp/orca-plugins"`, and no `publisher`   |
| `README.md`        | What it does, screenshots, every capability and why it needs it, every network host if any, and a platform support table |
| `CHANGELOG.md`     | [Keep a Changelog](https://keepachangelog.com/) format, with an `### Access` section for anything that changes access    |
| `LICENSE`          | A copy of the root license: `cp LICENSE plugins/<id>/LICENSE`                                                            |

Then add `policy/<id>.json`, even if it is `{}`. [policy/README.md](../policy/README.md) explains
the format.

The first changelog entry looks like this:

```markdown
## [1.0.0] - YYYY-MM-DD

### Added

- A system monitor in the right sidebar.

### Access

- Runs a worker (`trusted-worker`) that reads system statistics.
- `settings:own`: reads its own settings.
- `notifications:show`: shows the memory alert.
```

Everything in the folder is installed on users' machines and counts toward Orca's content hash. Keep
it to what users need.

## 4. TypeScript

Write erasable TypeScript, and give relative imports the `.ts` extension. The plugin's
`tsconfig.json` extends the typings Orca generates and adds the Node typings from the repository
root:

```json
{
  "extends": "./.orca/types/tsconfig.json",
  "compilerOptions": {
    "typeRoots": ["./.orca/types", "../../node_modules/@types"],
    "types": [
      "orca",
      "orca-host",
      "orca-frame",
      "orca-worker",
      "orca-services",
      "orca-testing",
      "node"
    ],
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src", "panel"]
}
```

Run `orca plugin types plugins/<id>` once to write the typings, then
`./node_modules/.bin/tsc -p plugins/<id>/tsconfig.json`. CI does the same for every
`tsconfig.json` in `plugins/*/`, `tests/*/` and `tools/*/`.

## 5. Tests

| Kind                               | Where                                             | Runs with                               |
| ---------------------------------- | ------------------------------------------------- | --------------------------------------- |
| Unit tests and their fixtures      | `tests/<id>/`, fixtures in `tests/<id>/fixtures/` | `node --test 'tests/<id>/**/*.test.ts'` |
| Tests that need Orca's test kit    | `plugins/<id>/src/*.test.ts`                      | `orca plugin test plugins/<id>`         |
| Smoke test against the real system | `tools/<id>/smoke.ts`                             | `node tools/<id>/smoke.ts`              |

Orca's test runner refuses to import a plugin from outside its folder, so only the tests that use
`orca/testing` live inside the plugin. Everything else stays outside, because the plugin folder is
what users install.

Clean captured command output before you commit it as a fixture. Replace user names with `user`,
home paths with `/Users/user` or `/home/user`, host names with `host.local`, IPv4 addresses with
`192.0.2.x`, IPv6 addresses with `2001:db8::x` and MAC addresses with `00:00:5e:00:53:xx`. CI scans
fixtures for anything else.

## 6. Check it

```sh
orca plugin validate plugins/<id> --json
orca plugin check plugins/<id> --json
orca plugin test plugins/<id> --json
npm run check
```

In a pull request, CI runs these for each plugin the pull request touches, the unit and smoke tests
on Ubuntu, macOS and Windows, and the repository checks on everything.

## 7. Release it

The first release adds a catalog entry and a tag. Follow [releasing.md](releasing.md). The catalog
entry for a new plugin looks like this, with `releases` pasted from `orca plugin release-entry`:

```json
{
  "id": "pblobp.<id>",
  "source": {
    "kind": "git",
    "url": "https://github.com/pblobp/orca-plugins.git",
    "ref": "main",
    "path": "plugins/<id>"
  },
  "description": "One sentence for the catalog.",
  "releases": []
}
```
