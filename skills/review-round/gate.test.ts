import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { baseRunRan, convergedRound, describeDiff, diffSize, extractFailedTests, failuresCoveredByBase, type Finding, hotspots, pairKey, repeatsEarlier, resumedAfter, securityChecklist } from "./gate";

test("diffSize counts hand-written lines and skips generated and binary files", () => {
  const numstat = "10\t2\tsrc/a.ts\n300\t280\tbun.lock\n-\t-\tlogo.png\n5\t0\tdocs/with\ttab.md\n";
  expect(diffSize(numstat, new Set(["bun.lock"]))).toEqual({ added: 15, removed: 2 });
  expect(diffSize("")).toEqual({ added: 0, removed: 0 });
});

test("describeDiff shows the change since the first round", () => {
  expect(describeDiff({ added: 40, removed: 10 }, undefined)).toBe("+40/-10");
  expect(describeDiff({ added: 90, removed: 10 }, { added: 40, removed: 10 })).toBe("+90/-10 (+50 lines since the first round)");
  expect(describeDiff({ added: 30, removed: 5 }, { added: 40, removed: 10 })).toBe("+30/-5 (-15 lines since the first round)");
});

test("baseRunRan rejects a base run that stopped before the check ran", () => {
  const prRun = { command: "gates", cwd: "/wt", head: "31f9dd8e73", tree: "t", pid: 1, exit: 1, seconds: 619, log: "16.log" };
  const unrun = { command: "gates", cwd: "/wt/base", head: "2993a0c914", base: true, pid: 2, exit: 1, seconds: 0, log: "17.log" };
  expect(baseRunRan(prRun, unrun)).toBe(false);
  expect(baseRunRan(prRun, { ...unrun, seconds: 580 })).toBe(true);
  expect(baseRunRan(prRun, { ...unrun, seconds: undefined })).toBe(false);
});

test("failuresCoveredByBase rejects a PR regression hiding behind a base flake", () => {
  const baseLog = [
    "(pass) foo > ok [12.00ms]",
    "(fail) LoanThirdPartyCosts > modifier une ligne [5001.20ms]",
  ].join("\n");
  const samePrLog = "(fail) LoanThirdPartyCosts > modifier une ligne [5004.80ms]\n";
  const regressedPrLog = [
    "(fail) LoanThirdPartyCosts > modifier une ligne [5002.10ms]",
    "(fail) NewFeature > calculates fee [14.00ms]",
  ].join("\n");
  expect(failuresCoveredByBase(samePrLog, baseLog)).toEqual({ covered: true, newFailures: [] });
  expect(failuresCoveredByBase(regressedPrLog, baseLog)).toEqual({
    covered: false,
    newFailures: ["NewFeature > calculates fee"],
  });
  expect(extractFailedTests("com.example.FooTest > handlesNull() FAILED\nFAILED tests/test_a.py::test_x\n")).toEqual(
    new Set(["com.example.FooTest > handlesNull()", "tests/test_a.py::test_x"]),
  );
  // Non-test output (e.g. compiler/linter) keeps baseRunRan semantics.
  expect(failuresCoveredByBase("error TS2345: type mismatch\n", "error TS2345: type mismatch\n")).toEqual({
    covered: true,
    newFailures: [],
  });
});

test("repeatsEarlier reads kept judgments and never asks the judge for a pair it cannot repeat", async () => {
  const dir = mkdtempSync(`${tmpdir()}/same-defect-`);
  const latest = { file: "src/a.ts", line: 12, title: "Retry loses the write", why: "the catch drops the row" };
  const sameFile = { finding: { file: "src/a.ts", line: 9, title: "Write lost on retry", why: "catch swallows it" }, round: "1", rejected: false };
  const otherFile = { finding: { file: "src/b.ts", line: 3, title: "Retry loses the write", why: "same pattern" }, round: "1", rejected: false };
  // A pair in another file that the fixer did not reject is a new instance: no judge run, no repeat.
  expect(await repeatsEarlier(dir, [latest], [otherFile])).toEqual([]);
  // A kept judgment decides without a peer run, so the verdict over the same rounds never changes.
  writeFileSync(`${dir}/same-defect.json`, JSON.stringify({ [pairKey(latest, sameFile.finding)]: { same: true, reason: "both drop the row" } }));
  expect(await repeatsEarlier(dir, [{ ...latest, line: 40 }], [sameFile])).toEqual([
    { latest: { ...latest, line: 40 }, earlier: sameFile.finding, round: "1", reason: "both drop the row" },
  ]);
});

