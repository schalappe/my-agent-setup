// Reads the JSONL trace of one headless peer run (see peer.ts) into the facts the skills act on: the files the agent
// opened, its final answer, how many tool calls it made, and whether it failed. Two engines write two formats, told
// apart by their event types:
//   claude  `claude -p --output-format stream-json`: `assistant` events with `tool_use` blocks, a final `result`.
//   codex   `codex exec --json`: `item.*` events (`command_execution`, `agent_message`), `turn.completed|failed`.
// A file counts as opened only through a whole-file read: claude's Read, or a codex shell command whose program
// prints files (cat, sed, nl, head, tail, …), its glob arguments matched as the shell would, or whose output holds a
// file's whole text (`printed`, checked by the gate against each patch). Codex has no read tool, so its evidence is the
// weaker.

export type Engine = "claude" | "codex";

export type Trace = {
  engine: Engine;
  opened: string[];
  // The output of each command that exited 0 (codex only): a file whose whole text appears in one was printed, however
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
  const events = parseEvents(jsonl);
  return engineOf(events) === "codex" ? readCodex(events) : readClaude(events);
}

function readClaude(events: Event[]): Trace {
  const toolUses = events.flatMap((event) =>
    isObject(event.message) && Array.isArray(event.message.content)
      ? event.message.content.filter((block) => isObject(block) && block.type === "tool_use")
      : [],
  );
  const opened = toolUses.flatMap((block) =>
    block.name === "Read" && isObject(block.input) && isString(block.input.file_path) ? [block.input.file_path] : [],
  );
  const result = events.findLast((event) => event.type === "result");
  const text = isString(result?.result) ? result.result : "";
  return {
    engine: "claude",
    opened,
    printed: [],
    text,
    output: result?.structured_output ?? parseJsonAnswer(text),
    toolCalls: toolUses.length,
    isError: !result || result.is_error === true,
  };
}

const READERS = new Set(["cat", "sed", "nl", "head", "tail", "bat", "awk", "less", "more"]);

// Splits a shell command line into words, honoring single and double quotes. Good enough for the read commands codex
// writes; anything it misparses only lowers the coverage the gate reports, never raises it falsely.
function words(command: string): string[] {
  return [...command.matchAll(/'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
}

// Codex wraps each command as `/bin/zsh -lc '<script>'`. The script's segments that run a file printer name the files
// they print as their non-option words.
function codexReads(command: string): string[] {
  const outer = words(command);
  const script = outer.length === 3 && outer[1] === "-lc" ? outer[2] : command;
  return script.split(/&&|\|\||[;|\n]/).flatMap((segment) => {
    const [program, ...args] = words(segment.trim());
    if (!program || !READERS.has(program.split("/").at(-1) ?? "")) return [];
    return args.filter((arg) => !arg.startsWith("-") && /[/.]/.test(arg) && !/^\d+(,\d+)?p$/.test(arg));
  });
}

function readCodex(events: Event[]): Trace {
  const items = events.flatMap((event) => (event.type === "item.completed" && isObject(event.item) ? [event.item] : []));
  const commands = items.filter((item) => item.type === "command_execution");
  const succeeded = commands.filter((item) => item.exit_code === 0);
  const opened = succeeded.flatMap((item) => (isString(item.command) ? codexReads(item.command) : []));
  const printed = succeeded.flatMap((item) => (isString(item.aggregated_output) ? [item.aggregated_output] : []));
  const answer = items.findLast((item) => item.type === "agent_message");
  const text = isString(answer?.text) ? answer.text : "";
  const failed = events.some((event) => event.type === "turn.failed" || event.type === "error");
  return {
    engine: "codex",
    opened,
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
