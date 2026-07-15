# Changelog

All notable changes to this project are documented here.

## 1.0.1 - 2026-07-14

- Replaced timestamp-based persistent identifiers with UUIDs to prevent concurrent create collisions.
- Added bounded AI-provider requests (45 seconds by default), cancellation, and clear 504/502 error responses.
- Restricted Anthropic API-key delivery to Anthropic's official HTTPS Messages endpoint.
- Enforced the 20 MB multipart limit over the entire request, including fields and multipart framing; upload fields are limited to 256 KB.
- Kept create/edit forms open when a save fails and display the server error instead of presenting unsaved local state as saved.
- Added targeted regression coverage for unique identifiers, provider timeouts, and Anthropic endpoint validation.

## 1.0.0 - 2026-07-14

- First public release of the local delivery workspace.
- Added fictional demo data and safe local data paths.
- Added optional, review-only AI drafting for status summaries and Teams drafts.
- Kept DSU evidence extraction deterministic.
- Added release documentation, security guidance, CI, and repository hygiene controls.
- Hardened upload handling, response headers, error responses, and copy controls.
- Enforced loopback Host and same-origin checks for browser-initiated state changes.
- Limited aggregate multipart upload buffering to 20 MB per request.
- Neutralized spreadsheet formula prefixes in CSV exports.
- Rejected reserved object keys to prevent prototype pollution.
- Added global and upload-specific rate limiting.
- Completed Markdown export escaping for backslashes, pipes, and line breaks.
- Added focused security regression tests.
