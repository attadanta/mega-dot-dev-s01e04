import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const configFor = (runsDir: string): RigConfig => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

/** Job names in the order they appear in the page's table body. */
const jobsInHtml = (html: string): string[] =>
  [...html.matchAll(/<tr[^>]*><td>([^<]*)<\/td>/g)].map((m) => m[1] ?? '');

/** The opening <tr ...> tag of the row whose first cell is `job`. */
const trTag = (html: string, job: string): string => {
  const idx = html.indexOf(`<td>${job}</td>`);
  expect(idx).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<tr', idx);
  return html.slice(start, html.indexOf('>', start) + 1);
};

/** The full <tr>...</tr> markup of the row whose first cell is `job`. */
const rowHtml = (html: string, job: string): string => {
  const idx = html.indexOf(`<td>${job}</td>`);
  expect(idx).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<tr', idx);
  return html.slice(start, html.indexOf('</tr>', idx) + '</tr>'.length);
};

const NORMAL = [
  '{"at":"2026-03-04T01:00:00+01:00","job":"zeta/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-03-04T02:00:00+01:00","job":"alpha/build","status":"retry","owner":"rook","error":"503"}',
  '{"at":"2026-03-04T02:05:00+01:00","job":"alpha/build","status":"retry","owner":"rook","error":"503"}',
  '{"at":"2026-03-04T02:10:00+01:00","job":"alpha/build","status":"retry","owner":"rook","error":"503"}',
  '{"at":"2026-03-04T02:15:00+01:00","job":"alpha/build","status":"ok","owner":"rook"}',
  '{"at":"2026-03-04T03:00:00+01:00","job":"beta/fail","status":"ok","owner":"lane-07"}',
  '{"at":"2026-03-04T03:30:00+01:00","job":"beta/fail","status":"fail","owner":"lane-07","error":"quota"}',
  '{"at":"2026-03-04T04:00:00+01:00","job":"gamma/two","status":"retry","owner":"rook","error":"lock"}',
  '{"at":"2026-03-04T04:01:00+01:00","job":"gamma/two","status":"retry","owner":"rook","error":"lock"}',
  '{"at":"2026-03-04T04:02:00+01:00","job":"gamma/two","status":"ok","owner":"rook"}',
  '{"at":"2026-03-04T05:00:00+01:00","job":"delta/noowner","status":"ok","owner":null,"error":"slow start"}',
].join('\n');

const NORMAL_NIGHT = '2026-03-04';
const NORMAL_JOBS = ['alpha/build', 'beta/fail', 'delta/noowner', 'gamma/two', 'zeta/sync'];

