// Reads the JSONL trace of one headless peer run (see peer.ts) into the facts the skills act on: the files the agent
// opened, its final answer, how many tool calls it made, and whether it failed. peer.ts now runs only codex; the claude
// format stays readable because the gate re-checks every recorded round, and loops started before the fixed roles hold
// claude traces. The two formats are told apart by their event types:
//   claude  `claude -p --output-format stream-json`: `assistant` events with `tool_use` blocks, a final `result`.
//   codex   `codex exec --json`: `item.*` events (`command_execution`, `agent_message`), `turn.completed|failed`.
//   t3      `t3_thread_read(view: "activity")` of a reviewer run via delegate_task: one JSON object, or JSONL with one
//           page per line, each `{ thread, items }`. Its commands are read like codex's: the first line of an item's
//           text is the command, the rest its output. Its engine is the child thread's provider.
// A file counts as opened only through a whole-file read: claude's Read, or a codex shell command whose program
// prints files (cat, sed, nl, head, tail, …), its glob arguments matched as the shell would, or whose output holds a
// file's whole text (`printed`, checked by the gate against each patch). Codex has no read tool, so its evidence is the
// weaker. A read of a slice bundle (slice-<S>.patch, every patch of the slice in one file) opens every file of the
// slice, so it needs the strictest proof (openedBundle): a full print of its exact absolute path (`fullReads`) whose
// output holds every patch header of the slice.

export type Engine = "claude" | "codex";

// One whole-file print: the path as written and what the read returned (the command output, or the Read result).
export type FullRead = { path: string; output: string };

export type Trace = {
  engine: Engine;
  opened: string[];
  // Files printed whole, as written: claude's Read without offset or limit whose result is not an error, or a `cat`
  // that is neither piped nor redirected in a command that succeeded. A `head`, a `sed -n 1p`, or `cat x | head` reads
  // a part only. Each keeps its output, since a command can name a file it never printed (`true || cat x`).
  fullReads: FullRead[];
  // The output of each command that exited 0 (codex and t3 only): a file whose whole text appears in one was printed, however
  // the command named it (a glob, a loop, a pipe), which is stronger evidence than the command's words.
  printed: string[];
  text: string;
  output: unknown;
  toolCalls: number;
  isError: boolean;
};

type Event = Record<string, unknown>;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";

export function parseEvents(jsonl: string): Event[] {
  return jsonl
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return []; // a line cut by a crash or a stray log line; the missing final event reports the failure
      }
    })
    .filter(isObject);
}

export function engineOf(events: Event[]): Engine {
  const types = new Set(events.map((event) => event.type));
  return types.has("thread.started") || types.has("item.completed") ? "codex" : "claude";
}

// A final answer given as JSON, possibly inside a code fence. undefined when it is not JSON.
export function parseJsonAnswer(text: string): unknown {
  const fenced = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  try {
    return JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return undefined;
  }
}

export function readTrace(jsonl: string): Trace {
  const pages = t3Pages(jsonl);
  if (pages) return readT3(pages);
  const events = parseEvents(jsonl);
  return engineOf(events) === "codex" ? readCodex(events) : readClaude(events);
}

type T3Page = { thread: Record<string, unknown>; items: unknown[] };

const isT3Page = (value: unknown): value is T3Page =>
  isObject(value) && isObject(value.thread) && Array.isArray(value.items);

// The pages of a T3 activity dump, or undefined when the text is not one. A single object may be pretty-printed, so the
// whole text is tried before its lines.
function t3Pages(text: string): T3Page[] | undefined {
  try {
    const whole = JSON.parse(text) as unknown;
    return isT3Page(whole) ? [whole] : undefined;
  } catch {
    // not one JSON value: JSONL, read line by line below
  }
  const events = parseEvents(text);
  return events.length > 0 && events.every(isT3Page) ? events : undefined;
}

