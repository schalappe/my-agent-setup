// Which changed files can change a screen, for the gate's browser rule: `isUiFile(root, path)` with `path` relative to
// the repository root `root`.
//
// A component, style, or page file (UI_FILE) always counts. A plain script (.ts/.js/.mjs) counts when its nearest
// package.json depends on a UI framework and a component of the repository reaches it through imports, directly or
// through other scripts: a shared hook changes every screen that imports it, while a dev script beside the app (a
// bench, a build script) changes none. When the graph cannot be read in full, because a reached file imports
// something that is neither a file of the repository nor a dependency (a tsconfig path alias, a virtual module), every
// script of a UI package counts, so an unread import never skips a browser check.

import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, normalize } from "node:path";
import { $ } from "bun";

export const TEST_FILE = /(\.(test|spec)\.|(^|\/)(e2e|__tests__|tests?)\/)/;
const UI_FILE = /\.(tsx|jsx|vue|svelte|css|scss|html)$/;
const SCRIPT_FILE = /\.(ts|js|mjs)$/;
/** The files whose imports the graph follows; a stylesheet's own imports are styles, already UI. */
const SOURCE_FILE = /\.(tsx?|jsx?|mjs|cjs|mts|cts|vue|svelte)$/;
const COMPONENT_FILE = /\.(tsx|jsx|vue|svelte)$/;
const UI_FRAMEWORKS = ["react", "vue", "svelte", "solid-js", "preact", "@angular/core"];
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts", ".vue", ".svelte"];
const INDEXES = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
/** `from "x"`, `import "x"`, `import("x")`, `require("x")`. A match inside a comment only adds an edge: safe. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/g;

type Package = { dir: string; ui: boolean; deps: Set<string> };

const packages = new Map<string, Package>();
const reaches = new Map<string, Set<string> | undefined>();
let repoFiles: Set<string> | undefined;

export async function isUiFile(root: string, path: string): Promise<boolean> {
  if (UI_FILE.test(path)) return true;
  if (!SCRIPT_FILE.test(path)) return false;
  const pkg = await packageOf(root, path);
  if (!pkg.ui) return false;
  const reached = await uiReach(root, pkg);
  return reached === undefined || reached.has(path);
}

async function packageOf(root: string, path: string): Promise<Package> {
  for (let dir = path.split("/").slice(0, -1); ; dir.pop()) {
    const key = dir.join("/");
    const known = packages.get(key);
    if (known) return known;
    const manifest = Bun.file(join(root, key, "package.json"));
    if (await manifest.exists()) {
      const { dependencies = {}, devDependencies = {}, peerDependencies = {} } = await manifest.json();
      const deps = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies), ...Object.keys(peerDependencies)]);
      const pkg = { dir: key, ui: UI_FRAMEWORKS.some((name) => deps.has(name)), deps };
      packages.set(key, pkg);
      return pkg;
    }
    if (dir.length === 0) return { dir: "", ui: false, deps: new Set() };
  }
}

// Every file a non-test component of the package reaches, components included; undefined when an import cannot be
// placed. Files are the repository's, tracked or untracked, without ignored ones, so a fix not yet committed counts.
async function uiReach(root: string, pkg: Package): Promise<Set<string> | undefined> {
  if (reaches.has(pkg.dir)) return reaches.get(pkg.dir);
  repoFiles ??= new Set(
    (await $`git ls-files -z --cached --others --exclude-standard`.cwd(root).text()).split("\0").filter(Boolean),
  );
  const files = repoFiles;
  const inPackage = (path: string) => pkg.dir === "" || path.startsWith(`${pkg.dir}/`);
  const queue = [...files].filter((path) => inPackage(path) && COMPONENT_FILE.test(path) && !TEST_FILE.test(path));
  const reached = new Set(queue);
  let result: Set<string> | undefined = reached;
  while (queue.length > 0 && result) {
    const from = queue.pop() as string;
    for (const [, specifier] of readFileSync(join(root, from), "utf8").matchAll(SPECIFIER)) {
      const target = resolveImport(from, specifier, files, (await packageOf(root, from)).deps);
      if (target === "external") continue;
      if (target === undefined) {
        result = undefined;
        break;
      }
      if (reached.has(target)) continue;
      reached.add(target);
      if (SOURCE_FILE.test(target)) queue.push(target);
    }
  }
  reaches.set(pkg.dir, result);
  return result;
}

/**
 * The repository file `specifier` names when imported from `from`, "external" for a dependency or a runtime module,
 * undefined when it is neither. A `.js` specifier also finds its `.ts` source (TypeScript's ESM convention).
 */
export function resolveImport(
  from: string,
  specifier: string,
  files: ReadonlySet<string>,
  deps: ReadonlySet<string>,
): string | "external" | undefined {
  const bare = specifier.split("?")[0];
  if (bare.startsWith("./") || bare.startsWith("../") || bare === "." || bare === "..") {
    const base = normalize(join(dirname(from), bare));
    const stems = [base, base.replace(/\.(m|c)?jsx?$/, "")];
    for (const stem of stems) {
      for (const ending of [...EXTENSIONS, ...INDEXES]) if (files.has(stem + ending)) return stem + ending;
    }
    return undefined;
  }
  const name = bare.startsWith("@") ? bare.split("/").slice(0, 2).join("/") : bare.split("/")[0];
  if (deps.has(name) || bare.startsWith("node:") || bare.startsWith("bun:") || name === "bun") return "external";
  if (builtinModules.includes(name)) return "external";
  return undefined;
}
