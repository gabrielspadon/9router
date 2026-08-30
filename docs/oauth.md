# OAuth connections

An OAuth provider is connected once through a browser login and then refreshed
in the background, so there is no key to paste and nothing to rotate by hand.
This page describes each flow, where the resulting tokens live, and when they
are refreshed.

Every flow starts the same way, from Providers in the dashboard. Pick the
provider, choose the authentication method where one is offered, and complete
the login in the browser window that opens.

The implementations live in `src/lib/oauth/services/`, one file per provider,
and the shared helpers they use are in `src/lib/oauth/utils/`.

## Flow shapes in use

Not every upstream uses the same protocol. Four shapes are implemented.

Authorization code with a local callback listener is the most common. 9Router
starts a short-lived HTTP server on loopback, opens the provider's consent page,
and waits for the provider to redirect back to it with a code, which is then
exchanged for tokens. Codex, Antigravity, Gemini, iFlow and xAI use this shape.
Codex and xAI add PKCE.

Device code flow is used where the provider prefers a code you approve in a
separate browser session rather than a redirect. GitHub Copilot, Kiro's AWS
methods and Qoder use this shape.

Direct callback token is used by Kimchi, where the token arrives on the callback
query string itself. There is no authorization-code exchange and no PKCE.

Token import is used where the provider has no public OAuth client. Cursor is
read out of the Cursor IDE's own local database, and Kiro accepts a manually
pasted refresh token as a fallback.

## Claude Code

Connect the provider and complete the Anthropic login in the browser. The
connection carries the same 5 hour and weekly quota windows as the subscription
itself, and the dashboard tracks both.

Models are addressed with the `cc/` prefix. Quota is tracked per model, so an
exhausted Opus window does not hide a still-available Sonnet window.

## OpenAI Codex

Codex uses authorization code with PKCE and a fixed loopback callback port,
1455, which is the port the real Codex CLI registers with OpenAI. If something
else on the machine already holds 1455 the callback cannot land, so free it
before starting the login.

Models are addressed with the `cx/` prefix. Reset windows are 5 hour and weekly.

## GitHub Copilot

GitHub Copilot uses the device code flow. 9Router shows a user code, you open
GitHub's device page, paste the code, and approve. No callback port is involved,
which makes this the flow that survives a locked-down network best.

Models are addressed with the `gh/` prefix and the quota resets monthly.

## Cursor

Cursor has no public OAuth client, so the connection imports the token that the
Cursor IDE already holds locally, from its SQLite state database:

| Platform | Path |
| -- | -- |
| Linux | `~/.config/Cursor/User/globalStorage/state.vscdb` |
| macOS | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
| Windows | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` |

The access token is stored under the `cursorAuth/accessToken` key. Sign in to
Cursor IDE at least once before importing, otherwise the key is absent.

Models are addressed with the `cu/` prefix.

## Kiro

Kiro offers four methods and the dashboard asks which one to use.

AWS Builder ID uses a device code flow and is the simplest, needing only a free
AWS Builder ID.

AWS IAM Identity Center also uses a device code flow, and additionally needs the
start URL and the AWS region of your Identity Center instance. The region is
validated against the standard AWS region pattern before anything is sent, so a
typo is rejected locally rather than by a confusing upstream error.

Google and GitHub social login uses an authorization code flow against
`prod.us-east-1.auth.desktop.kiro.dev` with a manual callback step.

Import token accepts a refresh token pasted by hand, for the case where none of
the interactive methods can complete.

Models are addressed with the `kr/` prefix. The free tier is capped, see
[providers.md](providers.md).

## Antigravity

A standard OAuth2 authorization code flow with a local callback listener,
structurally the same as the Gemini flow. Antigravity replaced Gemini CLI after
Google shut that service down in June 2026.

## Gemini CLI

An authorization code flow without PKCE, against Google Cloud Code Assist.

The Gemini CLI service itself was shut down by Google on 2026-06-18. The flow
remains implemented for existing connections but should not be planned around
for new work. Use Vertex AI, described in [providers.md](providers.md), or
Antigravity.

## Kimchi

A browser login ported from the Kimchi CLI. The token arrives directly on the
callback query string, so there is no code exchange step. In-flight logins are
held server-side keyed by the OAuth `state` value while the dashboard polls for
completion.

## xAI

Authorization code with PKCE and a local callback listener. The endpoint
discovery step reaches out to xAI before the login can start, so this flow fails
on a machine with no outbound access to xAI.

## iFlow

Authorization code with HTTP Basic authentication on the token exchange. iFlow
moved from a free tier to paid during 2026, so a working connection is no longer
a free one.

## Qoder

A device token flow. 9Router generates a PKCE pair, a nonce and a machine id
locally, then opens the Qoder account selection page carrying the challenge and
nonce, and polls for the token.

## Where tokens are stored

Tokens are written to the connections table in the local SQLite database at
`$DATA_DIR/db/data.sqlite`, encrypted at rest. The encryption key is derived
from the machine by default, which means a database copied to another machine
cannot be decrypted there. Set `DB_ENCRYPTION_KEY` explicitly if the data
directory has to move between machines, and set it before the connections are
created.

## When tokens are refreshed

Two mechanisms cover expiry.

On the request path, a connection whose token is within the provider's own lead
time of expiring is refreshed before the request is dispatched, so a call never
goes out on a token that is about to die.

A background scheduler in `src/sse/services/backgroundTokenRefresh.js` also
sweeps every connection on an interval, refreshing anything expiring within the
larger of the provider's on-request lead time and its own 30 minute lead. It
starts 10 seconds after the server boots and then runs every 5 minutes. In a
standalone build it is started by `custom-server.js` as well as by the Next.js
app, and the second start is a no-op.

A refresh that fails does not silently degrade. The connection is marked in the
dashboard and reconnecting it is the fix, which for most providers means
repeating the browser login on this page.

## When a connection stops working

See [troubleshooting.md](troubleshooting.md), which covers expired tokens,
callback ports already in use, and connections that authenticate but return no
models.
