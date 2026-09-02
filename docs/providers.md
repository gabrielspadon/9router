# Providers

An upstream is connected once in the dashboard and then addressed from any
client as `providerPrefix/modelName`. This page covers what each family of
upstream needs, what it costs, and the quirks worth knowing before you connect
it. The browser login flows live in `src/lib/oauth/services/`.

Prices and free-tier limits below are the provider's, not TokenProxy's, and they
change without notice. Treat the provider's own pricing page as authoritative.

## How many providers there are

The registry holds one file per provider under
`open-sse/providers/registry/`. To count what this checkout actually ships:

```bash
ls open-sse/providers/registry/*.js | wc -l
```

`open-sse/providers/registry/index.js` is a generated static import list.
Regenerate it with `node scripts/generate-registry-index.mjs` rather than
editing it by hand, and add a new provider by copying
`open-sse/providers/REGISTRY_TEMPLATE.js`. An executor
is only needed for an upstream that is not OpenAI-compatible.

The authoritative list of what your instance can currently serve is
`GET /v1/models`, which returns every connected model and every saved combo.

## Connection types

### OAuth providers

Connected by a browser login, refreshed in the background, no API key to paste.
Claude Code, Codex, GitHub Copilot, Cursor, Antigravity, Kimchi, Kiro, iFlow,
Qoder, Gemini and xAI each have a dedicated flow under
`src/lib/oauth/services/`.

### API-key providers

Paste a key in the dashboard. The key is encrypted at rest in the local SQLite
database. This is the largest group and covers OpenRouter, GLM, Kimi, MiniMax,
OpenAI, Anthropic, Gemini, DeepSeek, Groq, xAI, Mistral, Perplexity, Together,
Fireworks, Cerebras, Cohere, NVIDIA, SiliconFlow, Nebius, Chutes, Hyperbolic,
and any endpoint that speaks the OpenAI or Anthropic shape behind a custom base
URL.

### Self-hosted providers

For speech and embeddings served from your own machine, covering whisper.cpp,
faster-whisper, Speaches, Kokoro-FastAPI, openedai-speech,
llama.cpp/llama-server, vLLM, Infinity, text-embeddings-inference, or anything
else that speaks the OpenAI shape.

| Provider | Endpoint used | Typical server |
| -- | -- | -- |
| Self-hosted STT | `/v1/audio/transcriptions` | whisper.cpp, faster-whisper |
| Self-hosted TTS | `/v1/audio/speech` | Kokoro-FastAPI, openedai-speech |
| Self-hosted Embedding | `/v1/embeddings` | llama-server, vLLM, Infinity |

Every other speech provider is a named cloud service with a fixed endpoint.
These three read their address from each connection instead, so one provider
entry can front several machines and load-balance across them like any other.

Set the address on the connection as `providerSpecificData.baseUrl`:

| Provider | Give it | Result |
| -- | -- | -- |
| Self-hosted STT | the full URL, `http://host:8080/v1/audio/transcriptions` | used as-is |
| Self-hosted TTS | the server root, `http://host:8880` | `+ /v1/audio/speech` |
| Self-hosted Embedding | the OpenAI base with `/v1` included, `http://host:8080/v1` | `+ /embeddings` |

Mind the `/v1` on embeddings. The adapter appends `/embeddings`, so
`http://host:8080` resolves to `http://host:8080/embeddings`, misses the OpenAI
route, and llama-server answers 501. Give it the same base URL an OpenAI client
would use. A full `.../v1/embeddings` is accepted too, so a value pasted from a
`curl` example also works.

The API key is not checked by most local servers, but the field must be
non-empty. It is what gives the connection a credentials record, and `baseUrl`
lives inside that record. Any placeholder works.

Self-hosted Embedding has no cloud fallback by design. A connection saved
without a `baseUrl` is reported as a configuration error rather than quietly
falling back to `api.openai.com`, which would send your input text and API key
to a third party under a provider named "Self-hosted".

## Cost tiers

| Tier | Provider | Cost | Quota reset | Notes |
| -- | -- | -- | -- | -- |
| Subscription | Claude Code Pro or Max | 20 to 200 USD per month | 5 hour plus weekly | Already subscribed |
| Subscription | Codex Plus or Pro | 20 to 200 USD per month | 5 hour plus weekly | OpenAI accounts |
| Subscription | GitHub Copilot | 10 to 19 USD per month | monthly | GitHub accounts |
| Subscription | Cursor | 20 USD per month | monthly | Cursor accounts |
| Cheap | GLM-5.1 and GLM-4.7 | 0.6 USD per 1M | daily at 10:00 | Budget backup |
| Cheap | MiniMax M2.7 | 0.2 USD per 1M | 5 hour rolling | Long context |
| Cheap | Kimi K2.5 | 9 USD per month flat | 10M tokens per month | Predictable |
| Free | Kiro AI | 0 | about 50 credits per month | Paid tiers above that |
| Free | OpenCode Free | 0 | varies | Model list changes |
| Free | Vertex AI | 300 USD credits | new GCP accounts | 90 day window |

