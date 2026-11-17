#!/usr/bin/env bash
set -euo pipefail

REPO="pblobp/orca-plugins"
ACTIONS_APP_ID=15368
TAG_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+$'
STRICT_TAG_PATTERN='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
REPO_PATTERN='^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$'
SHA_PATTERN='^[0-9a-f]{40}$'
PLUGIN_PATTERN='^[a-z0-9][a-z0-9-]*$'

DRY_RUN=0
ASSUME_YES=0
TAG=""
FAILURES=0

usage() {
  cat <<'USAGE'
Usage: scripts/tag-release.sh [--dry-run] [--yes] [--repo OWNER/NAME] vX.Y.Z

Tags the current commit as a release and publishes the GitHub release.
It refuses unless every check passes:
  - origin is the repository, and the working tree is clean
  - HEAD is exactly origin/main, and origin/main is GitHub's main
  - the tag is vX.Y.Z, does not exist, and is higher than every v* tag
  - the ci-ok check from GitHub Actions succeeded on HEAD
  - scripts/check-versions.mjs and scripts/check-catalog.mjs pass
  - at least one plugin changed since the previous tag, and each changed
    plugin's CHANGELOG.md has a section for its version

--dry-run  run every check and print what would be done, change nothing
--yes      do not ask for confirmation
USAGE
}

die() {
  printf 'tag-release: %s\n' "$1" >&2
  exit 2
}

pass() {
  printf 'ok    %s\n' "$1"
}

fail() {
  printf 'FAIL  %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

warn() {
  printf 'warn  %s\n' "$1" >&2
}

version_gt() {
  local IFS=.
  local -a left right
  read -r -a left <<<"${1#v}"
  read -r -a right <<<"${2#v}"
  local i
  for i in 0 1 2; do
    if ((10#${left[i]} > 10#${right[i]})); then return 0; fi
    if ((10#${left[i]} < 10#${right[i]})); then return 1; fi
  done
  return 1
}

newest_tag() {
  local newest="" tag
  while IFS= read -r tag; do
    [[ "$tag" =~ $STRICT_TAG_PATTERN ]] || continue
    if [ -z "$newest" ] || version_gt "$tag" "$newest"; then newest="$tag"; fi
  done
  printf '%s' "$newest"
}

manifest_field() {
  node --input-type=commonjs -e '
    const manifest = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    process.stdout.write(String(manifest[process.argv[2]] ?? ""))
  ' "$1" "$2"
}

changelog_section() {
  awk -v want="$2" '
    /^## / {
      if (found) exit
      line = $0
      sub(/^## +\[?/, "", line)
      split(line, parts, /[] ]/)
      if (parts[1] == want) { found = 1; next }
    }
    found { print }
  ' "$1"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    --repo)
      [ "$#" -ge 2 ] || die "--repo needs OWNER/NAME"
      REPO="$2"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "unknown option: $1" ;;
    *)
      [ -z "$TAG" ] || die "give exactly one tag"
      TAG="$1"
      ;;
  esac
  shift
done

[ -n "$TAG" ] || {
  usage >&2
  exit 2
}
[[ "$TAG" =~ $TAG_PATTERN ]] || die "the tag must look like v1.2.3, got: $TAG"
[[ "$TAG" =~ $STRICT_TAG_PATTERN ]] || die "the tag must not have leading zeros: $TAG"
[[ "$REPO" =~ $REPO_PATTERN ]] || die "the repository must look like owner/name, got: $REPO"
for tool in git gh node awk; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run this inside the repository"
cd "$ROOT"

printf 'Checking %s for %s%s\n\n' "$REPO" "$TAG" "$([ "$DRY_RUN" = 1 ] && printf ' (dry run)')"

origin_url="$(git remote get-url origin 2>/dev/null || true)"
case "$origin_url" in
  "git@github.com:$REPO.git" | "git@github.com:$REPO" | "https://github.com/$REPO.git" | "https://github.com/$REPO" | "ssh://git@github.com/$REPO.git")
    pass "origin is github.com/$REPO"
    ;;
  *) fail "origin is '$origin_url', not github.com/$REPO" ;;
esac

if [ -z "$(git status --porcelain --untracked-files=normal)" ]; then
  pass "the working tree is clean"
else
  fail "the working tree has uncommitted or untracked changes"
fi

if git fetch --quiet --tags origin 2>/dev/null; then
  pass "fetched origin and its tags"
else
  fail "git fetch --tags origin failed (a local tag may differ from origin's)"
fi

HEAD_SHA="$(git rev-parse --verify --quiet 'HEAD^{commit}' || true)"
MAIN_SHA="$(git rev-parse --verify --quiet 'refs/remotes/origin/main^{commit}' || true)"
GITHUB_MAIN="$(gh api "repos/$REPO/commits/main" --jq .sha 2>/dev/null || true)"
[[ "$GITHUB_MAIN" =~ $SHA_PATTERN ]] || GITHUB_MAIN=""

if [[ "$HEAD_SHA" =~ $SHA_PATTERN ]] && [ "$HEAD_SHA" = "$MAIN_SHA" ]; then
  pass "HEAD is origin/main ($HEAD_SHA)"
else
  fail "HEAD (${HEAD_SHA:-none}) is not origin/main (${MAIN_SHA:-none})"
fi

if [[ "$GITHUB_MAIN" =~ $SHA_PATTERN ]] && [ "$GITHUB_MAIN" = "$MAIN_SHA" ]; then
  pass "origin/main matches main on GitHub"
else
  fail "main on GitHub (${GITHUB_MAIN:-unreadable}) differs from origin/main (${MAIN_SHA:-none})"
fi

if git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  fail "$TAG already exists locally"
fi
remote_tags=""
if remote_tags="$(git ls-remote --tags --refs origin 2>/dev/null)"; then
  if printf '%s\n' "$remote_tags" | awk '{print $2}' | grep -qxF "refs/tags/$TAG"; then
    fail "$TAG already exists on origin"
  fi
else
  fail "cannot list the tags on origin"
fi

ALL_NEWEST="$({
  git tag --list 'v*'
  printf '%s\n' "$remote_tags" | awk '{print $2}' | sed -n 's#^refs/tags/##p'
} | newest_tag)"
PREV=""
if [[ "$HEAD_SHA" =~ $SHA_PATTERN ]]; then
  PREV="$(git tag --list 'v*' --merged "$HEAD_SHA" | newest_tag)"
