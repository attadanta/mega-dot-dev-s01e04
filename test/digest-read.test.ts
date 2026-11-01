import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readNight } from '../src/digest/read.js';

const realRuns = resolve(import.meta.dirname, '..', 'runs');

describe('readNight on the real fixture', () => {
  const digest = readNight(realRuns, '2026-10-28');

  it('has the expected rows and bad line count', () => {
    expect(digest).not.toBeNull();
    expect(digest?.night).toBe('2026-10-28');
    expect(digest?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(digest?.badLines).toBe(1);
  });

  it('summarises each job', () => {
    const by = new Map(digest?.rows.map((r) => [r.job, r]));
    expect(by.get('digest/render')?.owner).toBeNull();
    expect(by.get('fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
    });
    expect(by.get('lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(by.get('notes/backup')).toMatchObject({
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });
});

describe('readNight with temp files', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    try {
      dir = mkdtempSync(join(tmpdir(), 'digest-read-'));
    } catch {
      const base = resolve(import.meta.dirname, '..', '.tmp-digest-read');
      mkdirSync(base, { recursive: true });
      dir = mkdtempSync(join(base, 'run-'));
      cleanup = () => rmSync(base, { recursive: true, force: true });
      return;
    }
    cleanup = () => rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => cleanup());

  const write = (night: string, content: string): void =>
    writeFileSync(join(dir, `${night}.jsonl`), content);

  it('returns null when the file does not exist', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null for a bad night string', () => {
    write('2026-10-28', '');
    expect(readNight(dir, '../2026-10-28')).toBeNull();
    expect(readNight(dir, '2026-10-28\n')).toBeNull();
    expect(readNight(dir, '2026-1-28')).toBeNull();
    expect(readNight(dir, '')).toBeNull();
  });

  it('gives an empty digest for an empty file', () => {
    write('2026-01-02', '');
    expect(readNight(dir, '2026-01-02')).toEqual({ night: '2026-01-02', rows: [], badLines: 0 });
  });

  it('ignores blank lines without counting them', () => {
    const line = '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":"x"}';
    write('2026-01-03', `\n  \t \n${line}\r\n\r\n   \n`);
    const d = readNight(dir, '2026-01-03');
    expect(d?.badLines).toBe(0);
    expect(d?.rows).toHaveLength(1);
    expect(d?.rows[0]).toMatchObject({ job: 'a', owner: 'x', runs: 1 });
  });

  it('counts wrong-shape lines as bad and never throws', () => {
    const good = (extra: string): string =>
      `{"at":"t","job":"j"${extra}}`;
    const lines = [
      'not json',
      '[]',
      'null',
      '42',
      '"str"',
      '{"at":"t","job":"j"',
      '{"job":"j","status":"ok","owner":null}',
      '{"at":1,"job":"j","status":"ok","owner":null}',
      '{"at":"t","status":"ok","owner":null}',
      '{"at":"t","job":5,"status":"ok","owner":null}',
      good(',"status":"weird","owner":null'),
      good(',"owner":null'),
      good(',"status":"ok","owner":5'),
      good(',"status":"ok","owner":{}'),
      good(',"status":"ok","owner":null,"error":7'),
      good(',"status":"ok","owner":null,"error":null'),
    ];
    write('2026-01-04', lines.join('\n') + '\n');
    const d = readNight(dir, '2026-01-04');
    expect(d).toEqual({ night: '2026-01-04', rows: [], badLines: lines.length });
  });

  it('treats a missing owner as null and mixes good and bad lines', () => {
    write(
      '2026-01-05',
      [
        '{"at":"2026-01-05T10:00:00+02:00","job":"b","status":"retry","error":"e1"}',
        'garbage',
        '{"at":"2026-01-05T11:00:00+02:00","job":"B","status":"ok","owner":"z"}',
        '{"at":"2026-01-05T12:00:00+02:00","job":"b","status":"ok","owner":"me"}',
      ].join('\n'),
    );
    const d = readNight(dir, '2026-01-05');
    expect(d?.badLines).toBe(1);
    expect(d?.rows.map((r) => r.job)).toEqual(['B', 'b']);
    expect(d?.rows[1]).toEqual({
      job: 'b',
      owner: 'me',
      runs: 2,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'e1',
      firstAt: '2026-01-05T10:00:00+02:00',
      lastAt: '2026-01-05T12:00:00+02:00',
    });
    expect(d?.rows[0]?.owner).toBe('z');
  });
});