## Free tiers

### Kiro AI

Connect through AWS Builder ID, AWS IAM Identity Center, Google or GitHub. No
API key and no payment details. Kiro moved to a paid model in September 2025 and
the free tier is now capped at about 50 credits per month, plus 500 trial
credits for a new account in its first 30 days. Paid tiers run 20 USD per month
for 1,000 credits, 40 for 2,000, 100 for 5,000 and 200 for 10,000.

Example model ids: `kr/claude-sonnet-4.5`, `kr/claude-haiku-4.5`, `kr/glm-5`,
`kr/MiniMax-M2.5`, `kr/qwen3-coder-next`, `kr/deepseek-3.2`.

### OpenCode Free

A no-authentication passthrough proxy. Models are fetched automatically from
`opencode.ai/zen/v1/models`, so the model list is whatever that endpoint serves
at the time. Some entries are free only for a promotional window, and the list
changes without notice. This is the fastest provider to connect because there is
nothing to log into.

### Vertex AI

Upload a Google Cloud service account JSON and enable the Vertex AI API in the
project. New Google Cloud accounts get 300 USD in credits for 90 days.

Since March 2026 the plain Gemini API endpoint no longer consumes those credits.
Call the Vertex AI Studio endpoint instead, which is what the Vertex provider in
TokenProxy does.

Example model ids: `vertex/gemini-3.1-pro-preview`,
`vertex/gemini-3-flash-preview`, `vertex/gemini-2.5-flash`. Partner models
served through Vertex use the `vertex-partner/` prefix, for example
`vertex-partner/glm-5-maas`, `vertex-partner/deepseek-v3.2-maas`,
`vertex-partner/qwen3-next-80b-a3b-thinking-maas`.

### Discontinued free tiers

Do not plan around these. iFlow moved from free unlimited to paid during 2026.
The Qwen Code free OAuth tier was discontinued by Alibaba on 2026-04-15. Gemini
CLI was shut down by Google on 2026-06-18 and replaced by the closed-source
Antigravity CLI.

## Paid provider setup

### GLM

1. Sign up at [Zhipu AI](https://open.bigmodel.cn/).
2. Take an API key from the Coding Plan.
3. In the dashboard, add an API key under provider `glm`.

Model ids `glm/glm-5.1`, `glm/glm-5`, `glm/glm-4.7`. The Coding Plan gives
roughly three times the quota at about a seventh of the cost, and resets daily
at 10:00 local provider time.

### MiniMax

1. Sign up at [MiniMax](https://www.minimax.io/).
2. Take an API key.
3. Add it in the dashboard.

Model ids `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5`. Cheapest option for a
long context window.

### Kimi

1. Subscribe at [Moonshot AI](https://platform.moonshot.ai/).
2. Take an API key.
3. Add it in the dashboard.

Model ids `kimi/kimi-k2.5`, `kimi/kimi-k2.5-thinking`. A flat 9 USD per month
for 10M tokens works out near 0.90 USD per 1M.

## Subscription provider model ids

These are the ids the dashboard exposes for each subscription connection. They
follow the upstream's own model naming and change when the upstream ships a new
model, so read `/v1/models` for the live set.

- Claude Code, prefix `cc/`: `claude-opus-4-7`, `claude-opus-4-6`,
  `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`,
  `claude-haiku-4-5-20251001`.
- Codex, prefix `cx/`: `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`,
  `gpt-5.1-codex-max`.
- GitHub Copilot, prefix `gh/`: `gpt-5.4`, `claude-opus-4.7`,
  `claude-sonnet-4.6`, `gemini-3.1-pro-preview`, `grok-code-fast-1`.
- Cursor, prefix `cu/`: `claude-4.6-opus-max`, `claude-4.5-sonnet-thinking`,
  `gpt-5.3-codex`, `kimi-k2.5`.

## What the dashboard means by cost

The cost figure in Usage Analytics is a tracking and comparison number. TokenProxy
never charges anything, has no billing system, and holds no payment details. You
pay each provider directly, on their own terms.

A dashboard reading of 290 USD while running Kiro free models means the same
traffic would have cost 290 USD against paid APIs. The actual spend in that case
is zero. Read the figure as a savings tracker, not an invoice.

## Combos worth copying

A subscription-first combo uses the plan you already pay for, then degrades:

```
1. cc/claude-opus-4-7        subscription primary
2. glm/glm-5.1               cheap backup
3. kr/claude-sonnet-4.5      free emergency fallback
```

A free-only combo:

```
1. kr/claude-sonnet-4.5      Kiro free credits
2. kr/glm-5                  Kiro free credits
3. oc/<auto>                 OpenCode Free, no authentication
```

A no-interruption combo stacks five layers so a single exhausted quota never
stops the request:

```
1. cc/claude-opus-4-7
2. cx/gpt-5.5
3. glm/glm-5.1
4. minimax/MiniMax-M2.7
5. kr/claude-sonnet-4.5
```

Combine any of these with the token savers in
the dashboard's Token Saver panel to cut what each hop actually sends.