fi

if [ -z "$ALL_NEWEST" ] || version_gt "$TAG" "$ALL_NEWEST"; then
  pass "$TAG is higher than every existing tag (${ALL_NEWEST:-there are none yet})"
else
  fail "$TAG is not higher than the existing tag $ALL_NEWEST"
fi
if [ -n "$ALL_NEWEST" ] && [ "$ALL_NEWEST" != "$PREV" ]; then
  warn "the newest tag $ALL_NEWEST is not on main; the previous release on main is ${PREV:-none}"
fi

if [[ "$HEAD_SHA" =~ $SHA_PATTERN ]]; then
  if ! ci="$(gh api "repos/$REPO/commits/$HEAD_SHA/check-runs?check_name=ci-ok&filter=latest&per_page=100" \
    --jq "[.check_runs[] | select(.app.id == $ACTIONS_APP_ID) | .status + \"/\" + (.conclusion // \"none\")] | join(\",\")" \
    2>/dev/null)"; then
    ci="unreadable"
  fi
  ci_ok=1
  if [ -z "$ci" ] || [ "$ci" = unreadable ]; then
    ci_ok=0
  else
    IFS=, read -r -a runs <<<"$ci"
    for run_state in "${runs[@]}"; do
      [ "$run_state" = completed/success ] || ci_ok=0
    done
  fi
  if [ "$ci_ok" = 1 ]; then
    pass "ci-ok from GitHub Actions succeeded on $HEAD_SHA"
  else
    fail "ci-ok from GitHub Actions has not succeeded on HEAD (${ci:-no check run})"
  fi
else
  fail "ci-ok cannot be checked without a commit"
fi

if node scripts/check-versions.mjs; then
  pass "scripts/check-versions.mjs"
else
  fail "scripts/check-versions.mjs"
fi

catalog_args=(--with-orca --require-current)
if [ -n "$PREV" ]; then catalog_args+=(--base "$PREV"); fi
if node scripts/check-catalog.mjs "${catalog_args[@]}"; then
  pass "scripts/check-catalog.mjs ${catalog_args[*]}"
else
  fail "scripts/check-catalog.mjs ${catalog_args[*]}"
fi

NOTES="$(mktemp "${TMPDIR:-/tmp}/orca-plugins-release.XXXXXX")"
trap 'rm -f "$NOTES"' EXIT
changed=0
for dir in plugins/*/; do
  [ -f "${dir}orca-plugin.json" ] || continue
  id="$(basename "$dir")"
  [[ "$id" =~ $PLUGIN_PATTERN ]] || continue
  if [ -n "$PREV" ] && git diff --quiet "$PREV" HEAD -- "plugins/$id"; then continue; fi
  version="$(manifest_field "plugins/$id/orca-plugin.json" version)"
  name="$(manifest_field "plugins/$id/orca-plugin.json" name)"
  section=""
  if [ -f "plugins/$id/CHANGELOG.md" ]; then
    section="$(changelog_section "plugins/$id/CHANGELOG.md" "$version")"
  fi
  if [ -z "$(printf '%s' "$section" | tr -d '[:space:]')" ]; then
    fail "plugins/$id/CHANGELOG.md has no section for $version"
    continue
  fi
  changed=$((changed + 1))
  {
    printf '## %s %s\n' "$name" "$version"
    printf '%s\n\n' "$section"
  } >>"$NOTES"
done
if [ "$changed" -gt 0 ]; then
  pass "$changed plugin(s) changed since ${PREV:-the start}"
else
  fail "no plugin changed since ${PREV:-the start}, so there is nothing to release"
fi

printf '\n'
if [ "$FAILURES" -gt 0 ]; then
  printf 'tag-release: %d check(s) failed; nothing was tagged\n' "$FAILURES" >&2
  exit 1
fi

printf 'Release notes:\n\n'
cat "$NOTES"

if [ "$DRY_RUN" = 1 ]; then
  printf 'Dry run. Every check passed. These commands would run:\n'
  printf '  git tag -a %s -m %s %s\n' "$TAG" "$TAG" "$HEAD_SHA"
  printf '  git push origin refs/tags/%s\n' "$TAG"
  printf '  gh release create %s --repo %s --verify-tag --title %s --notes-file <the notes above>\n' "$TAG" "$REPO" "$TAG"
  exit 0
fi

if [ "$ASSUME_YES" != 1 ]; then
  [ -t 0 ] || die "not a terminal; pass --yes to tag without a prompt"
  printf 'This tag is permanent. The Orca directory usually lists it within an hour.\n'
  read -r -p "Type $TAG to tag $HEAD_SHA and publish the release: " answer
  [ "$answer" = "$TAG" ] || die "not confirmed; nothing was tagged"
fi

git tag -a "$TAG" -m "$TAG" "$HEAD_SHA"
git push origin "refs/tags/$TAG"
gh release create "$TAG" --repo "$REPO" --verify-tag --title "$TAG" --notes-file "$NOTES"
printf 'tag-release: %s is tagged at %s and released\n' "$TAG" "$HEAD_SHA"
