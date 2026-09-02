---
name: tokenproxy
description: Entry point for TokenProxy — local/remote AI gateway with OpenAI-compatible REST for chat, image, TTS, embeddings, web search, web fetch. Use when the user mentions TokenProxy, TOKENPROXY_URL, or wants AI without writing provider boilerplate. This skill covers setup + indexes capability skills; fetch the relevant capability SKILL.md from the URLs below when needed.
---

# TokenProxy

Local/remote AI gateway exposing OpenAI-compatible REST. One key, many providers, auto-fallback.

## Setup

```bash
export TOKENPROXY_URL="http://localhost:20128"      # or VPS / tunnel URL
export TOKENPROXY_KEY="sk-..."                      # from Dashboard → Keys (only if requireApiKey=true)
```

All requests: `${TOKENPROXY_URL}/v1/...` with header `Authorization: Bearer ${TOKENPROXY_KEY}` (omit if auth disabled).

Verify: `curl $TOKENPROXY_URL/api/health` → `{"ok":true}`

## Discover models

```bash
curl $TOKENPROXY_URL/v1/models                  # chat/LLM (default)
curl $TOKENPROXY_URL/v1/models/image            # image-gen
curl $TOKENPROXY_URL/v1/models/tts              # text-to-speech
curl $TOKENPROXY_URL/v1/models/embedding        # embeddings
curl $TOKENPROXY_URL/v1/models/web              # web search + fetch (entries have `kind` field)
curl $TOKENPROXY_URL/v1/models/stt              # speech-to-text
curl $TOKENPROXY_URL/v1/models/image-to-text    # vision
```

Use `data[].id` as `model` field in requests. Combos appear with `owned_by:"combo"`.

Response shape:
```json
{ "object": "list", "data": [
  { "id": "openai/gpt-5", "object": "model", "owned_by": "openai", "created": 1735000000 },
  { "id": "tavily/search", "object": "model", "kind": "webSearch", "owned_by": "tavily", "created": 1735000000 }
]}
```

## Capability skills

When the user needs a specific capability, fetch that skill's `SKILL.md` from its raw URL:

| Capability | Raw URL |
|---|---|
| Chat / code-gen | $TOKENPROXY_URL/skills/tokenproxy-chat/SKILL.md |
| Image generation | $TOKENPROXY_URL/skills/tokenproxy-image/SKILL.md |
| Text-to-speech | $TOKENPROXY_URL/skills/tokenproxy-tts/SKILL.md |
| Speech-to-text | $TOKENPROXY_URL/skills/tokenproxy-stt/SKILL.md |
| Embeddings | $TOKENPROXY_URL/skills/tokenproxy-embeddings/SKILL.md |
| Web search | $TOKENPROXY_URL/skills/tokenproxy-web-search/SKILL.md |
| Web fetch (URL → markdown) | $TOKENPROXY_URL/skills/tokenproxy-web-fetch/SKILL.md |

## Errors

- 401 → set/refresh `TOKENPROXY_KEY` (Dashboard → Keys)
- 400 `Invalid model format` → check `model` exists in `/v1/models/<kind>`
- 503 `All accounts unavailable` → wait `retry-after` or add another provider account
