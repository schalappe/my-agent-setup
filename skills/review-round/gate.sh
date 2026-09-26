#!/usr/bin/env bash
# Gate for `/loop N --until '~/.omp/agent/skills/review-round/gate.sh' /skill:review-round`.
# Reads $GIT_DIR/review/round-*.json written by the review-round skill.
# Exit 0 = stop the loop (writes converged|stalled to $GIT_DIR/review/status).
# Exit 1 = run another round. Any other exit = broken gate; /loop disables itself.
set -u
dir="$(git rev-parse --git-dir)/review"
rounds=$(ls "$dir"/round-*.json 2>/dev/null | sort -V) || exit 1
[ -n "$rounds" ] || exit 1

# converged: ≥2 green review passes and the latest found no major issue (so nothing was changed after it).
# stalled: latest green round has as many majors as the previous green one — the loop stopped making progress.
# Red rounds (checks failing) never count as passes; they always continue.
verdict=$(jq -rs '
  map(select(.verify == "green")) as $green
  | if (.[-1].verify != "green") or ($green | length) < 2 then "continue"
    elif $green[-1].major == 0 then "converged"
    elif $green[-1].major >= $green[-2].major then "stalled"
    else "continue" end' $rounds) || exit 2

case "$verdict" in
converged | stalled)
  printf '%s\n' "$verdict" >"$dir/status"
  echo "review loop: $verdict"
  exit 0
  ;;
*) exit 1 ;;
esac