const major = (file: string, title: string): Finding => ({ file, line: 1, title, why: `${title} breaks` });

test("hotspots fires on a file with a major in each of the last 3 green rounds", () => {
  const rounds = [
    { round: "1", majors: [major("src/a.ts", "Lost write"), major("src/b.ts", "Bad parse")] },
    { round: "2", majors: [major("src/a.ts", "Double charge")] },
    { round: "3", majors: [major("src/a.ts", "Stale cache"), major("src/a.ts", "Wrong total")] },
  ];
  expect(hotspots(rounds)).toEqual([
    { hotspot: "src/a.ts", rounds: ["1", "2", "3"], titles: ["Lost write", "Double charge", "Stale cache", "Wrong total"] },
  ]);
  expect(hotspots(rounds.slice(1))).toEqual([]);
});

test("hotspots needs the file in every round of the window, and looks only at the window", () => {
  const gap = [
    { round: "1", majors: [major("src/a.ts", "Lost write")] },
    { round: "2", majors: [major("src/b.ts", "Bad parse")] },
    { round: "3", majors: [major("src/a.ts", "Stale cache")] },
  ];
  expect(hotspots(gap)).toEqual([]);
  const old = [
    { round: "1", majors: [major("src/a.ts", "Lost write")] },
    { round: "2", majors: [major("src/a.ts", "Double charge")] },
    { round: "3", majors: [major("src/a.ts", "Stale cache")] },
    { round: "4", majors: [major("src/b.ts", "Bad parse")] },
  ];
  expect(hotspots(old)).toEqual([]);
});

test("convergedRound takes the latest round on the current tree: a later judgment of the same code wins", () => {
  const clean = { name: "round-1.json", tree: "T", majors: [], verify: "green" };
  const otherTree = { name: "round-2.json", tree: "U", majors: [major("a.py", "Lost write")], verify: "green" };
  expect(convergedRound([clean, otherTree], "T")).toBe(clean);
  expect(convergedRound([clean, { ...clean, name: "round-2.json", verify: "red" }], "T")).toBeUndefined();
  expect(convergedRound([clean, { ...clean, name: "round-2.json", verify: "blocked" }], "T")).toBeUndefined();
  expect(convergedRound([clean, { ...otherTree, tree: "T" }], "T")).toBeUndefined();
  expect(convergedRound([clean, otherTree], "V")).toBeUndefined();
});

type Review = { severity: "major" | "minor"; title: string };

