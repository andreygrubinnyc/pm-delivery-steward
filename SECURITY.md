# Security Policy

## Supported Version

Security fixes are made on the latest released version.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability. Contact the repository owner privately with a clear description, reproduction steps, affected version, and potential impact.

## Deployment Boundary

PM Delivery Steward is a local, single-user tool. It binds to loopback only and is not designed to be exposed to a network or hosted for multiple users. A hosted version requires authentication, authorization, CSRF protection, rate limits, and a separate security review.
