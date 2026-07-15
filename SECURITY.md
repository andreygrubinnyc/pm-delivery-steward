# Security Policy

## Supported Version

Security fixes are made on the latest released version.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability. Contact the repository owner privately with a clear description, reproduction steps, affected version, and potential impact.

## Deployment Boundary

PM Delivery Steward is a local, single-user tool. It binds to loopback only and is not designed to be exposed to a network or hosted for multiple users. A hosted version requires authentication, authorization, CSRF protection, rate limits, and a separate security review.

## AI Trust Boundary

AI is optional. Project records are sent to the configured provider as untrusted structured source data. The model may only select exact excerpts with existing source IDs; the local server validates every selected excerpt and falls back to deterministic output when the response is malformed or unsupported. The app never sends generated communication automatically.

## Local Data Integrity

Mutation requests are validated against explicit schemas before persistence. JSON changes use atomic replacement, and transcript upload/delete operations use staging plus rollback; startup reconciliation repairs an interrupted delete or removes an incomplete orphaned upload. Reference-file links are restricted to server-generated local upload paths.
