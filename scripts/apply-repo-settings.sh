#!/usr/bin/env bash
set -euo pipefail

REPO="pblobp/orca-plugins"
REPO_PATTERN='^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$'
DESCRIPTION="Plugins for the Orca desktop app, and the checks and rules that guard them."
MODE=""
TAG_CHECK=0
OUT=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS="$SCRIPT_DIR/rulesets"
DIFFS=0
ERRORS=0

LABELS=(
  "bug|d73a4a|Something in a plugin does not work"
  "enhancement|a2eeef|A new feature or a change to one"
  "plugin-proposal|5319e7|A proposal for a new plugin"
  "triage|fbca04|Waiting for the maintainer"
)

usage() {
  cat <<'USAGE'
Usage: scripts/apply-repo-settings.sh (--settings | --rulesets [--with-tag-check] | --read-back) [OWNER/NAME]

Applies or reads back the GitHub settings in docs/repository-settings.md.
The repository defaults to pblobp/orca-plugins.

--settings        repository options, the Actions policy, security features, labels
--rulesets        the branch ruleset for main and the two tag rulesets
--with-tag-check  with --rulesets or --read-back: the tag ruleset that also requires ci-ok
--read-back       print the current state of everything above and mark differences

Run --settings first. Run --rulesets only after CI and CodeQL pass on main
under the new Actions policy. Both phases are safe to run again.
USAGE
}

die() {
  printf 'apply-repo-settings: %s\n' "$1" >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --settings | --rulesets | --read-back)
      [ -z "$MODE" ] || die "choose one of --settings, --rulesets, --read-back"
      MODE="${1#--}"
      ;;
    --with-tag-check) TAG_CHECK=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "unknown option: $1" ;;
    *) REPO="$1" ;;
  esac
  shift
done

[ -n "$MODE" ] || {
  usage >&2
  exit 2
}
[[ "$REPO" =~ $REPO_PATTERN ]] || die "the repository must look like owner/name, got: $REPO"
command -v gh >/dev/null 2>&1 || die "gh is required"
command -v node >/dev/null 2>&1 || die "node is required"

tag_ruleset_file() {
  if [ "$TAG_CHECK" = 1 ]; then
    printf '%s' "$RULESETS/tags-immutable-with-check.json"
  else
    printf '%s' "$RULESETS/tags-immutable.json"
  fi
}

ruleset_name() {
  node --input-type=commonjs -e '
    process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).name)
  ' "$1"
}

ruleset_id() {
  local name="$1" list rid rname
  list="$(gh api "repos/$REPO/rulesets?includes_parents=false&per_page=100" --jq '.[] | [.id, .name] | @tsv')" || return 1
  while IFS=$'\t' read -r rid rname; do
    if [ "$rname" = "$name" ] && [[ "$rid" =~ ^[0-9]+$ ]]; then
      printf '%s' "$rid"
      return 0
    fi
  done <<<"$list"
  return 0
}

apply_settings() {
  printf 'Repository options\n'
  gh api -X PATCH "repos/$REPO" --silent \
    -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
    -F delete_branch_on_merge=true -F allow_auto_merge=true -F allow_update_branch=true \
    -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY \
    -F has_wiki=false -F has_projects=false -F has_issues=true \
    -f description="$DESCRIPTION"

  printf 'Actions: selected actions only, SHA pinning required\n'
  gh api -X PUT "repos/$REPO/actions/permissions" --silent --input - \
    <<<'{"enabled":true,"allowed_actions":"selected","sha_pinning_required":true}'
  gh api -X PUT "repos/$REPO/actions/permissions/selected-actions" --silent --input - \
    <<<'{"github_owned_allowed":true,"verified_allowed":false,"patterns_allowed":["ossf/scorecard-action@*"]}'
  gh api -X PUT "repos/$REPO/actions/permissions/workflow" --silent \
    -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
  gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --silent \
    -f approval_policy=all_external_contributors

  printf 'Security features\n'
  gh api -X PUT "repos/$REPO/private-vulnerability-reporting" --silent
  gh api -X PUT "repos/$REPO/vulnerability-alerts" --silent
  gh api -X PUT "repos/$REPO/automated-security-fixes" --silent
  gh api -X PUT "repos/$REPO/immutable-releases" --silent

  printf 'Labels\n'
  local entry name color text
  for entry in "${LABELS[@]}"; do
    IFS='|' read -r name color text <<<"$entry"
    gh label create "$name" --repo "$REPO" --color "$color" --description "$text" --force
  done
  printf 'Done. CodeQL default setup stays off; the workflow in .github/workflows/codeql.yml runs instead.\n'
}

