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
 * Protocol: 2026-07-28 (per-request _meta) with a fallback to the 2025-11-25 initialize handshake for
 * servers that reject `server/discover` or stay silent for $MCP_PROBE_TIMEOUT seconds (default 10).
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
const PROBE_MS = Number(process.env.MCP_PROBE_TIMEOUT ?? 10) * 1000;

const MODERN_VERSION = "2026-07-28";
// Last revision with the initialize handshake; an older legacy server answers with its own version.
const LEGACY_VERSION = "2025-11-25";
const UNSUPPORTED_PROTOCOL_VERSION = -32022;
const CLIENT_INFO = { name: "mcp-client", version: "1.1" };

// 2026-07-28 has no handshake: every request carries its version and capabilities in _meta.
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
  "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
  "io.modelcontextprotocol/clientCapabilities": {},
};

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: any,
  ) {
    super(`${code}: ${message}`);
  }
}

type Rpc = (method: string, params?: unknown) => Promise<any>;

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
        if (msg.error) p.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data));
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
    let result: any;
    if (await isModern(rpc)) {
      result = await rpc(method, { ...(params ?? {}), _meta: MODERN_META });
    } else {
      await rpc("initialize", { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      result = await rpc(method, params);
    }
    // Results from legacy servers have no resultType, which the spec reads as "complete".
    const resultType = result?.resultType ?? "complete";
    if (resultType !== "complete") throw new Error(`server answered with resultType "${resultType}"; only complete results are supported`);
    return result;
  } catch (error) {
    proc.kill();
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    proc.kill();
  }
}

/**
 * Era detection from the stdio binding: a server/discover result or a recognized modern error means a modern
 * server; any other error or no answer within PROBE_MS means a legacy one. A modern server that lacks
 * MODERN_VERSION throws, never falls back.
 */
async function isModern(rpc: Rpc): Promise<boolean> {
  let discovered: any;
  const silence = Promise.withResolvers<undefined>();
  const probeTimer = setTimeout(() => silence.resolve(undefined), PROBE_MS);
  try {
    discovered = await Promise.race([rpc("server/discover", { _meta: MODERN_META }), silence.promise]);
  } catch (error) {
    if (error instanceof RpcError && error.code === UNSUPPORTED_PROTOCOL_VERSION)
      throw new Error(`server supports ${JSON.stringify(error.data?.supported)}; this client speaks ${MODERN_VERSION} or ${LEGACY_VERSION}`);
    return false;
  } finally {
    clearTimeout(probeTimer); // a pending probe timer would keep the process alive until it fires
  }
  if (discovered === undefined) return false;
  if (!Array.isArray(discovered.supportedVersions) || !discovered.supportedVersions.includes(MODERN_VERSION))
    throw new Error(`server supports ${JSON.stringify(discovered.supportedVersions)}; this client speaks ${MODERN_VERSION} or ${LEGACY_VERSION}`);
  return true;
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
      imageDirectory ??= mkdtempSync(join(tmpdir(), "mcp-images-"));
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
