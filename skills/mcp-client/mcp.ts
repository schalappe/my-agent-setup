#!/usr/bin/env bun
/**
 * Minimal MCP stdio client driven by .mcp.json.
 *
 * Usage:
 *   mcp.ts servers                          List servers from .mcp.json
 *   mcp.ts tools <server>                   List tools of a server
 *   mcp.ts call <server> <tool> [json]     Call a tool with JSON arguments
 *
 * Config resolution: $MCP_CONFIG, else .mcp.json from cwd upward.
 * Timeout: $MCP_TIMEOUT seconds (default 60).
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

interface ServerCfg {
  type?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

const TIMEOUT_MS = Number(process.env.MCP_TIMEOUT ?? 60) * 1000;

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function findConfig(): string {
  if (process.env.MCP_CONFIG) return process.env.MCP_CONFIG;
  let dir = process.cwd();
  for (;;) {
    const p = join(dir, ".mcp.json");
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) fail("no .mcp.json found from cwd upward (or set MCP_CONFIG)");
    dir = parent;
  }
}

function loadServers(): Record<string, ServerCfg> {
  const path = findConfig();
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const servers = raw.mcpServers ?? raw.servers;
  if (!servers) fail(`${path} has no "mcpServers" key`);
  return servers;
}

function getServer(name: string): ServerCfg {
  const servers = loadServers();
  const cfg = servers[name];
  if (!cfg) fail(`server "${name}" not found; available: ${Object.keys(servers).join(", ")}`);
  if (cfg.type && cfg.type !== "stdio") fail(`server "${name}" has type "${cfg.type}"; only stdio is supported`);
  return cfg;
}

/** Spawn server, run handshake, execute one request, return its result. */
async function request(cfg: ServerCfg, method: string, params?: unknown): Promise<any> {
  const proc = Bun.spawn([cfg.command, ...(cfg.args ?? [])], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...(cfg.env ?? {}) },
  });

  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + "\n");
  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    });

  // read stdout lines, skip non-JSON noise
  (async () => {
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += new TextDecoder().decode(chunk);
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const p = msg.id !== undefined ? pending.get(msg.id) : undefined;
        if (!p) continue;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg.result);
      }
    }
  })();

  const stderrChunks: string[] = [];
  (async () => {
    for await (const chunk of proc.stderr) stderrChunks.push(new TextDecoder().decode(chunk));
  })();

  const timer = setTimeout(() => {
    proc.kill();
    const err = stderrChunks.join("").trim();
    fail(`timeout after ${TIMEOUT_MS / 1000}s${err ? `\nserver stderr:\n${err}` : ""}`);
  }, TIMEOUT_MS);

  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-mcp-client", version: "1.0" },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return await request_(method, params, rpc);
  } finally {
    clearTimeout(timer);
    proc.kill();
  }
}

async function request_(method: string, params: unknown, rpc: (m: string, p?: unknown) => Promise<any>) {
  return rpc(method, params);
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function printContent(result: any) {
  let imageDirectory: string | undefined;
  let imageIndex = 0;

  if (result.isError) console.error("tool returned an error:");
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      console.log(block.text);
    } else if (block.type === "image" && typeof block.data === "string") {
      imageDirectory ??= mkdtempSync(join(tmpdir(), "pi-mcp-images-"));
      const extension = IMAGE_EXTENSIONS[block.mimeType] ?? "bin";
      const path = join(imageDirectory, `image-${++imageIndex}.${extension}`);
      writeFileSync(path, Buffer.from(block.data, "base64"));
      console.log(`[image ${block.mimeType}] ${path}`);
    } else {
      console.log(JSON.stringify(block, null, 2));
    }
  }
  if (result.structuredContent) console.log(JSON.stringify(result.structuredContent, null, 2));
  if (result.isError) process.exit(1);
}

const [cmd, serverName, toolName, argsJson] = process.argv.slice(2);

switch (cmd) {
  case "servers": {
    const servers = loadServers();
    for (const [name, cfg] of Object.entries(servers)) {
      console.log(`${name}: ${cfg.command} ${(cfg.args ?? []).join(" ")}`);
    }
    break;
  }
  case "tools": {
    if (!serverName) fail("usage: mcp.ts tools <server>");
    const result = await request(getServer(serverName), "tools/list");
    for (const t of result.tools ?? []) {
      console.log(`## ${t.name}`);
      if (t.description) console.log(t.description);
      console.log(`input schema: ${JSON.stringify(t.inputSchema)}`);
      console.log();
    }
    break;
  }
  case "call": {
    if (!serverName || !toolName) fail('usage: mcp.ts call <server> <tool> [\'{"json":"args"}\']');
    let args: unknown = {};
    if (argsJson) {
      try {
        args = JSON.parse(argsJson);
      } catch {
        fail("arguments must be valid JSON");
      }
    }
    const result = await request(getServer(serverName), "tools/call", { name: toolName, arguments: args });
    printContent(result);
    break;
  }
  default:
    console.log("usage: mcp.ts servers | tools <server> | call <server> <tool> [json-args]");
    process.exit(cmd ? 1 : 0);
}