describe('digest routes with temp files', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    try {
      dir = mkdtempSync(join(tmpdir(), 'digest-routes-'));
    } catch {
      const base = resolve(import.meta.dirname, '..', '.tmp-digest-routes');
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

  describe('normal night', () => {
    it('page and JSON both hold every job, in the same order', async () => {
      write(NORMAL_NIGHT, NORMAL);
      const app = createApp(configFor(dir));

      const page = await app.request(`/digest/${NORMAL_NIGHT}`);
      const html = await page.text();
      expect(page.status).toBe(200);
      for (const job of NORMAL_JOBS) expect(html).toContain(`<td>${job}</td>`);

      const api = await app.request(`/api/digest/${NORMAL_NIGHT}`);
      expect(api.status).toBe(200);
      const body = (await api.json()) as { rows: { job: string }[] };
      expect(body.rows.map((r) => r.job)).toEqual(NORMAL_JOBS);
      expect(jobsInHtml(html)).toEqual(body.rows.map((r) => r.job));
    });
  });

  describe('missing or invalid night', () => {
    it.each(['2026-12-31', 'not-a-night'])('404 on both routes for %s', async (night) => {
      write(NORMAL_NIGHT, NORMAL);
      const app = createApp(configFor(dir));

      const page = await app.request(`/digest/${night}`);
      expect(page.status).toBe(404);

      const api = await app.request(`/api/digest/${night}`);
      expect(api.status).toBe(404);
    });
  });

  describe('empty file', () => {
    it('shows "nothing ran" and an empty rows array', async () => {
      write('2026-03-05', '');
      const app = createApp(configFor(dir));

      const page = await app.request('/digest/2026-03-05');
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(html).toContain('nothing ran');
      expect(html).not.toContain('<table');

      const api = await app.request('/api/digest/2026-03-05');
      expect(api.status).toBe(200);
      expect(await api.json()).toEqual({
        night: '2026-03-05',
        rows: [],
        badLines: 0,
        counts: { ok: 0, retry: 0, fail: 0 },
      });
    });
  });

  describe('file with a bad line', () => {
    it('keeps the good rows and reports the bad line', async () => {
      write(
        '2026-03-06',
        [
          '{"at":"2026-03-06T01:00:00+01:00","job":"good/one","status":"ok","owner":"rook"}',
          'this is not json',
          '{"at":"2026-03-06T02:00:00+01:00","job":"good/two","status":"ok","owner":"rook"}',
        ].join('\n'),
      );
      const app = createApp(configFor(dir));

      const api = await app.request('/api/digest/2026-03-06');
      expect(api.status).toBe(200);
      const body = (await api.json()) as { rows: { job: string }[]; badLines: number };
      expect(body.badLines).toBe(1);
      expect(body.rows.map((r) => r.job)).toEqual(['good/one', 'good/two']);

      const page = await app.request('/digest/2026-03-06');
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(html).toContain('good/one');
      expect(html).toContain('good/two');
      expect(html).toContain('1 line(s) could not be read');
    });
  });

  describe('page row flags and placeholders', () => {
    it('marks 3 retries and a last fail as warn, but not 2 retries', async () => {
      write(NORMAL_NIGHT, NORMAL);
      const html = await (await createApp(configFor(dir)).request(`/digest/${NORMAL_NIGHT}`)).text();

      expect(trTag(html, 'alpha/build')).toContain('class="warn"');
      expect(trTag(html, 'beta/fail')).toContain('class="warn"');
      expect(trTag(html, 'gamma/two')).not.toContain('class="warn"');
      expect(trTag(html, 'zeta/sync')).not.toContain('class="warn"');
    });

    it('shows a dash for a null owner in the page, keeps null in JSON', async () => {
      write(NORMAL_NIGHT, NORMAL);
      const app = createApp(configFor(dir));

      const html = await (await app.request(`/digest/${NORMAL_NIGHT}`)).text();
      expect(rowHtml(html, 'delta/noowner')).toContain('<td>—</td>');

      const body = (await (await app.request(`/api/digest/${NORMAL_NIGHT}`)).json()) as {
        rows: { job: string; owner: string | null }[];
      };
      expect(body.rows.find((r) => r.job === 'delta/noowner')?.owner).toBeNull();
    });

    it('shows a dash for an empty owner and an empty error', async () => {
      writeFileSync(
        join(dir, '2026-03-06.jsonl'),
        '{"at":"2026-03-06T01:00:00+01:00","job":"eps/empty","status":"ok","owner":"","error":""}\n',
      );
      const html = await (await createApp(configFor(dir)).request('/digest/2026-03-06')).text();
      expect(rowHtml(html, 'eps/empty').match(/<td>—<\/td>/g)).toHaveLength(2);
    });
  });
});

describe('digest routes on the real fixture', () => {
  it('page and JSON agree on job order for 2026-10-28', async () => {
    const app = createApp(configFor('runs'));

    const page = await app.request('/digest/2026-10-28');
    const html = await page.text();
    expect(page.status).toBe(200);

    const api = await app.request('/api/digest/2026-10-28');
    expect(api.status).toBe(200);
    const body = (await api.json()) as { rows: { job: string }[] };

    expect(body.rows.length).toBeGreaterThan(0);
    expect(jobsInHtml(html)).toEqual(body.rows.map((r) => r.job));
  });
});