apply_ruleset() {
  local file="$1" name id
  name="$(ruleset_name "$file")"
  id="$(ruleset_id "$name")" || die "cannot list the rulesets of $REPO"
  if [ -n "$id" ]; then
    gh api -X PUT "repos/$REPO/rulesets/$id" --silent --input "$file"
    printf 'updated ruleset "%s" (%s)\n' "$name" "$id"
  else
    gh api -X POST "repos/$REPO/rulesets" --silent --input "$file"
    printf 'created ruleset "%s"\n' "$name"
  fi
}

apply_rulesets() {
  apply_ruleset "$RULESETS/main.json"
  apply_ruleset "$RULESETS/tags-create.json"
  apply_ruleset "$(tag_ruleset_file)"
}

expect() {
  if [ "$2" = "$3" ]; then
    printf 'ok    %-52s %s\n' "$1" "$2"
  else
    printf 'DIFF  %-52s %s (want %s)\n' "$1" "$2" "$3"
    DIFFS=$((DIFFS + 1))
  fi
}

unreadable() {
  printf 'ERROR %-52s %s\n' "$1" "$(printf '%s' "$2" | tr '\n' ' ' | cut -c1-160)"
  ERRORS=$((ERRORS + 1))
}

fetch() {
  if OUT="$(gh api "$2" --jq "$3" 2>&1)"; then
    return 0
  fi
  unreadable "$1" "$OUT"
  return 1
}