function readT3(pages: T3Page[]): Trace {
  // Pages may overlap; a repeated position keeps its latest copy, in the place it first appeared.
  const byPosition = new Map<unknown, Record<string, unknown>>();
  const unpositioned: Record<string, unknown>[] = [];
  for (const item of pages.flatMap((page) => page.items).filter(isObject)) {
    if (typeof item.position === "number") byPosition.set(item.position, item);
    else unpositioned.push(item);
  }
  const items = [...byPosition.values(), ...unpositioned];
  const commands = items.filter((item) => item.type === "command_execution" && isString(item.text));
  const succeeded = commands.filter((item) => item.status === "completed");
  const opened: string[] = [];
  const fullReads: FullRead[] = [];
  const printed: string[] = [];
  for (const item of succeeded) {
    const text = item.text as string;
    const newline = text.indexOf("\n");
    const firstLine = newline === -1 ? text : text.slice(0, newline);
    const output = newline === -1 ? "" : text.slice(newline + 1);
    const command = firstLine.startsWith("$ ") ? firstLine.slice(2) : firstLine;
    opened.push(...codexReads(command));
    fullReads.push(...codexFullReads(command).map((path) => ({ path, output })));
    if (output) printed.push(output);
  }
  const answer = items.findLast(
    (item) => item.type === "assistant_message" && item.status === "completed" && isString(item.text),
  );
  const text = isString(answer?.text) ? answer.text : "";
  const lastThread = pages[pages.length - 1].thread;
  return {
    engine: lastThread.providerInstanceId === "claudeAgent" ? "claude" : "codex",
    opened,
    fullReads,
    printed,
    text,
    output: parseJsonAnswer(text),
    toolCalls: commands.length,
    isError: lastThread.status !== "completed",
  };
}

function readClaude(events: Event[]): Trace {
  const toolUses = events.flatMap((event) =>
    isObject(event.message) && Array.isArray(event.message.content)
      ? event.message.content.filter((block) => isObject(block) && block.type === "tool_use")
      : [],
  );
  const reads = toolUses.filter(
    (block) => block.name === "Read" && isObject(block.input) && isString(block.input.file_path),
  ) as { id?: unknown; input: Record<string, unknown> }[];
  const opened = reads.map((block) => block.input.file_path as string);
  const results = toolResults(events);
  const fullReads = reads.flatMap((block) => {
    const result = results.get(block.id);
    if (!result || result.isError || block.input.offset !== undefined || block.input.limit !== undefined) return [];
    return [{ path: block.input.file_path as string, output: result.text }];
  });
  const result = events.findLast((event) => event.type === "result");
  const text = isString(result?.result) ? result.result : "";
  return {
    engine: "claude",
    opened,
    fullReads,
    printed: [],
    text,
    output: result?.structured_output ?? parseJsonAnswer(text),
    toolCalls: toolUses.length,
    isError: !result || result.is_error === true,
  };
}

// Each claude tool result by the id of its tool_use, with its text content joined.
function toolResults(events: Event[]): Map<unknown, { isError: boolean; text: string }> {
  const blocks = events.flatMap((event) =>
    isObject(event.message) && Array.isArray(event.message.content)
      ? event.message.content.filter((block) => isObject(block) && block.type === "tool_result")
      : [],
  );
  return new Map(
    blocks.map((block) => {
      const content = Array.isArray(block.content)
        ? block.content.map((part: unknown) => (isObject(part) && isString(part.text) ? part.text : "")).join("\n")
        : isString(block.content)
          ? block.content
          : "";
      return [block.tool_use_id, { isError: block.is_error === true, text: content }];
    }),
  );
}

const READERS = new Set(["cat", "sed", "nl", "head", "tail", "bat", "awk", "less", "more"]);

