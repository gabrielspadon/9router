# TokenProxy — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use TokenProxy for you.

> Tip: start with the **tokenproxy** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | $TOKENPROXY_URL/skills/tokenproxy/SKILL.md |
| Chat / code-gen | $TOKENPROXY_URL/skills/tokenproxy-chat/SKILL.md |
| Image generation | $TOKENPROXY_URL/skills/tokenproxy-image/SKILL.md |
| Video generation (xAI Grok Imagine) | $TOKENPROXY_URL/skills/tokenproxy-video/SKILL.md |
| Text-to-speech | $TOKENPROXY_URL/skills/tokenproxy-tts/SKILL.md |
| Speech-to-text | $TOKENPROXY_URL/skills/tokenproxy-stt/SKILL.md |
| Embeddings | $TOKENPROXY_URL/skills/tokenproxy-embeddings/SKILL.md |
| Web search | $TOKENPROXY_URL/skills/tokenproxy-web-search/SKILL.md |
| Web fetch (URL → markdown) | $TOKENPROXY_URL/skills/tokenproxy-web-fetch/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: $TOKENPROXY_URL/skills/tokenproxy/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export TOKENPROXY_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export TOKENPROXY_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $TOKENPROXY_URL/api/health` → `{"ok":true}`.

## Links

- Dashboard: `$TOKENPROXY_URL/dashboard`
