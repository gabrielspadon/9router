// Declarative custom provider adapters (#3356).
//
// An adapter is DATA. It is never code, and nothing in this file executes a
// field of the document it is given. The report asked for JS/TS transformer
// files loaded from a directory and run per request; that is arbitrary code
// execution inside the router process, which already holds every provider
// credential on the host, so the executable half is refused by design. See
// `assertNoExecutableFields`.
//
// What is left is the half that was actually missing. The built-in compatible
// node form (`POST /api/provider-nodes`) can express a base URL and a format
// but not the two things an unofficial endpoint almost always needs: static
// headers (a pinned User-Agent, a tenant id, a cookie) and an auth header that
// is not `Authorization: Bearer`. An adapter declares those, and compiles to
// the provider-node shape the engine ALREADY executes:
//
//   node.transports[]  (nodesRepo)
//     -> providerSpecificData.transports  (src/app/api/providers/route.js)
//     -> resolveTransport()               (open-sse/services/provider.js)
//     -> credentials.runtimeTransport     (open-sse/handlers/chatCore.js)
//     -> buildUrl / buildHeaders          (open-sse/executors/default.js)
//
// So there is no loader, no plugin runtime and no new request path: an adapter
// is a different way to write a row that already routes.

export const ADAPTER_FORMATS = ['openai', 'openai-responses', 'claude'];

// Canonical path appended to baseUrl when an endpoint gives no explicit url.
const FORMAT_PATH = {
  openai: '/chat/completions',
  'openai-responses': '/responses',
  claude: '/messages',
};

// Auth descriptor the default executor understands, per upstream format.
// Shape mirrors open-sse/executors/default.js `applyAuth`.
const FORMAT_AUTH = {
  openai: { combined: true, header: 'Authorization', scheme: 'bearer' },
  'openai-responses': { combined: true, header: 'Authorization', scheme: 'bearer' },
  claude: { combined: true, header: 'x-api-key', scheme: 'raw', anthropicVersion: true },
};

// Fields whose presence means the document is trying to ship behaviour.
const EXECUTABLE_FIELDS = [
  'requestTransformer',
  'responseTransformer',
  'streamTransformer',
  'transformer',
  'transform',
  'script',
  'code',
  'hooks',
  'middleware',
  'module',
  'entry',
];

const PREFIX_RE = /^[A-Za-z0-9_-]{1,32}$/;
// RFC 7230 token. Rejects CR, LF, NUL, spaces and separators, so a header name
// cannot split the request.
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// Framing and negotiation belong to the fetch layer; a wrong value here fails
// as a truncated body rather than as an error anyone can read.
const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'content-type',
  'transfer-encoding',
  'connection',
  'te',
  'trailer',
  'upgrade',
  'expect',
  'keep-alive',
  'accept-encoding',
]);
// CR/LF split the request and NUL truncates it. A space is legal in a header
// value (User-Agent), so it is not rejected here.
const HEADER_VALUE_BAD_RE = /[\r\n\u0000]/;
const INTERPOLATION_RE = /\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*/;
const MAX_HEADERS = 32;
const MAX_HEADER_VALUE = 4096;
const MAX_NAME = 128;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function trimmed(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Absolute http(s) URL with a host. Anything else (file:, data:, a bare path)
// is rejected rather than normalized, because guessing here picks an upstream
// the operator did not name.
function parseHttpUrl(value) {
  const raw = trimmed(value);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url;
}

// Strip a trailing slash, and a trailing canonical path the operator pasted in
// from provider docs, so `.../v1/chat/completions` and `.../v1` mean the same.
export function normalizeAdapterBaseUrl(value) {
  let base = trimmed(value).replace(/\/+$/, '');
  for (const path of Object.values(FORMAT_PATH)) {
    if (base.toLowerCase().endsWith(path)) {
      base = base.slice(0, -path.length);
      break;
    }
  }
  return base.replace(/\/+$/, '');
}

function assertNoExecutableFields(doc, errors) {
  for (const field of EXECUTABLE_FIELDS) {
    if (doc[field] === undefined) continue;
    errors.push(
      `"${field}" is not supported: an adapter is data, not code. TokenProxy will not load or run a transformer supplied by a document, because it would execute inside the process holding every provider credential. Express the upstream with baseUrl/endpoints/headers/auth, or add a translator under open-sse/translator/.`
    );
  }
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === 'function') {
      errors.push(`"${key}" is a function; adapters carry no executable fields.`);
    }
  }
}

