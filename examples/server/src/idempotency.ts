import { createHash } from 'node:crypto';

type Entry =
  | { state: 'in_progress'; requestHash: string }
  | { state: 'done'; requestHash: string; status: number; body: unknown };

// Use a database table with a unique index on the key in production, so two
// servers can't both claim the same key. Keep rows for at least 24 hours.
const entries = new Map<string, Entry>();

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export type Claim =
  | { kind: 'new' }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' };

export function claim(key: string, requestHash: string): Claim {
  const existing = entries.get(key);
  if (!existing) {
    entries.set(key, { state: 'in_progress', requestHash });
    return { kind: 'new' };
  }
  if (existing.requestHash !== requestHash) return { kind: 'mismatch' };
  if (existing.state === 'in_progress') return { kind: 'in_progress' };
  return { kind: 'replay', status: existing.status, body: existing.body };
}

export function complete(key: string, requestHash: string, status: number, body: unknown): void {
  entries.set(key, { state: 'done', requestHash, status, body });
}

// Lets the client retry with the same key after a failure on our side.
export function release(key: string): void {
  entries.delete(key);
}
