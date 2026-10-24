"""Digest coding-agent session logs (Claude Code, OMP, Pi) into compact JSONL: one line per main session."""
import json, os, re, sys, time
from collections import Counter
from pathlib import Path

HOME = Path.home()
CUTOFF = time.time() - 92 * 86400
OUT = Path(sys.argv[1])
SOURCES = [
    ("claude", HOME / ".claude/projects", 1),
    ("omp", HOME / ".omp/agent/sessions", 1),
    ("pi", HOME / ".pi/agent/sessions", 1),
]
SKILL_PATH = re.compile(r"skills/([^/]+)/SKILL\.md")
CMD = re.compile(r"<command-name>/?([^<]+)</command-name>")
NOISE = ("<system-reminder>", "<local-command", "Caveat:", "[Request interrupted")


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def digest(harness, path):
    users, skills, tools = [], Counter(), Counter()
    cwd, start = None, None
    for line in path.open(errors="replace"):
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        cwd = cwd or e.get("cwd")
        start = start or e.get("timestamp")
        if harness == "claude":
            if e.get("isSidechain") or e.get("isMeta"):
                continue
            msg = e.get("message") or {}
            if e.get("type") == "user":
                t = text_of(msg.get("content"))
                for c in CMD.findall(t):
                    skills["/" + c.strip()] += 1
                if t and not t.startswith(NOISE):
                    users.append(t)
            elif e.get("type") == "assistant":
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        tools[c["name"]] += 1
                        inp = c.get("input") or {}
                        if c["name"] == "Skill":
                            skills[inp.get("skill", "?")] += 1
                        for m in SKILL_PATH.findall(json.dumps(inp)):
                            skills[m] += 1
        else:
            if e.get("type") != "message":
                continue
            msg = e.get("message") or {}
            if msg.get("role") == "user" and not msg.get("synthetic"):
                t = text_of(msg.get("content"))
                for m in re.findall(r"^/(?:skill:)?([\w-]+)", t):
                    skills["/" + m] += 1
                if t:
                    users.append(t)
            elif msg.get("role") == "assistant":
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "toolCall":
                        tools[c.get("name", "?")] += 1
                        for m in SKILL_PATH.findall(json.dumps(c.get("arguments") or {})):
                            skills[m] += 1
    if not users:
        return None
    return {
        "harness": harness, "file": str(path), "start": start, "cwd": cwd,
        "n_user": len(users),
        "user": [u[:600] for u in users[:12]] + ([f"... +{len(users) - 12} more"] if len(users) > 12 else []),
        "skills": dict(skills), "tools": dict(tools.most_common(12)),
    }


with OUT.open("w") as out:
    for harness, root, _ in SOURCES:
        n = 0
        for p in root.rglob("*.jsonl"):
            rel = p.relative_to(root).parts
            if len(rel) != 2 or p.stat().st_mtime < CUTOFF:
                continue  # main sessions only: <project>/<session>.jsonl; subagent logs are nested deeper
            d = digest(harness, p)
            if d:
                out.write(json.dumps(d, ensure_ascii=False) + "\n")
                n += 1
        print(harness, n, file=sys.stderr)
