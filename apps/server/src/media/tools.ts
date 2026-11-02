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
  /** Reads the JPEG previews and EXIF of camera RAW files. */
  exiftool: string | null;
  /** Poppler: renders page 1 of PDFs, and reads their page count. */
  pdftoppm: string | null;
  pdfinfo: string | null;
  /** `prlimit` (util-linux), to cap the memory of the others; null where there is none. */
  prlimit: string | null;
  /** `nice` (coreutils), so a long transcode yields the CPU to the web role. */
  nice: string | null;
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
    const linux = process.platform === 'linux';
    const [ffmpeg, ffprobe, exiftool, pdftoppm, pdfinfo, prlimit, nice] = await Promise.all([
      find('FFMPEG_PATH', 'ffmpeg', ['-version']),
      find('FFPROBE_PATH', 'ffprobe', ['-version']),
      find('EXIFTOOL_PATH', 'exiftool', ['-ver']),
      find('PDFTOPPM_PATH', 'pdftoppm', ['-v']),
      find('PDFINFO_PATH', 'pdfinfo', ['-v']),
      linux ? find('PRLIMIT_PATH', 'prlimit', ['--version']) : null,
      linux ? find('NICE_PATH', 'nice', ['--version']) : null,
    ]);
    return { ffmpeg, ffprobe, exiftool, pdftoppm, pdfinfo, prlimit, nice };
  })();
  return tools;
}

/** Tests only. */
export function resetMediaTools() {
  tools = undefined;
}

/** Caps a tool runs under, where prlimit and nice exist (Linux, the `-media` image). */
export interface ProcessLimits {
  /** Address space of the process: a decoder bomb fails instead of eating the RAM. */
  memoryBytes?: number;
  /** Largest file the process may write (`--fsize`): it is killed past it. */
  fileBytes?: number;
  /** Most tasks (`--nproc`) the user may have: a fork bomb in the tool fails instead of the host. */
  processes?: number;
  /** Runs at `nice -n 10`, below the web role. */
  nice?: boolean;
}

export interface RunLimits extends ProcessLimits {
  /** Killed past this. */
  timeoutMs: number;
  /** Largest stdout kept; past it the run fails. */
  maxBuffer?: number;
  /** Written to the standard input of the tool (bwrap reads its seccomp filter from fd 0). */
  input?: Buffer;
}

/** The environment of a tool: no variables of the server (secrets, proxies) reach it. */
export function toolEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
}

/** `bin args` under prlimit and nice, as `limits` asks and the system allows. */
export async function limitedCommand(
  bin: string,
  args: string[],
  limits: ProcessLimits = {},
): Promise<[string, string[]]> {
  const { prlimit, nice } = await mediaTools();
  let command: [string, string[]] = [bin, args];
  if (limits.nice && nice) command = [nice, ['-n', '10', ...command.flat()]];
  const caps = [
    ...(limits.memoryBytes ? [`--as=${Math.floor(limits.memoryBytes)}`] : []),
    ...(limits.fileBytes ? [`--fsize=${Math.floor(limits.fileBytes)}`] : []),
    ...(limits.processes ? [`--nproc=${Math.floor(limits.processes)}`] : []),
  ];
  if (prlimit && caps.length > 0) command = [prlimit, [...caps, '--', ...command.flat()]];
  return command;
}

/**
 * Runs a media tool with a time limit and, on Linux, a memory limit. Arguments are passed as
 * a list, never through a shell. stdout comes back as bytes: embedded previews are binary.
 */
export async function runTool(bin: string, args: string[], limits: RunLimits) {
  const [file, argv] = await limitedCommand(bin, args, limits);
  const run = exec(file, argv, {
    timeout: limits.timeoutMs,
    maxBuffer: limits.maxBuffer ?? 1024 * 1024,
    encoding: 'buffer',
    killSignal: 'SIGKILL',
    env: toolEnv(),
  });
  if (limits.input) {
    run.child.stdin?.on('error', () => {});
    run.child.stdin?.end(limits.input);
  }
  return (await run).stdout;
}
