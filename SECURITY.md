# Security Policy

9Router is a locally hosted gateway. It stores provider API keys, OAuth access
tokens and refresh tokens in a SQLite database on the operator's own machine,
and it proxies that operator's traffic to upstream providers. A defect here
exposes credentials and conversation content, so vulnerability reports are
handled privately.

## Reporting a vulnerability

Report privately through GitHub security advisories.

**<https://github.com/gabrielspadon/9router/security/advisories/new>**

Do not open a public issue, a discussion or a pull request for a suspected
vulnerability. A public report is visible to everyone the moment it is filed,
including before a fix exists, and every operator running the affected version
is exposed for as long as that window stays open. If you have already opened
one, say so in the advisory rather than adding detail to the public thread.

A useful report contains the affected version from `package.json` or
`cli/package.json`, the deployment shape (loopback only, reverse proxy, exposed
port, container), the steps to reproduce, and what an attacker gains. Redact
credential values. A key prefix and its length prove the finding; the key itself
only creates a second incident.

If you cannot use GitHub advisories, open a public issue that says only that you
have a security report and asks for a private channel. Put no detail in it.

## What we do with a report

You should get an acknowledgement within 5 working days and an assessment,
including whether the report is accepted and a rough remediation window, within
10 working days. This is a small project maintained in spare time, not a funded
security team; if a deadline passes without a word, a reminder on the advisory
is welcome and is not a nuisance.

Disclosure is coordinated. A fix and a released version come first, then a
public advisory crediting the reporter unless anonymity is requested. If you
plan to publish independently, tell us the date in the advisory so the fix and
the writeup do not miss each other. We will not ask for indefinite silence, and
we will not treat a good-faith report as an attack.

## Scope

9Router runs on the operator's machine and is trusted with live provider
credentials. The following are in scope.

- **Credential storage at rest.** Provider access tokens, refresh tokens and API
  keys are encrypted in the local SQLite database under `DATA_DIR`, by default
  `~/.9router/`, using a machine-derived key that `DB_ENCRYPTION_KEY` can
  override. Weaknesses in that encryption, key derivation, or any path that
  writes a secret in plaintext are in scope.
- **Credential leakage through an outbound path.** A token for one provider sent
  to another, a secret reaching a log, a request-detail view, an error body, a
  usage record, a cloud sync payload or an API response.
- **Session and dashboard authentication.** `JWT_SECRET` signs the session
  cookie. Forging a session, bypassing login, fixing a session, or escalating
  from an unauthenticated request to a dashboard action are all in scope.
- **Gateway authorization.** `src/dashboardGuard.js` lets a request through to
  `/v1` and the other public LLM prefixes when it is local, or carries a valid
  CLI token, or carries a valid issued API key. Reaching those routes without one
  of the three, or having a remote request judged local, is in scope. So is
  reaching a local-only route from off the machine.
- **API key handling.** An issued key has the form
  `sk-{machineId}-{keyId}-{crc8}`, where the trailing 8 characters are an
  HMAC-SHA256 checksum keyed by `API_KEY_SECRET`. That checksum is a validity
  check, not the authorization itself, which is a lookup of the stored key.
  Minting a key that both passes the checksum and is accepted, recovering a key
  from stored material, or authenticating with a revoked key, is in scope.
- **The `INITIAL_PASSWORD` default.** The default is `123456`. Login already
  refuses a remote sign-in while that default is unchanged and no
  `INITIAL_PASSWORD` is set, so the password has to be changed from the local
  machine first. Any path around that refusal, or that treats an unchanged
  password as configured, is in scope.
- **The loopback trust boundary.** `custom-server.js` derives the client IP from
  the TCP socket, deletes any inbound `X-Forwarded-For` and the internal
  `x-9r-real-ip`, `x-9r-via-proxy` and `x-9r-peer-token` headers, then restamps
  them itself. A forwarding header is believed only when the TCP peer is
  loopback. Any way to have an attacker-supplied header believed from a
  non-loopback peer, or to spoof the per-process peer token, is in scope. So is
  any way to reach the dashboard through the API-only listener when `API_PORT`
  is set to split it off.
