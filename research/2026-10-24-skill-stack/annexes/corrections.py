"""Pull every mid-session user message that looks like a correction or frustration."""
import json, re, sys
from pathlib import Path

MARK = re.compile(r"(?i)\b(non[ ,.!]|pas ça|pas ca|je t'?ai dit|je t'avais|arr[êe]te|pourquoi tu|trop (long|compliqu|verbeu)|simplifi|c'est pas ce que|tu as oubli|n'importe quoi|encore une fois|j'ai dit|ne fais pas|don't|stop |wrong|i said|why did you|too (long|complex))")
NOISE = ("<system-reminder>", "<local-command", "<skill ", "Caveat:", "<command-")
sessions = [json.loads(l) for l in open(sys.argv[1])]
out = open(sys.argv[2], "w")
n = 0
for s in sessions:
    path, h = Path(s["file"]), s["harness"]
    idx = 0
    for line in path.open(errors="replace"):
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = e.get("message") or {}
        if h == "claude":
            if e.get("type") != "user" or e.get("isMeta") or e.get("isSidechain"):
                continue
        elif e.get("type") != "message" or msg.get("role") != "user" or msg.get("synthetic"):
            continue
        c = msg.get("content")
        t = c if isinstance(c, str) else "\n".join(x.get("text", "") for x in (c or []) if isinstance(x, dict) and x.get("type") == "text")
        if not t:
            continue
        idx += 1
        if idx == 1 or t.startswith(NOISE) or len(t) > 2500 or not MARK.search(t):
            continue
        out.write(json.dumps({"harness": h, "cwd": s["cwd"], "start": s["start"], "turn": idx, "text": t[:800]}, ensure_ascii=False) + "\n")
        n += 1
print(n)