function validateHeaders(headers, errors) {
  if (headers === undefined) return {};
  if (!isPlainObject(headers)) {
    errors.push(`"headers" must be an object of name/value strings.`);
    return {};
  }
  const entries = Object.entries(headers);
  if (entries.length > MAX_HEADERS) {
    errors.push(`"headers" has ${entries.length} entries; at most ${MAX_HEADERS} are allowed.`);
    return {};
  }
  const out = {};
  for (const [name, value] of entries) {
    if (!HEADER_NAME_RE.test(name)) {
      errors.push(`Header name "${name}" is not a valid HTTP token.`);
      continue;
    }
    if (RESERVED_HEADERS.has(name.toLowerCase())) {
      errors.push(`Header "${name}" is managed by the transport and cannot be set by an adapter.`);
      continue;
    }
    if (typeof value !== 'string') {
      errors.push(`Header "${name}" must be a string.`);
      continue;
    }
    if (value.length > MAX_HEADER_VALUE) {
      errors.push(`Header "${name}" exceeds ${MAX_HEADER_VALUE} characters.`);
      continue;
    }
    if (HEADER_VALUE_BAD_RE.test(value)) {
      errors.push(`Header "${name}" contains a newline or NUL.`);
      continue;
    }
    if (INTERPOLATION_RE.test(value)) {
      errors.push(
        `Header "${name}" looks like an environment interpolation. Adapters do not read process env: anyone able to create one could otherwise read JWT_SECRET or API_KEY_SECRET and send it to the adapter's own baseUrl. Put the secret in the connection's API key, or paste the literal value.`
      );
      continue;
    }
    out[name] = value;
  }
  return out;
}

function validateAuth(auth, errors) {
  if (auth === undefined) return null;
  if (!isPlainObject(auth)) {
    errors.push(`"auth" must be an object.`);
    return null;
  }
  const header = trimmed(auth.header);
  const scheme = trimmed(auth.scheme) || 'bearer';
  if (!HEADER_NAME_RE.test(header)) {
    errors.push(`"auth.header" must be a valid HTTP token, e.g. "Authorization" or "x-api-key".`);
    return null;
  }
  if (RESERVED_HEADERS.has(header.toLowerCase())) {
    errors.push(`"auth.header" cannot be "${header}".`);
    return null;
  }
  if (scheme !== 'bearer' && scheme !== 'raw') {
    errors.push(`"auth.scheme" must be "bearer" or "raw".`);
    return null;
  }
  return {
    combined: true,
    header,
    scheme,
    ...(auth.anthropicVersion === true ? { anthropicVersion: true } : {}),
  };
}

function validateEndpoints(doc, baseUrl, errors) {
  const raw = doc.endpoints === undefined ? [{ format: 'openai' }] : doc.endpoints;
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push(`"endpoints" must be a non-empty array.`);
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      errors.push(`Each endpoint must be an object with a "format".`);
      continue;
    }
    const format = trimmed(entry.format);
    if (!ADAPTER_FORMATS.includes(format)) {
      errors.push(
        `Endpoint format "${format || '(missing)'}" is not one of ${ADAPTER_FORMATS.join(', ')}.`
      );
      continue;
    }
    if (seen.has(format)) {
      errors.push(`Endpoint format "${format}" is declared more than once.`);
      continue;
    }
    seen.add(format);
    let url;
    if (entry.url !== undefined) {
      const parsed = parseHttpUrl(entry.url);
      if (!parsed) {
        errors.push(
          `Endpoint "${format}" has an invalid url; an absolute http(s) URL is required.`
        );
        continue;
      }
      url = parsed.toString().replace(/\/+$/, '');
    } else {
      if (!baseUrl) continue; // baseUrl error already reported
      url = `${baseUrl}${FORMAT_PATH[format]}`;
    }
    const urlSuffix = trimmed(entry.urlSuffix);
    if (urlSuffix && /[\s]/.test(urlSuffix)) {
      errors.push(`Endpoint "${format}" has an invalid urlSuffix.`);
      continue;
    }
    out.push({ format, url, ...(urlSuffix ? { urlSuffix } : {}) });
  }
  return out;
}