- **SSRF and request forgery through provider configuration**, where a
  self-hosted or custom provider URL reaches an address the operator did not
  intend, particularly cloud metadata endpoints.
- **`MACHINE_ID_SALT`**, where a weakness in the machine identity it salts lets
  one installation impersonate another to the cloud sync service.
- **Dependency vulnerabilities** that are reachable from a normal deployment.
  Reachability matters more than a scanner's severity number.

## Out of scope

- An instance the operator has deliberately bound to a public interface without
  authentication in front of it. Exposing the port is a deployment decision, and
  the hardening notes below say not to.
- An attacker who already has read access to the operator's filesystem or user
  account. At-rest encryption raises the cost of a stolen database file; it is
  not a defence against code running as the operator.
- Behaviour of an upstream provider, including its rate limits, its content
  filtering, and vulnerabilities in its API. Report those to that provider.
  9Router forwarding an upstream response faithfully is not a 9Router defect.
- Missing hardening headers, cookie flags, or TLS on a loopback-only deployment
  where no exploit follows. `AUTH_COOKIE_SECURE` exists for deployments behind
  HTTPS and defaults off for loopback use.
- Denial of service by an operator against their own instance, volumetric
  flooding, and load generated by the operator's own clients.
- Reports produced by a scanner with no demonstrated impact, missing best
  practices with no exploit path, and social engineering of the maintainer.
- Anything requiring a modified 9Router build or a physically compromised host.

## Hardening notes for operators

Every variable named below is verified against `.env.example`, which is the
environment contract, except `API_PORT` and `API_HOSTNAME`, which are read in
`custom-server.js`.

- **Override `INITIAL_PASSWORD`.** The default is `123456`. Change it before the
  instance is reachable by anything other than you.
- **Set `JWT_SECRET`** to a long random value. It signs the dashboard session
  cookie, and a guessable value means forgeable sessions.
- **Set `API_KEY_SECRET`** to a long random value. It protects the gateway API
  keys the dashboard issues.
- **Set `MACHINE_ID_SALT`** to a value of your own rather than keeping a shared
  one.
- **Consider `DB_ENCRYPTION_KEY`** if the database must stay readable after
  moving `DATA_DIR` to another machine. Setting it replaces the machine-derived
  key, so it becomes the secret that protects every stored provider credential.
  Treat it accordingly and back it up separately from the database.
- **Do not expose the port to an untrusted network.** 9Router is designed for
  loopback and a trusted LAN. If it must be reachable remotely, put it behind a
  reverse proxy or a private tunnel that terminates TLS and authenticates first,
  and run that proxy on the same host so the loopback trust boundary in
  `custom-server.js` still holds.
- **Split the API off the dashboard** with `API_PORT` when only `/v1` needs to
  be reachable. `API_HOSTNAME` defaults to `127.0.0.1`; widen it deliberately.
- **Set `AUTH_COOKIE_SECURE=true`** whenever the dashboard is served over HTTPS.
- **Know what actually gates `/v1`.** A request from loopback is let through with
  no key. A request from anywhere else needs a valid CLI token or an API key
  issued in the dashboard. There is no switch that turns the loopback exemption
  off, which is why the reverse proxy has to run on the same host and why
  `X-Forwarded-For` handling is load-bearing rather than cosmetic.
- **Do not rely on `REQUIRE_API_KEY`.** It appears in `.env.example` and in the
  deployment documentation, but no code reads it, so setting it enforces
  nothing. This is tracked as upstream issue #2834 and is on the list to fix.
- **Keep `ENABLE_REQUEST_LOGS` off** unless you need it. Request logs and
  `~/.9router/log.txt` contain prompt and response content.
- **Treat `DATA_DIR` as secret material.** Back it up encrypted, and do not
  attach it to a bug report.

## Supported versions

Fixes land on `master` and go out in the next release of both the
`9router-app` server and the `9router` CLI package. Only the latest release is
supported. Upgrade before reporting a defect against an older one.
