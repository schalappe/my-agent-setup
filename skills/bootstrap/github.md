# GitHub settings

Every call here changes the remote: it is listed in the plan (step 3) and runs only after approval. Read each setting back with `gh api` afterwards (step 5).

## New repo

In this order:

1. The first commit goes on `main` (`git init -b main`): the hooks let a repo's first commit through, and every later commit on `main` is refused.
2. `gh repo create <owner>/<name> --private|--public --source . --remote origin`.
3. `git push -u origin main`: creating the branch is the one push `pre-push` allows, and `branch-guard.yml` (private-free only) skips it.
4. Probe the plan (`gh api repos/{o}/{r}/rulesets`) and apply the settings below.
5. Every later change goes through a branch and a PR.

## Which branch

Decided by the probe in step 1, `gh api repos/{o}/{r}/rulesets`:

- **public**: rulesets work, and GitHub's own security features are free;
- **private-free**: 403 "Upgrade to GitHub Pro". No rulesets, branch protection, secret scanning, push protection, or code scanning;
- **private-paid** (Pro, Team): rulesets work; secret scanning and code scanning still need paid add-ons. Treat as private-free plus the ruleset.

## Every repo

```sh
gh api -X PUT repos/{o}/{r}/vulnerability-alerts        # Dependabot alerts
gh api -X PUT repos/{o}/{r}/automated-security-fixes    # Dependabot security PRs
```

## Public

```sh
gh api -X PATCH repos/{o}/{r} --input - <<'EOF'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
EOF
gh api -X PUT repos/{o}/{r}/private-vulnerability-reporting
gh api -X PATCH repos/{o}/{r}/code-scanning/default-setup -f state=configured
```

CodeQL default setup picks the languages it supports from the repo.

Standard tier, ruleset on the default branch:

```json
{
  "name": "default-branch",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 0,
      "dismiss_stale_reviews_on_push": false,
      "require_code_owner_review": false,
      "require_last_push_approval": false,
      "required_review_thread_resolution": false}},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": false,
      "required_status_checks": [{"context": "secrets"}, {"context": "check"}]}}
  ]
}
```

`gh api -X POST repos/{o}/{r}/rulesets --input ruleset.json`. Required checks name jobs, never a path-filtered workflow: a skipped workflow never reports, and the PR waits forever. In a monorepo, require `secrets` only.

## Private-free

The local hooks are the only gate: lefthook's `secrets` job for leaks, its `protected-branch` jobs for the default branch. Standard tier adds [templates/branch-guard.yml](templates/branch-guard.yml): it flags any push to the default branch that is not a merged PR.