// A throwaway PR repository driven through the real gate CLI: each round is prepared, verified through an exec record,
// sliced, reviewed by a trace that reads every patch, and recorded, exactly as the loop does it.
function gateRepo() {
  // git reports real paths (/private/var on macOS), and the trace must name the patches the way the gate does.
  const root = realpathSync(mkdtempSync(`${tmpdir()}/gate-cli-`));
  const repo = `${root}/repo`;
  mkdirSync(`${root}/bin`);
  // slice reads the PR intent through gh; no PR exists here.
  writeFileSync(`${root}/bin/gh`, "#!/bin/sh\necho 'Test pull request intent.'\n");
  chmodSync(`${root}/bin/gh`, 0o755);
  const env = {
    ...process.env,
    PATH: `${root}/bin:${process.env.PATH}`,
    SHELL: "/bin/sh",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const run = (command: string[], cwd = repo) => {
    const result = Bun.spawnSync(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
    return { exit: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  };
  const git = (...args: string[]) => {
    const result = run(["git", ...args]);
    if (result.exit !== 0) throw new Error(`git ${args.join(" ")}: ${result.err}`);
    return result.out.trim();
  };
  const gate = (...args: string[]) => run(["bun", new URL("./gate.ts", import.meta.url).pathname, ...args]);
  const mustGate = (...args: string[]) => {
    const result = gate(...args);
    if (result.exit !== 0) throw new Error(`gate.ts ${args.join(" ")} exited ${result.exit}: ${result.out}${result.err}`);
    return result.out;
  };
  let edits = 0;
  const commit = (message: string) => {
    edits++;
    writeFileSync(`${repo}/a.py`, `x = ${edits}\n`);
    git("commit", "-qam", message);
  };

  run(["git", "init", "-q", "--bare", "-b", "main", `${root}/origin.git`], root);
  run(["git", "init", "-q", "-b", "main", repo], root);
  writeFileSync(`${repo}/a.py`, "x = 0\n");
  git("add", "a.py");
  git("commit", "-qm", "base");
  git("remote", "add", "origin", `${root}/origin.git`);
  git("push", "-q", "origin", "main");
  git("checkout", "-qb", "feature");
  const dir = `${repo}/.git/review/feature`;

  // Writes verify-N.json for the current tree, its one check proven by an exec record. Round 0 runs no prepare unless
  // asked, as the implement skill may verify without one.
  const verified = (n: number, { red = false, prepare = n > 0, scenarios = [] as unknown[] } = {}) => {
    const command = red ? "false" : "true";
    if (prepare) mustGate("prepare", String(n), "--base", "main");
    expect(gate("exec", String(n), "--", command).exit).toBe(red ? 1 : 0);
    const verify = { head: git("rev-parse", "HEAD"), tree: mustGate("tree").trim(), checks: [{ command, exit: red ? 1 : 0 }], scenarios };
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/verify-${n}.json`, JSON.stringify(verify));
  };
  // A red round runs a failing check and is recorded unreviewed, as the loop records one.
  const round = (n: number, reviews: Review[], { red = false } = {}) => {
    const roundDir = `${dir}/round-${n}`;
    verified(n, { red });
    if (red) {
      mustGate("record", String(n));
      return;
    }
    for (const name of mustGate("slice", String(n)).split("\n").filter(Boolean)) {
      const paths = readFileSync(`${roundDir}/slice-${name.replace(/^sec-/, "")}.txt`, "utf8").split("\n").filter(Boolean);
      const reads = paths.map((path) => ({ type: "tool_use", name: "Read", input: { file_path: `${roundDir}/patches/${path.replaceAll("/", "__")}.patch` } }));
      const findings = name.startsWith("sec-")
        ? []
        : reviews.map(({ severity, title }) => ({ severity, file: "a.py", line: 1, title, why: `${title} breaks`, fix: "fix it", trigger: "any input", pre_existing: false }));
      const trace = [{ type: "assistant", message: { content: reads } }, { type: "result", result: "", structured_output: { findings } }];
      writeFileSync(`${roundDir}/review-${name}.jsonl`, trace.map((event) => JSON.stringify(event)).join("\n"));
    }
    mustGate("reviewed", String(n));
    mustGate("record", String(n));
  };
  // Keeps a judgment for every same-file pair of these major titles, so the verdict never runs the judge: "different"
  // unless the pair is listed in `same` as [latest, earlier].
  const keepJudgments = (titles: string[], same: [string, string][] = []) => {
    const judgments: Record<string, { same: boolean; reason: string }> = {};
    titles.forEach((latest, i) =>
      titles.slice(0, i).forEach((earlier) => {
        const isSame = same.some(([l, e]) => l === latest && e === earlier);
        judgments[pairKey(major("a.py", latest), major("a.py", earlier))] = { same: isSame, reason: isSame ? "both drop the row" : "different defects" };
      }),
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/same-defect.json`, JSON.stringify(judgments));
  };
  return { root, repo, dir, git, gate, mustGate, commit, verified, round, keepJudgments };
}

test("a revert back to a converged round's tree converges again and hands over that round's minors", () => {
  const { root, dir, git, gate, commit, round } = gateRepo();
  try {
    commit("feature");
    round(1, [{ severity: "minor", title: "Round one minor" }]);
    expect(gate().out).toBe("review loop: converged\n");
    commit("minor fixes");
    round(2, [{ severity: "major", title: "Round two major" }, { severity: "minor", title: "Round two minor" }]);
    expect(gate().exit).toBe(1);

    git("revert", "--no-edit", "HEAD");
    const verdict = gate();
    expect(verdict).toMatchObject({ exit: 0, out: "review loop: converged\n" });
    const ready = gate("ready");
    expect(ready.out).toContain("minor left: a.py: Round one minor");
    expect(ready.out).not.toContain("Round two minor");
    expect(ready.out).toContain("round-1.json");
    expect(ready.exit).toBe(1);

    writeFileSync(`${dir}/minor-pass`, "");
    expect(gate("ready")).toMatchObject({ exit: 0, out: "minor left: a.py: Round one minor\nreview loop: ready\n" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("majors in one file for 3 green rounds stall the loop, and a resume does not count those rounds again", () => {
  const { root, dir, gate, commit, round, keepJudgments } = gateRepo();
  try {
    const titles = ["Lost write", "Double charge", "Stale cache", "Wrong total"];
    // Every pair is judged different, so only the hotspot rule can stall the loop.
    keepJudgments(titles);

    for (const [i, title] of titles.slice(0, 3).entries()) {
      commit(`fix ${i}`);
      round(i + 1, [{ severity: "major", title }]);
    }
    expect(gate()).toMatchObject({
      exit: 0,
      out: "review loop: stalled\n  hotspot: a.py: critical or major findings in rounds 1, 2, 3\n",
    });
    expect(JSON.parse(readFileSync(`${dir}/stall.json`, "utf8"))).toEqual([
      { hotspot: "a.py", rounds: ["1", "2", "3"], titles: titles.slice(0, 3) },
    ]);
    expect(gate("resume").exit).toBe(0);
    expect(readFileSync(`${dir}/stalls/1/round`, "utf8")).toBe("3\n");

    commit("fix 3");
    round(4, [{ severity: "major", title: titles[3] }]);
    expect(gate().exit).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("red rounds stay out of the hotspot window, and a red latest round never stalls", () => {
  const { root, gate, commit, round, keepJudgments } = gateRepo();
  try {
    const titles = ["Lost write", "Stale cache", "Wrong total"];
    keepJudgments(titles);
    commit("feature");
    round(1, [{ severity: "major", title: titles[0] }]);
    commit("fix 1");
    round(2, [], { red: true });
    commit("fix 2");
    round(3, [{ severity: "major", title: titles[1] }]);
    commit("fix 3");
    round(4, [{ severity: "major", title: titles[2] }]);
    expect(gate()).toMatchObject({ exit: 0, out: "review loop: stalled\n  hotspot: a.py: critical or major findings in rounds 1, 3, 4\n" });

    commit("fix 4");
    round(5, [], { red: true });
    expect(gate()).toMatchObject({ exit: 1, out: "" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("a same-defect repeat stalls the loop on its own, before any hotspot", () => {
  const { root, dir, gate, commit, round, keepJudgments } = gateRepo();
  try {
    const titles = ["Lost write", "Double charge", "Stale cache"];
    keepJudgments(titles, [["Stale cache", "Double charge"]]);
    for (const [i, title] of titles.entries()) {
      commit(`fix ${i}`);
      round(i + 1, [{ severity: "major", title }]);
    }
    expect(gate()).toMatchObject({
      exit: 0,
      out: "review loop: stalled\n  repeat: a.py: Stale cache ≈ round 2: Double charge (both drop the row)\n",
    });
    const stall = JSON.parse(readFileSync(`${dir}/stall.json`, "utf8"));
    expect(stall).toHaveLength(1);
    expect(stall[0]).toMatchObject({ round: "2", reason: "both drop the row" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("ready follows a converged status cached by an older gate whose round no longer proves green", () => {
  const { root, dir, gate, commit, round } = gateRepo();
  try {
    commit("feature");
    round(1, [{ severity: "minor", title: "Round one minor" }]);
    expect(gate().out).toBe("review loop: converged\n");
    // Rounds recorded before exec records existed have none: today's rules read them as blocked.
    rmSync(`${dir}/round-1/exec`, { recursive: true });
    expect(gate("verify", "1").out).toStartWith("blocked:");

    expect(gate()).toMatchObject({ exit: 0, out: "review loop: converged\n" });
    expect(gate("ready")).toMatchObject({
      exit: 1,
      out: "minor left: a.py: Round one minor\nreview loop: stays draft (the minor pass has not run on the 1 minor finding(s) of round-1.json)\n",
    });
    writeFileSync(`${dir}/minor-pass`, "");
    expect(gate("ready")).toMatchObject({ exit: 0, out: "minor left: a.py: Round one minor\nreview loop: ready\n" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("resumedAfter takes the highest resume marker, and an archive without one counts as 0", () => {
  const root = mkdtempSync(`${tmpdir()}/resumed-after-`);
  // Directory listing order is the filesystem's, so the higher marker sits once in each archive.
  const stalls = (name: string, markers: (string | undefined)[]) => {
    const dir = `${root}/${name}`;
    markers.forEach((marker, i) => {
      mkdirSync(`${dir}/stalls/${i + 1}`, { recursive: true });
      if (marker !== undefined) writeFileSync(`${dir}/stalls/${i + 1}/round`, marker);
    });
    return dir;
  };
  try {
    expect(resumedAfter(stalls("none", []))).toBe(0);
    expect(resumedAfter(stalls("unmarked", [undefined]))).toBe(0);
    expect(resumedAfter(stalls("higher-second", [undefined, "3\n", "6\n"]))).toBe(6);
    expect(resumedAfter(stalls("higher-first", [undefined, "6\n", "3\n"]))).toBe(6);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("securityChecklist reads only the checkbox bullets under the Verification heading", () => {
  const markdown = "# Skill\n\n- [ ] not this one\n\n## Verification\n\nA build-time sentence.\n\n- [ ] First check.\n- plain bullet\n- [ ] Second check.\n\n## Later\n\n- [ ] not this either\n";
  expect(securityChecklist(markdown)).toEqual(["- First check.", "- Second check."]);
  expect(securityChecklist("## Verification\n- [ ] Last section check.")).toEqual(["- Last section check."]);
});

test("securityChecklist throws rather than return an empty checklist", () => {
  expect(() => securityChecklist("# Skill\n\n- [ ] orphan check\n")).toThrow("no `## Verification` heading");
  expect(() => securityChecklist("## Verification\n\nOnly prose.\n\n## Next\n- [ ] elsewhere\n")).toThrow("no `- [ ] ` bullet");
});

test("the hardening skill keeps a checklist the security reviewer can read", () => {
  const checks = securityChecklist(readFileSync(new URL("../hardening/SKILL.md", import.meta.url), "utf8"));
  expect(checks.length).toBeGreaterThan(0);
});

const browserPass = { name: "The page shows the new label", result: "pass", surface: "browser" };
const uiBlocked = 'blocked: the diff changes UI files but no passing scenario has surface "browser"\n';

test("verify 0 after prepare 0 refuses green on a UI diff until a browser scenario passes, and brief 0 says so", () => {
  const { root, repo, dir, git, gate, mustGate, verified } = gateRepo();
  try {
    writeFileSync(`${repo}/app.css`, "body { color: red; }\n");
    git("add", "app.css");
    git("commit", "-qm", "style");
    mustGate("prepare", "0", "--base", "main");
    expect(mustGate("brief", "0")).toContain('UI files changed: at least one passing scenario with surface "browser" is required.');

    verified(0);
    expect(gate("verify", "0")).toMatchObject({ exit: 0, out: uiBlocked });
    verified(0, { scenarios: [{ ...browserPass, surface: "api" }] });
    expect(gate("verify", "0").out).toBe(uiBlocked);
    verified(0, { scenarios: [browserPass] });
    expect(gate("verify", "0").out).toBe("green\n");
    expect(readFileSync(`${dir}/round-0/files.txt`, "utf8")).toContain("app.css");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("verify 0 without prepare 0 reads the diff against origin's default branch, and is blocked without one", () => {
  const { root, repo, git, gate, mustGate, commit, verified } = gateRepo();
  try {
    commit("backend only");
    verified(0);
    // No round-0/files.txt and no origin/HEAD: the gate cannot tell a UI diff, so it blocks instead of guessing.
    const blind = gate("verify", "0");
    expect(blind.exit).toBe(0);
    expect(blind.out).toStartWith("blocked: the UI rule cannot be checked:");
    expect(blind.out).toContain("run gate.ts prepare 0 --base <base> first");

    git("remote", "set-head", "origin", "main");
    expect(gate("verify", "0").out).toBe("green\n");
    expect(mustGate("brief", "0")).not.toContain("UI files changed");

    writeFileSync(`${repo}/page.html`, "<p>new</p>\n");
    verified(0);
    expect(gate("verify", "0").out).toBe(uiBlocked);
    expect(mustGate("brief", "0")).toContain("UI files changed");
    verified(0, { scenarios: [browserPass] });
    expect(gate("verify", "0").out).toBe("green\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("slice puts a non-empty decisions.md into every prompt as recorded decisions, right after the intent", () => {
  const { root, dir, mustGate, commit, verified } = gateRepo();
  try {
    commit("feature");
    verified(1);
    writeFileSync(`${dir}/decisions.md`, "- Rounding: recommended half-up; built on half-up.\n");
    const names = mustGate("slice", "1").split("\n").filter(Boolean);
    expect(names).toEqual(["A", "sec-A"]);
    for (const name of names) {
      const prompt = readFileSync(`${dir}/round-1/review-${name}.prompt`, "utf8");
      expect(prompt).toContain("</intent>\n<recorded_decisions>\n- Rounding: recommended half-up; built on half-up.\n</recorded_decisions>\n<checks_passed>");
      expect(prompt).toContain("They are open, not adopted, but already on the owner's list.");
      expect(prompt).toContain("Do not report a behavior that follows one of them, or the deferred finding itself, unless it breaks a hard invariant");
      expect(prompt).not.toContain("accepted_defaults");
    }

    writeFileSync(`${dir}/decisions.md`, "\n");
    mustGate("slice", "1");
    expect(readFileSync(`${dir}/round-1/review-A.prompt`, "utf8")).not.toContain("<recorded_decisions>\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

// A codex trace that runs each command (exit 0) and answers with no finding. A command is a string, whose output is cut
// as a long output is, or a [command, output] pair.
const codexReview = (...commands: (string | [string, string])[]) =>
  [
    ...commands.map((entry) => {
      const [command, output] = typeof entry === "string" ? [entry, "…"] : entry;
      return JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: `/bin/zsh -lc '${command}'`, exit_code: 0, aggregated_output: output } });
    }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"findings": []}' } }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");

test("one whole cat of slice-A.patch's exact path reads every file of the slice; a partial or relative read does not", () => {
  const { root, repo, dir, git, gate, mustGate, verified } = gateRepo();
  try {
    writeFileSync(`${repo}/a.py`, "x = 1\n");
    writeFileSync(`${repo}/b.py`, "y = 1\n");
    git("add", "a.py", "b.py");
    git("commit", "-qm", "feature");
    verified(1);
    expect(mustGate("slice", "1").split("\n").filter(Boolean)).toEqual(["A", "sec-A"]);
    const roundDir = `${dir}/round-1`;
    const bundle = readFileSync(`${roundDir}/slice-A.patch`, "utf8");
    expect(bundle).toStartWith("=== PATCH: a.py ===\ndiff --git a/a.py b/a.py");
    expect(bundle).toContain("=== PATCH: b.py ===\ndiff --git a/b.py b/b.py");
    expect(readFileSync(`${roundDir}/review-A.prompt`, "utf8")).toContain(`<slice>\nbundle: ${roundDir}/slice-A.patch`);

    const catBundle: [string, string] = [`cat ${roundDir}/slice-A.patch`, bundle];
    writeFileSync(`${roundDir}/review-A.jsonl`, codexReview(catBundle));
    writeFileSync(`${roundDir}/review-sec-A.jsonl`, codexReview(`cat ${roundDir}/patches/a.py.patch`));
    const partial = gate("reviewed", "1");
    expect(partial.exit).toBe(1);
    expect(partial.out).toContain("A: 0 finding(s), 2/2 files opened");
    expect(partial.out).toContain("sec-A: not reviewed, 1/2 files opened");
    expect(partial.out).toContain("never opened: b.py");
    expect(partial.out).toContain("rerun: sec-A");

    const truncated = bundle.slice(0, bundle.indexOf("=== PATCH: b.py ==="));
    for (const command of [
      [`head -n 1 ${roundDir}/slice-A.patch`, "=== PATCH: a.py ==="],
      [`cd /other/round && cat ./slice-A.patch`, "…"],
      [`cd ${roundDir} && cat slice-A.patch`, "…"],
      [`cat ${roundDir}/slice-sec-A.patch`, "…"],
      [`true || cat ${roundDir}/slice-A.patch`, ""],
      [`cat ${roundDir}/slice-A.patch`, truncated],
    ] as [string, string][]) {
      writeFileSync(`${roundDir}/review-sec-A.jsonl`, codexReview(command));
      expect(gate("reviewed", "1")).toMatchObject({ exit: 1 });
    }
    writeFileSync(`${roundDir}/review-sec-A.jsonl`, codexReview(catBundle));
    expect(gate("reviewed", "1")).toMatchObject({ exit: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("an untracked UI file is in prepare 0, brief 0, and verify 0, as in the tree they are keyed on", () => {
  const { root, repo, dir, gate, mustGate, commit, verified } = gateRepo();
  try {
    commit("backend only");
    writeFileSync(`${repo}/new-page.css`, "main { display: grid; }\n");
    expect(mustGate("prepare", "0", "--base", "main")).toContain("2 file(s)");
    expect(readFileSync(`${dir}/round-0/files.txt`, "utf8")).toContain("\tnew-page.css\n");
    expect(readFileSync(`${dir}/round-0/patches/new-page.css.patch`, "utf8")).toContain("+main { display: grid; }");
    expect(mustGate("brief", "0")).toContain('UI files changed: at least one passing scenario with surface "browser" is required.');

    verified(0);
    expect(gate("verify", "0").out).toBe(uiBlocked);
    verified(0, { scenarios: [browserPass] });
    expect(gate("verify", "0").out).toBe("green\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("brief 1 skips a legacy verify-0.json that has neither round-0/files.txt nor origin/HEAD", () => {
  const { root, dir, gate, mustGate, commit, verified } = gateRepo();
  try {
    commit("feature");
    verified(0);
    expect(gate("verify", "0").out).toStartWith("blocked: the UI rule cannot be checked:");
    mustGate("prepare", "1", "--base", "main");
    const brief = gate("brief", "1");
    expect(brief.exit).toBe(0);
    expect(brief.out).toContain("Carried entries: none; this is the first verification, so run everything.");
    expect(brief.err).toContain("no earlier green verification");
    expect(readFileSync(`${dir}/verify-0.json`, "utf8")).toContain('"command":"true"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("a/b.txt and a__b.txt keep distinct patches, and slice-A.patch holds both diffs", () => {
  const { root, repo, dir, git, mustGate, verified } = gateRepo();
  try {
    mkdirSync(`${repo}/a`);
    writeFileSync(`${repo}/a/b.txt`, "nested file\n");
    writeFileSync(`${repo}/a__b.txt`, "flat file\n");
    git("add", "a/b.txt", "a__b.txt");
    git("commit", "-qm", "two paths");
    verified(1);
    expect(mustGate("slice", "1").split("\n").filter(Boolean)).toEqual(["A", "sec-A"]);
    const bundle = readFileSync(`${dir}/round-1/slice-A.patch`, "utf8");
    expect(bundle).toContain("=== PATCH: a/b.txt ===\ndiff --git a/a/b.txt b/a/b.txt");
    expect(bundle).toContain("+nested file");
    expect(bundle).toContain("=== PATCH: a__b.txt ===\ndiff --git a/a__b.txt b/a__b.txt");
    expect(bundle).toContain("+flat file");
    expect(readFileSync(`${dir}/round-1/patches/a__b.txt.patch`, "utf8")).toContain("+nested file");
    expect(readFileSync(`${dir}/round-1/patches/a%5F%5Fb.txt.patch`, "utf8")).toContain("+flat file");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
