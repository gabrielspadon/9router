# TokenProxy - FREE AI Router & Token Saver

**Never stop coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

**Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 40+ AI Providers & 100+ Models.**

---

## 🤔 Why TokenProxy?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)

**TokenProxy solves this:**

- ✅ **RTK Token Saver** - Auto-compress tool_result, save 20-40% tokens
- ✅ **Maximize subscriptions** - Track quota, use every bit before reset
- ✅ **Auto fallback** - Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** - Round-robin between accounts per provider
- ✅ **Universal** - Works with any OpenAI/Claude-compatible CLI

---

## ⚡ Quick Start

**Option 1 — npm (recommended for desktop):**

```bash
npm install -g tokenproxy
tokenproxy

# Or run directly with npx
npx tokenproxy
```

**Option 2 — Docker (server/VPS):**

```bash
docker run -d --name tokenproxy -p 127.0.0.1:20128:20128 \
  -v "$HOME/.tokenproxy:/app/data" -e DATA_DIR=/app/data \
  tokenproxy:latest
```

🎉 Dashboard opens at `http://localhost:20128`

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (free Claude unlimited) or **OpenCode Free** (no auth) → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with FREE AI models.

---

## 🚀 CLI Options

```bash
tokenproxy                    # Start with default settings
tokenproxy --port 8080        # Custom port
tokenproxy --no-browser       # Don't open browser
tokenproxy --skip-update      # Skip auto-update check
tokenproxy --help             # Show all options
```

**Dashboard**: `http://localhost:20128/dashboard`

### Memory limit

The server process starts with a 6 GB V8 heap cap. On a memory-limited host
(systemd `MemoryMax`, `docker --memory`, k8s limits) lower it so the garbage
collector feels the limit before the kernel does:

```bash
TOKENPROXY_MAX_OLD_SPACE_SIZE=384 tokenproxy   # cap the heap at 384 MB
TOKENPROXY_MAX_OLD_SPACE_SIZE=0 tokenproxy     # no cap — let node size it
```

`NODE_OPTIONS=--max-old-space-size=…` is honored too, and takes effect only
because TokenProxy stops passing its own default when you set one.

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.tokenproxy/db/data.sqlite`
- **Windows**: `%APPDATA%/tokenproxy/db/data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.tokenproxy` to persist)

---

## 📚 Documentation

Full docs, advanced setup and the development guide ship in this repository:
see the root `README.md` and the `docs/` directory.

---

## 🙏 Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
