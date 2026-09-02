/**
 * #1345 — pagination on the list pages.
 *
 * `/api/usage/logs` answered one hardcoded slab: `getRecentLogs(200)` with no
 * page, no page size, and no way for a caller to reach anything older. This is
 * the API half. It also closes the endpoint's own #1245 exposure, since a list
 * endpoint that lets the caller name the size is unbounded unless the size is
 * capped and the reachable prefix is capped with it.
 *
 * The pre-existing consumer
 * (src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js:70) fetches
 * the route with no query and reads a bare array, and its render half belongs to
 * another lane, so the un-paginated shape has to survive untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Every call records its limit so the cap can be asserted on the DB read. */
const calls = [];
let rowCount = 10_000;

vi.mock('@/lib/usageDb', () => ({
  getRecentLogs: async (limit) => {
    calls.push(limit);
    return Array.from({ length: Math.min(limit, rowCount) }, (_, i) => `row-${i}`);
  },
}));

async function get(query = '') {
  const { GET } = await import('@/app/api/usage/logs/route.js');
  const response = await GET(
    new Request(`http://localhost/api/usage/logs${query ? `?${query}` : ''}`)
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  calls.length = 0;
  rowCount = 10_000;
});

describe('#1345 /api/usage/logs pages', () => {
  it('keeps the bare array for a request with no paging params', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(200);
    expect(calls).toEqual([200]);
  });

  it('returns the first window plus its pagination when asked', async () => {
    const { status, body } = await get('page=1&pageSize=50');
    expect(status).toBe(200);
    expect(body.logs).toHaveLength(50);
    expect(body.logs[0]).toBe('row-0');
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 50, hasNext: true, hasPrev: false });
  });

  it('returns the second window, not the first again', async () => {
    const { body } = await get('page=2&pageSize=50');
    expect(body.logs[0]).toBe('row-50');
    expect(body.logs).toHaveLength(50);
    expect(body.pagination).toMatchObject({ page: 2, hasPrev: true });
  });

  it('reports hasNext false on the last window', async () => {
    rowCount = 60;
    const { body } = await get('page=2&pageSize=50');
    expect(body.logs).toHaveLength(10);
    expect(body.pagination.hasNext).toBe(false);
  });

  it('answers an empty page rather than 500 when the page is past the end', async () => {
    rowCount = 5;
    const { status, body } = await get('page=9&pageSize=50');
    expect(status).toBe(200);
    expect(body.logs).toEqual([]);
    expect(body.pagination.hasNext).toBe(false);
  });

  it('caps pageSize so one request cannot name the whole table', async () => {
    const { body } = await get('pageSize=100000');
    expect(body.pagination.pageSize).toBe(500);
    expect(body.logs).toHaveLength(500);
  });

  it('caps the scanned prefix, so a far page cannot ask the DB for millions of rows', async () => {
    // The repo takes a LIMIT and no OFFSET, so page N costs N*pageSize rows.
    // Unbounded, this is exactly the shape #1245 describes.
    await get('page=100000&pageSize=500');
    expect(calls).toEqual([]); // refused before the read
  });

  it('never reads past the scan ceiling on a page inside it', async () => {
    await get('page=9&pageSize=500'); // window 4000..4500, inside MAX_SCAN
    expect(Math.max(...calls)).toBeLessThanOrEqual(5001);
  });

  it('rejects a junk page or pageSize by falling back, not by throwing', async () => {
    const { status, body } = await get('page=-3&pageSize=abc');
    expect(status).toBe(200);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 200 });
  });
});
