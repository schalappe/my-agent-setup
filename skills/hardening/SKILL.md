---
name: hardening
description: Build-time hardening for code that handles untrusted input, auth, secrets, money-moving writes, destructive file operations, dependencies, or LLM output. Use when writing or changing such code; to review a finished diff, use the review skills.
---

# Hardening

## Threat model first

Think as the attacker before adding controls:

1. **Map trust boundaries**: HTTP requests, uploads, webhooks, third-party APIs, queues, LLM output, and local values that only look internal: another process's command line or environment, filenames on a shared volume, a path in a job payload. Trust follows who _wrote_ a value, not the channel that delivered it.
2. **Name the assets**: credentials, personal data, payment data, admin actions, money movement.
3. **Run STRIDE over each boundary**:

| Threat                 | Ask                                    | Typical mitigation                          |
| ---------------------- | -------------------------------------- | ------------------------------------------- |
| Spoofing               | Can someone impersonate a user/service? | Authentication, signature verification      |
| Tampering              | Can data change in transit or at rest? | Integrity checks, parameterized queries, TLS |
| Repudiation            | Can an action be denied later?         | Audit log of security events                |
| Information disclosure | Can data leak?                         | Encryption, field allowlists, generic errors |
| Denial of service      | Can it be overwhelmed?                 | Size caps, timeouts, rate limits            |
| Elevation of privilege | Can a user gain rights?                | Per-resource authorization, least privilege |

4. **Write the abuse case next to the use case** and make it the first test.

## Rule tiers

**Always:**

- Validate external input at the boundary with a schema; downstream code uses only the parsed value.
- Parameterize every SQL, NoSQL, and shell call.
- Encode output through the framework's auto-escaping; sanitize with an allowlist when raw HTML is unavoidable.
- Check authorization per resource on every request: the caller must own or be granted _this_ record, not merely be logged in.
- Hash passwords with argon2, scrypt, or bcrypt. Session cookies are `httpOnly`, `secure`, `sameSite`. Send security headers (CSP, HSTS); CORS uses an explicit origin list from config.
- Return generic error bodies; internals go to server logs.
- Read required config and secrets at startup and fail loudly when one is missing; a fallback value hides a broken deploy.

**Decide with the user** (security decisions are theirs, per AGENTS.md): new or changed auth flows, a new category of sensitive data, a new external integration, CORS changes, upload handlers, elevated roles or permissions.

**Never:**

- Commit secrets, or log passwords, tokens, or full card numbers.
- Treat client-side validation as a security boundary.
- Pass untrusted data to `eval`, `innerHTML`, a shell, or a file path.
- Keep auth tokens in client-readable storage such as `localStorage`.

## Server-side fetches (SSRF)

User-influenced URLs (webhooks, imports, previews) can target internal services. Allowlist scheme and host, resolve **all** DNS records and reject private, loopback, link-local (`169.254.169.254`), and unique-local addresses for IPv4 and IPv6, and forbid redirects. On high-risk surfaces, pin the resolved IP to close the DNS-rebinding gap.

## Destructive operations on derived paths

A delete, move, or overwrite is only as safe as the value naming its target. A shape check proves well-formedness, not authorization. Before the call, require all three: the resolved target (symlinks resolved) sits under an **allowlisted root**; it is at least one level **below** that root; and it carries **ownership evidence read before the operation**. On refusal, log the rejected target and stop, without widening to a broader default path.

## Secrets

Secrets come from the environment or a secret manager. Commit `.env.example` with placeholders; gitignore real `.env*` files and key material; grep the staged diff before committing. A secret that reaches a remote is compromised the moment it lands: **rotate first, then purge history**.

## Dependencies

- Block install scripts on first install; read them, then approve the minimum.
- Run the package manager's native audit against the committed lockfile and triage critical/high findings by **reachability** (runtime, build, test, deploy).
- An audit matches only known advisories. It misses typosquats and freshly malicious releases, so review each new dependency's owner, age, maintenance, and transitive graph.

## Money-moving writes

- **Derive the idempotency key from the intent, not the attempt**. It comes from the client or the initiating event (`charge:v1:${orderId}`), never the retrying layer. A per-attempt UUID or timestamp makes each retry a new charge; `${userId}:${amount}` merges two legitimate ones.
- **Claim the key atomically** through a unique constraint. Check-then-act is a race.
- **Same key, different payload** is a client bug: reject with 422.
- **Decide what an in-flight duplicate gets**: 409, a bounded wait, or 202 with a status URL. A stalled first attempt never lets the second through.
- **Three outcomes, not two: success, failure, unknown.** A timeout says nothing about whether the effect applied. Record the intent before calling out, so a crash leaves a record to reconcile instead of a silent double charge. Keep these three states distinct in code and responses.
- **Retain keys for the longest retry chain**, including dead-letter replays and provider dispute windows.

```typescript
try {
  await db.insert({ key, state: "in_progress", requestHash });
} catch (e) {
  if (isUniqueViolation(e)) return replayOrReject(key, requestHash); // 422 on hash mismatch
  throw e;
}
const result = await provider.charge(amount, { idempotencyKey: key }); // may end "unknown"
await db.update({ key, state: "succeeded", response: result });
```

## LLM features

- **Model output is untrusted input.** Schema-validate and encode it before it reaches SQL, a shell, the DOM, `eval`, or a path.
- **Prompts can be hijacked** by any untrusted text in context. The system prompt is not a security boundary: enforce permissions in code.
- Keep secrets, other tenants' data, and the full system prompt out of the context. Scope tools, validate their arguments, confirm destructive calls, cap tokens and recursion.

## Personal data

Collect each field against a stated purpose. Build a working deletion path (stores, caches, backups, analytics copies); retention and regulatory rules are the user's decision.

## Verification

- [ ] Trust boundaries and STRIDE threats named; abuse cases have tests.
- [ ] Every external input is schema-validated at the boundary; queries are parameterized.
- [ ] Every protected route checks authentication and per-resource authorization.
- [ ] Missing config or secrets fail at startup; no secret in source, logs, or history.
- [ ] Error responses expose no internals.
- [ ] Server-side fetches pass the SSRF allowlist and private-address check.
- [ ] Destructive operations check allowlisted root, depth, and ownership on the resolved path.
- [ ] Money-moving writes: intent-derived key, atomic claim, 422 on payload mismatch, unknown outcome recorded.
- [ ] Dependency audit has no reachable unmitigated critical/high finding; install scripts reviewed.
- [ ] LLM output validated and encoded before use.
