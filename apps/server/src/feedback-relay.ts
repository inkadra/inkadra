import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { type CreateFeedback, redactFeedback } from '@inkadra/shared';

/** Only fixed diagnostic fields leave the instance; never reporter or instance metadata. */
export function relayMetadata(report: CreateFeedback) {
  return {
    requestId: report.requestId,
    kind: report.type === 'bug' ? 'problem' : report.type,
    area: report.area,
    title: report.title,
    description: report.description,
    device: Object.fromEntries(
      Object.entries(report.diagnostics)
        .filter(([k]) => !['console', 'network'].includes(k))
        .map(([k, v]) => [k, redactFeedback(v)]),
    ),
    logExcerpt: redactFeedback(
      [report.diagnostics.console, report.diagnostics.network].filter(Boolean).join('\n'),
    ),
  };
}

export class RelayFailure extends Error {
  constructor(
    readonly status: number,
    readonly uncertain = false,
  ) {
    super(`Relay unavailable (HTTP ${status})`);
  }
  get permanent() {
    return [400, 401, 404, 410, 413, 422, 451].includes(this.status);
  }
}

export async function relayChallenge(base: string, installId: string) {
  const res = await fetch(`${base}/challenge`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installId }),
  });
  if (!res.ok) throw new RelayFailure(res.status);
  const t = (await res.json()) as { ticket: string; seed: string; bits: number; nbf: number };
  if (
    !Number.isInteger(t.bits) ||
    t.bits < 0 ||
    t.bits > 20 ||
    !Number.isFinite(t.nbf) ||
    t.nbf > Date.now() + 16 * 60000 ||
    typeof t.seed !== 'string' ||
    typeof t.ticket !== 'string'
  )
    throw new RelayFailure(502);
  let powNonce = '';
  for (let n = 0; ; n++) {
    const hash = createHash('sha256').update(`${t.seed}:${n}`).digest();
    let bits = 0;
    for (const byte of hash) {
      if (!byte) bits += 8;
      else {
        bits += Math.clz32(byte) - 24;
        break;
      }
    }
    if (bits >= t.bits) {
      powNonce = String(n);
      break;
    }
    if (n % 1024 === 0) await setTimeout(0);
  }
  await setTimeout(Math.max(0, t.nbf - Date.now()));
  return { installId, ticket: t.ticket, powNonce };
}

export async function sendRelay(base: string, form: FormData) {
  let res: Response;
  try {
    res = await fetch(`${base}/report`, {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    throw new RelayFailure(502, true);
  }
  if (!res.ok) throw new RelayFailure(res.status, res.status >= 500);
  try {
    const result = (await res.json()) as { number: number };
    if (!Number.isSafeInteger(result.number) || result.number < 1)
      throw new Error('Invalid receipt');
    return result.number;
  } catch {
    throw new RelayFailure(502, true);
  }
}
