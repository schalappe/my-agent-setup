import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { resolveImport } from "./ui";

// isUiFile caches per process, so each repository shape runs in its own process.
async function uiFiles(tree: Record<string, string>, paths: string[]): Promise<Record<string, boolean>> {
  const root = mkdtempSync(join(tmpdir(), "ui-test-"));
  try {
    for (const [path, text] of Object.entries(tree)) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    await $`git init -q`.cwd(root);
    const script = `import { isUiFile } from ${JSON.stringify(join(import.meta.dir, "ui.ts"))};
const out = {};
for (const path of ${JSON.stringify(paths)}) out[path] = await isUiFile(${JSON.stringify(root)}, path);
console.log(JSON.stringify(out));`;
    return JSON.parse(await $`bun -e ${script}`.cwd(root).text());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const reactApp = {
  "package.json": JSON.stringify({ dependencies: { react: "19" } }),
  "src/webview/App.tsx": 'import { useThing } from "../core/thing.js";\nimport "./app.css";\nimport React from "react";',
  "src/webview/app.css": "",
  "src/core/thing.ts": 'export * from "./deep";',
  "src/core/deep/index.ts": 'import { readFile } from "node:fs";',
  "src/extension/host.ts": 'import * as vscode from "vscode";',
  "eval/bench.ts": 'import { thing } from "../src/core/thing";',
  "src/webview/App.test.tsx": 'import { helper } from "../../test/helper";',
  "test/helper.ts": "",
};

test("a script a component reaches counts as UI; a dev script beside the app does not", async () => {
  expect(
    await uiFiles(reactApp, ["src/core/thing.ts", "src/core/deep/index.ts", "eval/bench.ts", "src/extension/host.ts"]),
  ).toEqual({
    "src/core/thing.ts": true,
    "src/core/deep/index.ts": true,
    "eval/bench.ts": false,
    "src/extension/host.ts": false,
  });
});

test("an import the graph cannot place makes every script of the UI package count", async () => {
  const aliased = { ...reactApp, "src/webview/App.tsx": 'import { useThing } from "@/core/thing";' };
  expect(await uiFiles(aliased, ["eval/bench.ts", "src/extension/host.ts"])).toEqual({
    "eval/bench.ts": true,
    "src/extension/host.ts": true,
  });
});

test("components and styles always count; scripts outside a UI package never do", async () => {
  const cli = { "package.json": JSON.stringify({ dependencies: { zod: "4" } }), "src/cli.ts": "" };
  expect(await uiFiles(cli, ["src/cli.ts", "src/page.tsx", "src/site.css"])).toEqual({
    "src/cli.ts": false,
    "src/page.tsx": true,
    "src/site.css": true,
  });
});

test("resolveImport tells repository files, dependencies, and unknown specifiers apart", () => {
  const files = new Set(["src/a.ts", "src/b/index.tsx", "src/c.ts"]);
  const deps = new Set(["react", "@scope/pkg"]);
  expect(resolveImport("src/x.tsx", "./a", files, deps)).toBe("src/a.ts");
  expect(resolveImport("src/x.tsx", "./c.js", files, deps)).toBe("src/c.ts");
  expect(resolveImport("src/x.tsx", "./b", files, deps)).toBe("src/b/index.tsx");
  expect(resolveImport("src/x.tsx", "./a?raw", files, deps)).toBe("src/a.ts");
  expect(resolveImport("src/x.tsx", "react-dom/client", files, deps)).toBeUndefined();
  expect(resolveImport("src/x.tsx", "react/jsx-runtime", files, deps)).toBe("external");
  expect(resolveImport("src/x.tsx", "@scope/pkg/sub", files, deps)).toBe("external");
  expect(resolveImport("src/x.tsx", "node:path", files, deps)).toBe("external");
  expect(resolveImport("src/x.tsx", "path", files, deps)).toBe("external");
  expect(resolveImport("src/x.tsx", "@/lib/x", files, deps)).toBeUndefined();
  expect(resolveImport("src/x.tsx", "./missing", files, deps)).toBeUndefined();
});
