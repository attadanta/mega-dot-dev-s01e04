import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board links to digests', () => {
  it('links each night and shows its counts', async () => {
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toContain('2026-10-28</a> · ok 10 · retry 4 · fail 1');
    expect(html).toContain('2026-10-27</a> · ok 7 · retry 0 · fail 0');
  });

  it('serves the digest pages for both nights', async () => {
    const app = createApp(config);
    const day28 = await app.request('/digest/2026-10-28');
    const day27 = await app.request('/digest/2026-10-27');
    expect(day28.status).toBe(200);
    expect(day27.status).toBe(200);
  });
});
