#!/usr/bin/env bun
// Pin GitHub Actions to full commit SHAs, in place.
// Usage: pin.ts <workflow-or-action.yml>...
// `uses: owner/repo[/path]@LATEST` resolves to the latest release tag; `@<tag>` resolves that tag.
// Each pinned line becomes `uses: owner/repo@<40-hex sha> # <tag>`. Lines already on a SHA, local actions
// (`./`), and `docker://` images are left alone, so a second run changes nothing.
// Branch refs are refused: a branch moves, which is exactly what pinning prevents.
// Needs `gh` logged in. Exit 0 = all pinned, 1 = some refs unresolved (printed), 2 = error.

const USES = /^(\s*-?\s*uses:\s*)([\w.-]+)\/([\w.-]+)((?:\/[^@\s]*)?)@([^\s#]+)(.*)$/;
const SHA = /^[0-9a-f]{40}$/;

async function api(path: string): Promise<any | undefined> {
  const result = await Bun.$`gh api ${path}`.quiet().nothrow();
  return result.exitCode === 0 ? result.json() : undefined;
}

// Annotated tags point at a tag object, which points at the commit.
async function commitOfTag(repo: string, tag: string): Promise<string | undefined> {
  let object = (await api(`repos/${repo}/git/ref/tags/${tag}`))?.object;
  while (object?.type === "tag") object = (await api(`repos/${repo}/git/tags/${object.sha}`))?.object;
  return object?.type === "commit" ? object.sha : undefined;
}

async function resolve(repo: string, ref: string): Promise<{ sha: string; tag: string } | string> {
  const tag = ref === "LATEST" ? (await api(`repos/${repo}/releases/latest`))?.tag_name : ref;
  if (!tag) return `${repo}: no published release; replace LATEST with a tag`;
  const sha = await commitOfTag(repo, tag);
  return sha ? { sha, tag } : `${repo}@${tag}: not a tag (branches are refused)`;
}

async function main(): Promise<number> {
  const files = Bun.argv.slice(2);
  if (files.length === 0) throw new Error("usage: pin.ts <file.yml>...");
  const cache = new Map<string, Promise<{ sha: string; tag: string } | string>>();
  const failures: string[] = [];
  let pinnedCount = 0;

  for (const file of files) {
    const lines = (await Bun.file(file).text()).split("\n");
    let changed = false;
    for (const [index, line] of lines.entries()) {
      const match = line.match(USES);
      if (!match) continue;
      const [, prefix, owner, name, subpath, ref, rest] = match;
      if (SHA.test(ref)) continue;
      const repo = `${owner}/${name}`;
      const key = `${repo}@${ref}`;
      if (!cache.has(key)) cache.set(key, resolve(repo, ref));
      const pinned = await cache.get(key)!;
      if (typeof pinned === "string") {
        failures.push(`${file}:${index + 1} ${pinned}`);
        continue;
      }
      // An old `# vX` comment would contradict the new pin; any other trailing text is kept.
      const tail = rest.replace(/^\s*#.*$/, "");
      lines[index] = `${prefix}${repo}${subpath}@${pinned.sha} # ${pinned.tag}${tail}`;
      console.log(`${file}:${index + 1} ${key} -> ${pinned.sha.slice(0, 12)} (${pinned.tag})`);
      changed = true;
      pinnedCount++;
    }
    if (changed) await Bun.write(file, lines.join("\n"));
  }

  for (const failure of failures) console.error(failure);
  if (pinnedCount === 0 && failures.length === 0) console.log("Nothing to pin: every action is on a SHA.");
  return failures.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
