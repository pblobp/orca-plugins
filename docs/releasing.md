# Releasing

## How versions work here

- Each plugin has its own semantic version, in its `orca-plugin.json`, and its own `CHANGELOG.md`.
- The repository tag `vX.Y.Z` counts releases of the whole repository. It is not any plugin's
  version. Raise the patch number for plugin fixes, and the minor number for a new plugin or a
  plugin's feature release.
- The Orca directory reads tags, not the catalog. At a new tag it lists each plugin at the manifest
  version in the tagged commit. Pushes without a new tag change nothing.
- The root `orca-catalog.json` lets the directory find plugins in subfolders, and it is what people
  use when they add this repository as a catalog source. Each release in it pins a commit and a
  content hash.
- A listed `id@version` is permanent. The directory keeps the first content it sees and refuses a
  moved tag. A fix is always a new plugin version and a new tag.
- A plugin's folder is never moved or renamed after its first release. The directory treats a move
  as a change of identity and pauses new versions until Orca's maintainers confirm it.

## Release checklist

Releases are made from the maintainer's machine. No workflow can tag or publish.

### 1. Bump the version

- [ ] In a pull request, raise `version` in `plugins/<id>/orca-plugin.json`.
- [ ] Add the release to `plugins/<id>/CHANGELOG.md` as `## [X.Y.Z] - YYYY-MM-DD`, with an
      `### Access` section if access changed.
- [ ] Merge it. `main` now holds a squash commit that GitHub made; the branch's own commits are
      gone.

### 2. Add the catalog entry

- [ ] Update a clean checkout of `main` to the merged commit.
- [ ] Run `orca plugin release-entry plugins/<id> --json`. It reads the committed `HEAD`, not the
      working tree. Do not use `orca plugin inspect`: it hashes the working tree, including ignored
      files, and gives a different hash.
- [ ] Read what it prints: the version, the commit, the content hash, the execution level, what the
      plugin contributes and the capabilities it asks for. This is exactly what users will install.
- [ ] In a second pull request, add the printed `entry` as the first item of that plugin's
      `releases` in `orca-catalog.json`. Write the plugin's `id` as `pblobp.<id>`, not the
      `local.<id>` that the command shows. For a new plugin, add the whole entry; see
      [adding-a-plugin.md](adding-a-plugin.md).
- [ ] Leave older releases in place. Orca installs the first release whose `minimumOrca` it meets.
- [ ] Merge it. CI checks that the entry equals what `release-entry` prints for that commit.

### 3. Tag

- [ ] Update the checkout to the new `main`.
- [ ] Run `scripts/tag-release.sh --dry-run vX.Y.Z`. It runs every check and prints the release
      notes and the commands it would run. It refuses unless:
  - `origin` is this repository and the working tree is clean;
  - `HEAD` is exactly `origin/main`, and `origin/main` is GitHub's `main`;
  - the tag looks like `vX.Y.Z`, does not exist yet, and is higher than every existing `v*` tag;
  - the `ci-ok` check from GitHub Actions (app id 15368) succeeded on that commit;
  - `scripts/check-versions.mjs` passes, and so does
    `scripts/check-catalog.mjs --with-orca --require-current --base <previous tag>`, which also
    requires every plugin's current version to be its newest catalog release, at the same files;
  - at least one plugin changed since the previous tag, and each changed plugin's changelog has a
    section for its version.
- [ ] Run `scripts/tag-release.sh vX.Y.Z` and type the tag to confirm. It creates and pushes the
      annotated tag and creates the GitHub release, with notes from the changed plugins'
      changelogs.

Only the owner can create `v*` tags, and nobody can move or delete one. GitHub offers no rule that
limits which commit a tag points at, or which names a tag may have on this plan, so the script's
checks are what keep a tag on a tested `main` commit.

### 4. First release only

- [ ] Add the `orca-plugin` topic: `gh repo edit pblobp/orca-plugins --add-topic orca-plugin`. The
      topic is what makes the directory list the repository, so it is added only now.

### 5. After the tag

- [ ] Check the status page, `https://orca.dev/plugins/pblobp/orca-plugins`, and fix anything it
      reports. The directory validates against the latest Orca release.
- [ ] The directory usually lists a new tag within an hour. A first listing or an update can be
      held for review, with no stated timeline. Nothing here can speed that up.
- [ ] Users on automatic updates get the release 12 hours after it is listed.
- [ ] Unload any development copy of the plugin, then install the listed release:
      `orca plugin install pblobp.<id> --catalog community`.

## When something goes wrong

- A bad release: fix it in a new plugin version and release again. A listed version cannot be
  changed or withdrawn from here.
- A harmful release: report it to Orca's maintainers through the plugin's directory page, which can
  disable installed copies, and publish a fixed version.
- Release notes can be edited after publishing; the tag and the release files cannot.