read_back() {
  local out
  printf 'Repository %s\n' "$REPO"
  if fetch "repository" "repos/$REPO" '[.allow_squash_merge, .allow_merge_commit, .allow_rebase_merge, .delete_branch_on_merge, .allow_auto_merge, .allow_update_branch, .squash_merge_commit_title, .squash_merge_commit_message, .has_wiki, .has_projects, .has_issues, .security_and_analysis.secret_scanning.status, .security_and_analysis.secret_scanning_push_protection.status] | map(tostring) | join(" ")'; then
    out="$OUT"
    local sq mc rb del auto upd title msg wiki proj issues scan push
    read -r sq mc rb del auto upd title msg wiki proj issues scan push <<<"$out"
    expect "allow_squash_merge" "$sq" true
    expect "allow_merge_commit" "$mc" false
    expect "allow_rebase_merge" "$rb" false
    expect "delete_branch_on_merge" "$del" true
    expect "allow_auto_merge" "$auto" true
    expect "allow_update_branch" "$upd" true
    expect "squash_merge_commit_title" "$title" PR_TITLE
    expect "squash_merge_commit_message" "$msg" PR_BODY
    expect "has_wiki" "$wiki" false
    expect "has_projects" "$proj" false
    expect "has_issues" "$issues" true
    expect "secret_scanning" "$scan" enabled
    expect "secret_scanning_push_protection" "$push" enabled
  fi
  if fetch "topics" "repos/$REPO/topics" '.names | join(",")'; then
    out="$OUT"
    printf 'info  %-52s %s\n' "topics (orca-plugin is added at the first release)" "${out:-none}"
  fi

  if fetch "actions permissions" "repos/$REPO/actions/permissions" '[.enabled, .allowed_actions, .sha_pinning_required] | map(tostring) | join(" ")'; then
    out="$OUT"
    local enabled allowed pinning
    read -r enabled allowed pinning <<<"$out"
    expect "actions enabled" "$enabled" true
    expect "actions allowed_actions" "$allowed" selected
    expect "actions sha_pinning_required" "$pinning" true
  fi
  if out="$(gh api "repos/$REPO/actions/permissions/selected-actions" --jq '[.github_owned_allowed, .verified_allowed, (.patterns_allowed | join(","))] | map(tostring) | join(" ")' 2>/dev/null)"; then
    local owned verified patterns
    read -r owned verified patterns <<<"$out"
    expect "selected actions github_owned_allowed" "$owned" true
    expect "selected actions verified_allowed" "$verified" false
    expect "selected actions patterns_allowed" "$patterns" "ossf/scorecard-action@*"
  else
    expect "selected actions" "not configured" "GitHub-owned and ossf/scorecard-action@*"
  fi
  if fetch "workflow permissions" "repos/$REPO/actions/permissions/workflow" '[.default_workflow_permissions, .can_approve_pull_request_reviews] | map(tostring) | join(" ")'; then
    out="$OUT"
    local perms approve
    read -r perms approve <<<"$out"
    expect "default_workflow_permissions" "$perms" read
    expect "can_approve_pull_request_reviews" "$approve" false
  fi
  if fetch "fork pull request approval" "repos/$REPO/actions/permissions/fork-pr-contributor-approval" '.approval_policy'; then
    out="$OUT"
    expect "fork pull request approval_policy" "$out" all_external_contributors
  fi

  if fetch "private vulnerability reporting" "repos/$REPO/private-vulnerability-reporting" '.enabled | tostring'; then
    out="$OUT"
    expect "private vulnerability reporting" "$out" true
  fi
  local status
  status="$({ gh api -i "repos/$REPO/vulnerability-alerts" 2>/dev/null || true; } | head -n 1 | awk '{print $2}')"
  case "$status" in
    204) expect "dependabot alerts" enabled enabled ;;
    404) expect "dependabot alerts" disabled enabled ;;
    *) unreadable "dependabot alerts" "HTTP status ${status:-none}" ;;
  esac
  if fetch "dependabot security updates" "repos/$REPO/automated-security-fixes" '.enabled | tostring'; then
    out="$OUT"
    expect "dependabot security updates" "$out" true
  fi
  if fetch "immutable releases" "repos/$REPO/immutable-releases" '.enabled | tostring'; then
    out="$OUT"
    expect "immutable releases" "$out" true
  fi
  if fetch "code scanning default setup" "repos/$REPO/code-scanning/default-setup" '.state'; then
    out="$OUT"
    expect "code scanning default setup" "$out" not-configured
  fi

  local file name id json diff
  for file in "$RULESETS/main.json" "$RULESETS/tags-create.json" "$(tag_ruleset_file)"; do
    name="$(ruleset_name "$file")"
    if ! id="$(ruleset_id "$name" 2>/dev/null)"; then
      unreadable "ruleset \"$name\"" "cannot list rulesets"
      continue
    fi
    if [ -z "$id" ]; then
      expect "ruleset \"$name\"" missing "as in ${file#"$SCRIPT_DIR/"}"
      continue
    fi
    if ! json="$(gh api "repos/$REPO/rulesets/$id" 2>&1)"; then
      unreadable "ruleset \"$name\"" "$json"
      continue
    fi
    if diff="$(printf '%s' "$json" | node "$SCRIPT_DIR/lib/ruleset-diff.mjs" "$file")"; then
      expect "ruleset \"$name\" ($id)" "as in ${file#"$SCRIPT_DIR/"}" "as in ${file#"$SCRIPT_DIR/"}"
    else
      expect "ruleset \"$name\" ($id)" "$(printf '%s' "$diff" | tr '\n' ';')" "as in ${file#"$SCRIPT_DIR/"}"
    fi
  done

  local labels entry label
  if labels="$(gh label list --repo "$REPO" --limit 200 --json name --jq '.[].name' 2>&1)"; then
    for entry in "${LABELS[@]}"; do
      label="${entry%%|*}"
      if printf '%s\n' "$labels" | grep -qxF "$label"; then
        expect "label $label" present present
      else
        expect "label $label" missing present
      fi
    done
  else
    unreadable "labels" "$labels"
  fi

  printf '\n%d difference(s), %d unreadable setting(s)\n' "$DIFFS" "$ERRORS"
  [ "$DIFFS" -eq 0 ] && [ "$ERRORS" -eq 0 ]
}

case "$MODE" in
  settings) apply_settings ;;
  rulesets) apply_rulesets ;;
  read-back) read_back ;;
esac
