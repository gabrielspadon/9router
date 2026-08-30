# Support

9Router is maintained by volunteers. Picking the right channel is what gets an
answer quickly.

## Where to go

| You want to | Go to |
| --- | --- |
| Ask how to do something, or check whether behaviour is expected | [Discussions](../../discussions) |
| Report something broken and reproducible | [Bug report](../../issues/new?template=bug_report.yml) |
| Ask for a new upstream provider | [Provider request](../../issues/new?template=provider_request.yml) |
| Propose a feature or a change | [Feature request](../../issues/new?template=feature_request.yml) |
| Report a vulnerability | The private route in [SECURITY.md](SECURITY.md). Never a public issue |
| Change the code yourself | [CONTRIBUTING.md](CONTRIBUTING.md) |

Read the [README](README.md) and the documentation site first. Setup, provider
support and the deployment options are covered there, and a question already
answered in the docs waits behind questions that are not.

If you are unsure whether something is a bug, open a discussion. Turning a
discussion into an issue is easy; closing a stream of issues that were really
questions costs the maintainer the time that would have fixed a real one.

## Before you open a bug report

Reproduce it once on the current release. Most reports that arrive on an older
version have already been fixed.

Then narrow it. Whether the same request works against a different provider, or
the same provider works from a different client, is usually the single most
useful sentence in the report.

## What to include

A report that can be reproduced gets fixed. A report that cannot, does not.
Bring the following.

- **Versions.** The `version` field from `package.json` for the server and from
  `cli/package.json` for the CLI. They are versioned independently and can be
  out of step, which is itself sometimes the bug. `9router --version` reports
  the CLI.
- **How you run it.** The npm CLI launcher, `npm run start` from a checkout, or
  Docker; the operating system; the Node version from `node -v`.
- **The provider and the model.** The upstream provider, the exact model
  identifier or combo you routed to, and whether the connection uses an API key
  or OAuth.
- **The client and the request shape.** Which client or CLI tool sent the
  request, which endpoint it hit, whether the request streamed, and whether it
  carried tools, images or a system prompt. Format translation is where most
  defects live, so the inbound format matters as much as the upstream.
- **What happened and what you expected.** The status code and the error body if
  there was one. A hang, a truncated stream and a 500 are three different bugs.
- **The relevant lines of `~/.9router/log.txt`.** The lines around the failure,
  not the whole file. If `DATA_DIR` is set, the database moves with it but the
  logs stay in `~/.9router/`.

## Never paste a credential

Redact before you post. This applies to API keys, OAuth access and refresh
tokens, bearer headers, session cookies, the contents of your SQLite database
under `DATA_DIR`, and anything in `~/.9router/db/`.

`~/.9router/log.txt` can contain prompt and response content, and request
logging can capture headers. Read what you are about to paste. A key prefix and
its length are enough to identify which credential was in play; the key itself
is a second incident.

If you post one by accident, revoke it at the provider immediately. Editing the
comment does not remove it from the edit history, and it does not un-send the
notification email.

## Response expectations

This is a spare-time project. Issues are read, not always answered the same
week. An issue with a clean reproduction moves faster than one without,
regardless of how it is worded.

A pull request that fixes your own report is welcome. Start from
[CONTRIBUTING.md](CONTRIBUTING.md).
