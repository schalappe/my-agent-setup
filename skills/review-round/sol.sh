#!/usr/bin/env bash
# Runs headless Claude Code on GPT-6.1 Sol through the local CLI Proxy, so reviews and verification come from a
# model family other than the one that wrote the code (Claude). The prompt comes on stdin; extra arguments go to
# `claude -p` (tools, permissions, schema). Prints `claude -p`'s JSON: the report is `.result`, a schema's output
# `.structured_output`.
#
#   sol.sh --check          exits non-zero, with the reason, unless the proxy is up and serves gpt-6.1-sol
#   sol.sh [claude args]    one headless run
#
# The proxy cannot forward a reasoning effort, so no `--effort` is passed. Stderr carries Claude Code's warnings
# about the unknown model; keep it out of the JSON.
set -euo pipefail

proxy=http://localhost:8317
model=gpt-6.1-sol
: "${CLI_PROXY_API_KEY:?CLI_PROXY_API_KEY is not set}"

if [[ ${1:-} == --check ]]; then
  models=$(curl -sf -m 10 -H "Authorization: Bearer $CLI_PROXY_API_KEY" "$proxy/v1/models") \
    || { echo "CLI Proxy does not answer on $proxy" >&2; exit 1; }
  jq -e --arg m "$model" '.data[] | select(.id == $m)' <<<"$models" >/dev/null \
    || { echo "CLI Proxy does not serve $model" >&2; exit 1; }
  exit 0
fi

ANTHROPIC_BASE_URL=$proxy ANTHROPIC_AUTH_TOKEN=$CLI_PROXY_API_KEY ANTHROPIC_API_KEY='' \
  exec claude -p --model "$model" --output-format json --strict-mcp-config --disable-slash-commands \
  --no-session-persistence "$@"
