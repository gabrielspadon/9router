# 9Router documentation

Everything under `docs/` is indexed here. The front page is
[../README.md](../README.md), which is deliberately short; the long form lives on
these pages.

## Start here

- [getting-started.md](getting-started.md). Installing from npm or from source,
  the ports each path actually listens on, first login, connecting a CLI tool,
  addressing models and combos, and the HTTP surface.
- [providers.md](providers.md). What each upstream family needs, what it costs,
  the free tiers and their real caps, self-hosted speech and embedding
  endpoints, and combos worth copying.
- [oauth.md](oauth.md). Every browser login flow, where the tokens are stored,
  and when they are refreshed.
- [token-saver.md](token-saver.md). RTK, Headroom, Caveman, Ponytail, PXPIPE,
  progressive tool disclosure and the memory optimiser, as implemented.
- [troubleshooting.md](troubleshooting.md). Symptoms first, with the cause and
  the fix for each.
- [deployment.md](deployment.md). Servers, process managers, reverse proxies,
  SAML and OIDC single sign-on, the environment contract, where state lives,
  backup and upgrade.

Container operation is in [../DOCKER.md](../DOCKER.md).

## Reference

- [ARCHITECTURE.md](ARCHITECTURE.md). The system in full. Request lifecycle,
  combo and account fallback, OAuth and token refresh, cloud sync, the data
  model, module map, failure modes and security boundaries. Read this before
  changing routing behaviour.
- [MEMORY_OPTIMIZATION.md](MEMORY_OPTIMIZATION.md). The AI memory and token
  optimiser, its modules, phases and defaults.
- [design/](design/). The design record: the rules the interface obeys, the
  three structural hypotheses and why one won, the areas deliberately left
  alone, and the measured evidence behind every design claim. Start at
  [design/design-system.md](design/design-system.md).
- [design/progressive-tool-disclosure.md](design/progressive-tool-disclosure.md).
  Why tool schemas dominate a multi-turn agent prompt, and the two-phase filter
  and BM25 selection that prunes them.

The engine's own conventions, including how to add a provider, an executor or a
translator, are in `open-sse/AGENTS.md` beside the code.



## Conventions for this directory

A page in the top level of `docs/` is documentation and is expected to stay
correct. A page under `superpowers/` is a working document tied to one change
and is not updated afterwards. An `analysis-` or `plan-` prefix marks a dated
investigation, which carries its date in its own header.

When a page states a number that will drift, such as how many providers ship or
how many tests pass, it cites the command that produces the number instead of
recording the number.
