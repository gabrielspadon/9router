import { NextResponse } from 'next/server';
import { createProviderNode, getProviderNodes } from '@/models';
import { OPENAI_COMPATIBLE_PREFIX } from '@/shared/constants/providers';
import { generateId } from '@/shared/utils';
import {
  adapterFromProviderNode,
  compileCustomAdapter,
} from 'open-sse/providers/customAdapters.js';

export const dynamic = 'force-dynamic';

// Adapter-created nodes keep the `openai-compatible-` prefix, because that is
// what makes `POST /api/providers` copy `transports` onto the connection
// (src/app/api/providers/route.js). The `adapter-` segment is only so this
// route can list back the ones it created.
const ADAPTER_ID_PREFIX = `${OPENAI_COMPATIBLE_PREFIX}adapter-`;

function isAdapterNode(node) {
  return typeof node?.id === 'string' && node.id.startsWith(ADAPTER_ID_PREFIX);
}

// GET /api/providers/custom — export every adapter-created node as a document.
export async function GET() {
  try {
    const nodes = await getProviderNodes({ type: 'openai-compatible' });
    return NextResponse.json({
      adapters: nodes.filter(isAdapterNode).map(adapterFromProviderNode),
    });
  } catch (error) {
    console.log('Error listing custom adapters:', error);
    return NextResponse.json({ error: 'Failed to list custom adapters' }, { status: 500 });
  }
}

// POST /api/providers/custom — compile a declarative adapter into a provider node.
//
// The document is untrusted input and is never executed: `compileCustomAdapter`
// rejects every transformer/script field outright and validates the rest into
// the transport shape the engine already routes.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  try {
    const existing = await getProviderNodes();
    const { errors, node } = compileCustomAdapter(body, {
      id: `${ADAPTER_ID_PREFIX}${generateId()}`,
      takenPrefixes: existing.map((n) => n.prefix).filter(Boolean),
    });
    if (errors.length) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }

    const created = await createProviderNode(node);
    return NextResponse.json(
      { node: created, adapter: adapterFromProviderNode(created) },
      { status: 201 }
    );
  } catch (error) {
    console.log('Error creating custom adapter:', error);
    return NextResponse.json({ error: 'Failed to create custom adapter' }, { status: 500 });
  }
}
