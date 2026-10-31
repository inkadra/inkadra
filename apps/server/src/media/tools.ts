import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * External programs the worker runs on untrusted uploads. None is in the default image: the
 * `-media` variant adds them (decisions 0010 and 0048). Each is looked up once, on the PATH or
 * in its `*_PATH` variable; a missing one only turns its previews off.
 */
export interface MediaTools {
  ffmpeg: string | null;
  ffprobe: string | null;
  /** `prlimit` (util-linux), to cap the memory of the others; null where there is none. */
  prlimit: string | null;
}

let tools: Promise<MediaTools> | undefined;

/** True when `bin` starts and exits 0 with `args`. */
async function works(bin: string, args: string[]): Promise<boolean> {
  try {
    await exec(bin, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function find(variable: string, name: string, args: string[]) {
  const bin = process.env[variable] || name;
  return (await works(bin, args)) ? bin : null;
}

export function mediaTools(): Promise<MediaTools> {
  tools ??= (async () => {
    const [ffmpeg, ffprobe, prlimit] = await Promise.all([
      find('FFMPEG_PATH', 'ffmpeg', ['-version']),
      find('FFPROBE_PATH', 'ffprobe', ['-version']),
      process.platform === 'linux' ? find('PRLIMIT_PATH', 'prlimit', ['--version']) : null,
    ]);
    return { ffmpeg, ffprobe, prlimit };
  })();
  return tools;
}

/** Tests only. */
export function resetMediaTools() {
  tools = undefined;
}

export interface RunLimits {
  /** Killed past this. */
  timeoutMs: number;
  /** Address space of the process, when prlimit is there; a decoder bomb fails instead. */
  memoryBytes?: number;
  /** Largest stdout kept; past it the run fails. */
  maxBuffer?: number;
}

/** The environment of a tool: no variables of the server (secrets, proxies) reach it. */
export function toolEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
}

/** `bin args`, behind prlimit when there is one and a memory cap is asked for. */
export async function limitedCommand(
  bin: string,
  args: string[],
  memoryBytes?: number,
): Promise<[string, string[]]> {
  const { prlimit } = await mediaTools();
  return prlimit && memoryBytes
    ? [prlimit, [`--as=${memoryBytes}`, '--', bin, ...args]]
    : [bin, args];
}

/**
 * Runs a media tool with a time limit and, on Linux, a memory limit. Arguments are passed as
 * a list, never through a shell. stdout comes back as bytes: embedded previews are binary.
 */
export async function runTool(bin: string, args: string[], limits: RunLimits) {
  const [file, argv] = await limitedCommand(bin, args, limits.memoryBytes);
  const { stdout } = await exec(file, argv, {
    timeout: limits.timeoutMs,
    maxBuffer: limits.maxBuffer ?? 1024 * 1024,
    encoding: 'buffer',
    killSignal: 'SIGKILL',
    env: toolEnv(),
  });
  return stdout;
}
