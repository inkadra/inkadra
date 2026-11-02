// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The seccomp-bpf filter of the Office sandbox, in the form bubblewrap loads with `--seccomp`.
 * Everything is allowed except what LibreOffice never needs and an escape would: io_uring,
 * the kernel keyring, ptrace and cross-process memory access, mounting, re-entering
 * namespaces, eBPF, perf events and userfaultfd. A denied call fails with EPERM. The 32-bit
 * and x32 entry points of the same kernel are refused outright, so no number can be reached
 * through another table. Only x86-64 and arm64 (the architectures of the image) have a filter;
 * elsewhere there is none and conversion stays off.
 */
const AUDIT_ARCH = { x64: 0xc000003e, arm64: 0xc00000b7 } as const;
const DENIED: Record<keyof typeof AUDIT_ARCH, number[]> = {
  // ptrace, process_vm_readv/writev, mount, umount2, pivot_root, unshare, setns, add_key,
  // request_key, keyctl, bpf, perf_event_open, userfaultfd; the rest are shared numbers below.
  x64: [101, 310, 311, 165, 166, 155, 272, 308, 248, 249, 250, 321, 298, 323],
  arm64: [117, 270, 271, 40, 39, 41, 97, 268, 217, 218, 219, 280, 241, 282],
};
// io_uring_setup/enter/register, open_tree, move_mount, fsopen, fsconfig, fsmount, fspick,
// mount_setattr: the same on both architectures.
const SHARED = [425, 426, 427, 428, 429, 430, 431, 432, 433, 442];

const ALLOW = 0x7fff0000;
const EPERM_RETURN = 0x00050000 | 1;
const ENOSYS_RETURN = 0x00050000 | 38;
const KILL = 0x80000000;
const X32 = 0x40000000;
const CLONE_NEWUSER = 0x10000000;
const CLONE = { x64: 56, arm64: 220 } as const;
const CLONE3 = 435;

type Ins = [code: number, jt: string | number, jf: string | number, k: number];

/**
 * The filter for `arch`, or null where there is none. Besides the list above it keeps the
 * sandbox from creating user namespaces another way, for hosts where bubblewrap's own
 * `--disable-userns` cannot run: `clone` with CLONE_NEWUSER fails, and `clone3` (whose flags
 * sit behind a pointer a filter cannot read) answers ENOSYS, so libc falls back to `clone`.
 */
export function officeSeccomp(arch: string = process.arch): Buffer | null {
  if (arch !== 'x64' && arch !== 'arm64') return null;
  const LOAD = 0x20; // BPF_LD | BPF_W | BPF_ABS
  const JEQ = 0x15; // BPF_JMP | BPF_JEQ | BPF_K
  const JGE = 0x35; // BPF_JMP | BPF_JGE | BPF_K
  const JSET = 0x45; // BPF_JMP | BPF_JSET | BPF_K
  const RET = 0x06; // BPF_RET | BPF_K
  const code: Array<Ins | string> = [
    [LOAD, 0, 0, 4], // architecture
    [JEQ, 'ok-arch', 0, AUDIT_ARCH[arch]],
    [RET, 0, 0, KILL],
    'ok-arch',
    [LOAD, 0, 0, 0], // system call number
    // x32 calls are the same numbers plus a flag: anything that high is refused.
    ...(arch === 'x64' ? ([[JGE, 'deny', 0, X32]] as Ins[]) : []),
    ...[...DENIED[arch], ...SHARED].map((n): Ins => [JEQ, 'deny', 0, n]),
    [JEQ, 'clone', 0, CLONE[arch]],
    [JEQ, 'enosys', 0, CLONE3],
    [RET, 0, 0, ALLOW],
    'clone',
    [LOAD, 0, 0, 16], // flags: low word of the first argument
    [JSET, 'deny', 0, CLONE_NEWUSER],
    [RET, 0, 0, ALLOW],
    'enosys',
    [RET, 0, 0, ENOSYS_RETURN],
    'deny',
    [RET, 0, 0, EPERM_RETURN],
  ];
  const labels = new Map<string, number>();
  const program: Ins[] = [];
  for (const item of code) {
    if (typeof item === 'string') labels.set(item, program.length);
    else program.push(item);
  }
  const out = Buffer.alloc(program.length * 8);
  program.forEach(([op, jt, jf, k], i) => {
    // Jumps are relative to the next instruction; a label is where its line ends up.
    const offset = (to: string | number) =>
      typeof to === 'number' ? to : (labels.get(to) as number) - i - 1;
    out.writeUInt16LE(op, i * 8);
    out.writeUInt8(offset(jt), i * 8 + 2);
    out.writeUInt8(offset(jf), i * 8 + 3);
    out.writeUInt32LE(k, i * 8 + 4);
  });
  return out;
}