/**
 * Compile an adapter document into the provider-node row the engine executes.
 *
 * @param {object} doc - the adapter document (untrusted input)
 * @param {object} [options]
 * @param {string} [options.id] - node id; MUST keep the `openai-compatible-`
 *   prefix, which is what makes the connection carry `transports` through to
 *   the executor (src/app/api/providers/route.js).
 * @param {string[]} [options.takenPrefixes] - prefixes already owned by another
 *   node; a duplicate silently shadows the older node at model-resolution time.
 * @returns {{errors: string[], node: object|null}}
 */
export function compileCustomAdapter(doc, options = {}) {
  const errors = [];
  if (!isPlainObject(doc)) {
    return { errors: ['Adapter must be a JSON object.'], node: null };
  }

  assertNoExecutableFields(doc, errors);

  const name = trimmed(doc.name);
  if (!name) errors.push(`"name" is required.`);
  else if (name.length > MAX_NAME) errors.push(`"name" exceeds ${MAX_NAME} characters.`);

  const prefix = trimmed(doc.prefix);
  if (!PREFIX_RE.test(prefix)) {
    errors.push(
      `"prefix" must be 1-32 characters of A-Z, a-z, 0-9, "_" or "-"; it becomes the "prefix/model" routing token.`
    );
  } else if (Array.isArray(options.takenPrefixes) && options.takenPrefixes.includes(prefix)) {
    errors.push(`Prefix "${prefix}" is already used by another provider node.`);
  }

  let baseUrl = '';
  if (doc.baseUrl !== undefined || doc.endpoints === undefined) {
    const parsed = parseHttpUrl(doc.baseUrl);
    if (!parsed) errors.push(`"baseUrl" must be an absolute http(s) URL.`);
    else baseUrl = normalizeAdapterBaseUrl(parsed.toString());
  }

  const headers = validateHeaders(doc.headers, errors);
  const auth = validateAuth(doc.auth, errors);
  const endpoints = validateEndpoints(doc, baseUrl, errors);
  if (!errors.length && !endpoints.length) errors.push(`"endpoints" resolved to nothing.`);

  if (errors.length) return { errors, node: null };

  const transports = endpoints.map((e) => ({
    format: e.format,
    baseUrl: e.url,
    ...(e.urlSuffix ? { urlSuffix: e.urlSuffix } : {}),
    auth: auth || FORMAT_AUTH[e.format],
    ...(Object.keys(headers).length ? { headers: { ...headers } } : {}),
  }));

  // apiType only decides the fallback endpoint used when a client speaks a
  // format this adapter did not declare; prefer chat whenever it is offered.
  const apiType = endpoints.some((e) => e.format === 'openai')
    ? 'chat'
    : endpoints.some((e) => e.format === 'openai-responses')
      ? 'responses'
      : 'chat';

  return {
    errors: [],
    node: {
      id: options.id,
      type: 'openai-compatible',
      name,
      prefix,
      apiType,
      baseUrl: baseUrl || normalizeAdapterBaseUrl(endpoints[0].url),
      transports,
    },
  };
}

/**
 * Inverse of `compileCustomAdapter` — render a stored node back as a document,
 * so an adapter can be exported, edited and re-imported without the dashboard.
 */
export function adapterFromProviderNode(node) {
  if (!isPlainObject(node)) return null;
  const transports = Array.isArray(node.transports) ? node.transports : [];
  const first = transports[0] || null;
  return {
    id: node.id,
    name: node.name || '',
    prefix: node.prefix || '',
    baseUrl: node.baseUrl || '',
    endpoints: transports.map((t) => ({
      format: t.format,
      url: t.baseUrl,
      ...(t.urlSuffix ? { urlSuffix: t.urlSuffix } : {}),
    })),
    ...(first?.headers ? { headers: { ...first.headers } } : {}),
    ...(first?.auth
      ? {
          auth: {
            header: first.auth.header,
            scheme: first.auth.scheme,
            ...(first.auth.anthropicVersion ? { anthropicVersion: true } : {}),
          },
        }
      : {}),
  };
}