// Splits a shell command line into words, honoring single and double quotes. Good enough for the read commands codex
// writes; anything it misparses only lowers the coverage the gate reports, never raises it falsely.
function words(command: string): string[] {
  return [...command.matchAll(/'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
}

// Codex wraps each command as `/bin/zsh -lc '<script>'`; this returns the script inside.
function scriptOf(command: string): string {
  const outer = words(command);
  return outer.length === 3 && outer[1] === "-lc" ? outer[2] : command;
}

// The script's segments that run a file printer name the files they print as their non-option words.
function codexReads(command: string): string[] {
  return scriptOf(command).split(/&&|\|\||[;|\n]/).flatMap((segment) => {
    const [program, ...args] = words(segment.trim());
    if (!program || !READERS.has(program.split("/").at(-1) ?? "")) return [];
    return args.filter((arg) => !arg.startsWith("-") && /[/.]/.test(arg) && !/^\d+(,\d+)?p$/.test(arg));
  });
}

// The files a script prints whole: the non-option words of a `cat` whose output reaches the trace untouched, so a
// pipeline (`cat x | head`) or a redirection (`cat x > y`) prints nothing whole. Paths stay as written: a relative one
// depends on a `cd` the gate cannot follow.
function codexFullReads(command: string): string[] {
  return scriptOf(command).split(/&&|\|\||[;\n]/).flatMap((pipeline) => {
    if (/[|<>]/.test(pipeline)) return [];
    const [program, ...args] = words(pipeline.trim());
    if (program?.split("/").at(-1) !== "cat") return [];
    return args.filter((arg) => !arg.startsWith("-"));
  });
}

function readCodex(events: Event[]): Trace {
  const items = events.flatMap((event) => (event.type === "item.completed" && isObject(event.item) ? [event.item] : []));
  const commands = items.filter((item) => item.type === "command_execution");
  const succeeded = commands.filter((item) => item.exit_code === 0);
  const opened = succeeded.flatMap((item) => (isString(item.command) ? codexReads(item.command) : []));
  const fullReads = succeeded.flatMap((item) =>
    isString(item.command)
      ? codexFullReads(item.command).map((path) => ({ path, output: isString(item.aggregated_output) ? item.aggregated_output : "" }))
      : [],
  );
  const printed = succeeded.flatMap((item) => (isString(item.aggregated_output) ? [item.aggregated_output] : []));
  const answer = items.findLast((item) => item.type === "agent_message");
  const text = isString(answer?.text) ? answer.text : "";
  const failed = events.some((event) => event.type === "turn.failed" || event.type === "error");
  return {
    engine: "codex",
    opened,
    fullReads,
    printed,
    text,
    output: parseJsonAnswer(text),
    toolCalls: commands.length,
    isError: failed || !events.some((event) => event.type === "turn.completed"),
  };
}

// Whether a command printed `text` whole. An empty text proves nothing, since every output holds it.
export const printedText = (printed: string[], text: string): boolean =>
  text !== "" && printed.some((output) => output.includes(text));

// Whether the trace opened `path`: an absolute path read as is, or a repo-relative one read from the worktree. A read
// argument holding a wildcard (`cat patches/*.patch`) is the shell's glob, recorded as written: it opened every path it
// matches, a `*` staying within one folder. A command that exited 0 had its glob expand, so the match is a real read.
export const openedFile = (opened: string[], path: string): boolean =>
  opened.some((file) =>
    /[*?[]/.test(file) ? new Bun.Glob(file).match(path) : file === path || file.endsWith(`/${path}`),
  );

// The line that opens each patch in a slice bundle; gate.ts writes it, openedBundle looks for it.
export const patchHeader = (path: string): string => `=== PATCH: ${path} ===`;

// Whether the trace printed the slice bundle `bundle` (an absolute path) whole, naming that exact path, and the read
// returned the header of every patch of the slice (`paths`). The bundle holds every patch of its slice, so this one
// read opens them all, and nothing weaker counts: a partial print (`head`, `sed -n 1p`), a glob, a relative path, whose
// directory hangs on a `cd` the trace cannot prove, or a read whose output lacks a header (`true || cat x` prints
// nothing, a cut output loses the later patches, a missing file prints none).
export const openedBundle = (fullReads: FullRead[], bundle: string, paths: string[]): boolean =>
  fullReads.some((read) => read.path === bundle && paths.every((path) => read.output.includes(patchHeader(path))));
