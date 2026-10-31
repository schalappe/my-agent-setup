#!/usr/bin/env bash
# Runs headless Claude Code on GPT-6.1 Sol through the local CLI Proxy, so reviews and verification come from a
# model family other than the one that wrote the code (Claude). The prompt comes on stdin; extra arguments go to
# `claude -p` (tools, permissions, schema). Prints `claude -p`'s JSON: the report is `.result`, a schema's output
# `.structured_output`.
#
#   sol.sh --check          exits non-zero, with the reason, unless the proxy is up and serves gpt-6.1-sol
#   sol.sh [claude args]    one headless run
#
# The proxy URL and token come from the `env` of ~/.claude/settings.json, which Claude Code applies over the
# process environment, so this script does not set them. The proxy cannot forward a reasoning effort, so no
# `--effort` is passed. Tool search and tool-use concurrency match the interactive `ccx` alias, the setup known to
# work with Sol. Stderr carries Claude Code's warnings about the unknown model; keep it out of the JSON.
set -euo pipefail

model=gpt-6.1-sol

if [[ ${1:-} == --check ]]; then
    settings=~/.claude/settings.json
    proxy=$(jq -er '.env.ANTHROPIC_BASE_URL' "$settings") ||
        {
            echo "$settings sets no env.ANTHROPIC_BASE_URL" >&2
            exit 1
        }
    token=$(jq -er '.env.ANTHROPIC_AUTH_TOKEN' "$settings") ||
        {
            echo "$settings sets no env.ANTHROPIC_AUTH_TOKEN" >&2
            exit 1
        }
    models=$(curl -sf -m 10 -H "Authorization: Bearer $token" "$proxy/v1/models") ||
        {
            echo "CLI Proxy does not answer on $proxy" >&2
            exit 1
        }
    jq -e --arg m "$model" '.data[] | select(.id == $m)' <<<"$models" >/dev/null ||
        {
            echo "CLI Proxy does not serve $model" >&2
            exit 1
        }
    exit 0
fi

ENABLE_TOOL_SEARCH=false CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=3 \
    exec claude -p --model "$model" --output-format json --strict-mcp-config --disable-slash-commands \
    --no-session-persistence "$@"
