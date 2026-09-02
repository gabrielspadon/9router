import { NextResponse } from 'next/server';
import { getRecentLogs } from '@/lib/usageDb';

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

// The repo call takes a LIMIT and no OFFSET, so a page is cut from a prefix of
// the newest rows. Without a ceiling on that prefix, `?page=100000` would ask
// the DB for fifty million formatted rows — the same unbounded-list shape the
// memory report (#1245) is about — so the reachable window is capped here.
// ponytail: prefix scan; move the offset into getRecentLogs if paging has to
// reach past MAX_SCAN rows.
const MAX_SCAN = 5000;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    // No paging params means the caller is the pre-existing consumer, which
    // reads a bare array. Answering an object to everyone would break it, and
    // its render half is not this lane's to fix.
    if (!searchParams.has('page') && !searchParams.has('pageSize')) {
      return NextResponse.json(await getRecentLogs(DEFAULT_PAGE_SIZE));
    }

    const pageSize = Math.min(
      parsePositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    );
    const page = parsePositiveInt(searchParams.get('page'), 1);
    const offset = (page - 1) * pageSize;

    if (offset >= MAX_SCAN) {
      return NextResponse.json({
        logs: [],
        pagination: { page, pageSize, hasNext: false, hasPrev: page > 1, maxScan: MAX_SCAN },
      });
    }

    // One row past the window answers hasNext without a second COUNT(*).
    const end = Math.min(offset + pageSize, MAX_SCAN);
    const rows = await getRecentLogs(Math.min(end + 1, MAX_SCAN + 1));

    return NextResponse.json({
      logs: rows.slice(offset, end),
      pagination: {
        page,
        pageSize,
        hasNext: rows.length > end && end < MAX_SCAN,
        hasPrev: page > 1,
        maxScan: MAX_SCAN,
      },
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
