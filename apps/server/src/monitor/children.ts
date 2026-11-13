import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * External programs this process runs right now (ffmpeg, LibreOffice, Poppler…), for the
 * process table of the Server page: their CPU and memory are not in the Node process's own.
 * A job names what it works on with `withToolLabel`; every tool it starts carries that name.
 */

export interface BeatChild {
  /** The program: `ffmpeg`, `LibreOffice`… */
  tool: string;
  /** The file's display name and what is made of it (`clip.mov · 1080p`); never a path. */
  label: string | null;
  startedAt: number;
  /** Cores, and resident bytes, of the program and its own children; null without /proc. */
  cpu: number | null;
  memory: number | null;
}

interface Running {
  pid: number;
  tool: string;
  label: string | null;
  startedAt: number;
}

const labels = new AsyncLocalStorage<string[]>();
const running = new Map<number, Running>();

// shortcut: a file name past 80 characters is cut; the table has no room for more.
const short = (part: string) => (part.length > 80 ? `${part.slice(0, 79)}…` : part);

/** Runs `fn` with `part` added to the label of the tools it starts (a file name, a rung). */
export function withToolLabel<T>(part: string | null | undefined, fn: () => T): T {
  const name = part?.trim();
  if (!name) return fn();
  return labels.run([...(labels.getStore() ?? []), short(name)], fn);
}

/**
 * Lists `child` among the running tools until it exits. `tool` is the program, not prlimit;
 * `parts` the label, by default the one of `withToolLabel`.
 */
export function trackTool(
  child: { pid?: number | undefined; once(event: 'exit' | 'error', fn: () => void): unknown },
  tool: string,
  parts = labels.getStore(),
) {
  const pid = child.pid;
  if (!pid) return;
  running.set(pid, {
    pid,
    tool: basename(tool).replace(/\.exe$/i, ''),
    label: parts?.length ? parts.map(short).join(' · ') : null,
    startedAt: Date.now(),
  });
  child.once('exit', () => running.delete(pid));
  child.once('error', () => running.delete(pid));
}

/** CPU ticks (user + system) and parent of a `/proc/<pid>/stat` line. */
export function parseStat(text: string): { ticks: number; ppid: number } | null {
  // The command name may hold spaces and parentheses: the fields start after the last `)`.
  const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
  // Fields 4, 14 and 15 of proc(5), counted from the state (field 3).
  const ppid = Number(fields[1]);
  const ticks = Number(fields[11]) + Number(fields[12]);
  return Number.isFinite(ticks) && Number.isFinite(ppid) ? { ticks, ppid } : null;
}

/** Resident bytes of a `/proc/<pid>/status` file. */
export function parseRss(text: string): number | null {
  const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(text);
  return m ? Number(m[1]) * 1024 : null;
}

// shortcut: USER_HZ is 100 on every Linux build Inkadra ships for (amd64, arm64); Node can't read sysconf.
const TICKS_PER_SECOND = 100;

/** Ticks and bytes of `pid` and of its descendants (bubblewrap forks LibreOffice). */
async function readTree(proc: string, pid: number, depth = 0): Promise<[number, number] | null> {
  try {
    const [stat, status] = await Promise.all([
      readFile(`${proc}/${pid}/stat`, 'utf8'),
      readFile(`${proc}/${pid}/status`, 'utf8'),
    ]);
    let ticks = parseStat(stat)?.ticks ?? 0;
    let bytes = parseRss(status) ?? 0;
    // shortcut: only the children of the main thread are followed; the tools fork from it.
    const kids = await readFile(`${proc}/${pid}/task/${pid}/children`, 'utf8').catch(() => '');
    if (depth < 8)
      for (const kid of kids.split(' ').filter(Boolean)) {
        const sub = await readTree(proc, Number(kid), depth + 1);
        if (sub) {
          ticks += sub[0];
          bytes += sub[1];
        }
      }
    return [ticks, bytes];
  } catch {
    return null;
  }
}

/** Samples the running tools: CPU since the previous sample, or since the tool started. */
export class ChildSampler {
  private last = new Map<number, { ticks: number; at: number }>();
  constructor(private proc = '/proc') {}

  async sample(now = Date.now(), list: Running[] = [...running.values()]): Promise<BeatChild[]> {
    const out: BeatChild[] = [];
    const seen = new Map<number, { ticks: number; at: number }>();
    for (const c of list) {
      const tree = await readTree(this.proc, c.pid);
      let cpu: number | null = null;
      if (tree) {
        const before = this.last.get(c.pid) ?? { ticks: 0, at: c.startedAt };
        const seconds = (now - before.at) / 1000;
        cpu = seconds > 0 ? Math.max(0, (tree[0] - before.ticks) / TICKS_PER_SECOND / seconds) : 0;
        seen.set(c.pid, { ticks: tree[0], at: now });
      }
      out.push({
        tool: c.tool,
        label: c.label,
        startedAt: c.startedAt,
        cpu,
        memory: tree ? tree[1] : null,
      });
    }
    this.last = seen;
    return out;
  }
}
