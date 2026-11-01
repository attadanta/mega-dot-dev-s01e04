import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, JobStatus, NightCounts, ReadNight } from './types.js';

type Entry = {
  at: string;
  job: string;
  status: JobStatus;
  owner: string | null;
  error: string | undefined;
};

const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;

const isStatus = (v: unknown): v is JobStatus => v === 'ok' || v === 'retry' || v === 'fail';

const parseEntry = (line: string): Entry | null => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const { at, job, status } = rec;
  if (typeof at !== 'string' || typeof job !== 'string' || !isStatus(status)) return null;
  const owner = 'owner' in rec ? rec.owner : null;
  if (owner !== null && typeof owner !== 'string') return null;
  const error = rec.error;
  if (error !== undefined && typeof error !== 'string') return null;
  return { at, job, status, owner, error };
};

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT_RE.test(night)) return null;

  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  const rows = new Map<string, DigestRow>();
  const counts: NightCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const entry = parseEntry(line);
    if (entry === null) {
      badLines += 1;
      continue;
    }
    counts[entry.status] += 1;
    const row = rows.get(entry.job);
    if (row === undefined) {
      rows.set(entry.job, {
        job: entry.job,
        owner: entry.owner,
        runs: 1,
        retries: entry.status === 'retry' ? 1 : 0,
        lastStatus: entry.status,
        lastError: entry.error ?? null,
        firstAt: entry.at,
        lastAt: entry.at,
      });
    } else {
      row.owner = entry.owner;
      row.runs += 1;
      if (entry.status === 'retry') row.retries += 1;
      row.lastStatus = entry.status;
      if (entry.error !== undefined) row.lastError = entry.error;
      row.lastAt = entry.at;
    }
  }

  const sorted = [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows: sorted, badLines, counts };
};
