# Changelog

All notable changes to this project are documented here.

## 1.0.2 - 2026-07-15

- Required DSU matches to identify a work item within the same evidence segment, preventing unrelated sentences from being saved as a work-item update.
- Replaced substring-based status inference with exact canonical matching so values such as `incomplete`, `not done`, and `unresolved` are not treated as complete.
- Treated materially future comment timestamps as invalid freshness evidence so imports cannot suppress stale-comment warnings.
- Reworked optional AI report and Teams flows around structured untrusted inputs, JSON-only exact source citations, server-side claim validation, and deterministic fallback.
- Removed the retired free-form AI extraction path so DSU extraction cannot accidentally bypass deterministic evidence matching.
- Made upload and delete operations rollback-safe across JSON and stored files, with startup recovery for interrupted deletes and cleanup for incomplete uploads.
- Preserved every DSU source reference during deduplication and recalculated derived evidence dates whenever a source or update is deleted.
- Treated date-only values as local calendar dates for milestone health, form defaults, sorting, and display.
- Added explicit request schemas, field-size limits, controlled status/type values, and milestone-reference checks for persisted records.
- Fixed canonical project selection, Workspace Data Story editing, Follow-Up badge routing, mutation error handling, and safe download links for reference files.
- Escaped Settings search values and raw HTML in Markdown exports.
- Added regression coverage for evidence integrity, storage rollback/recovery, date-only behavior, request validation, UI/API contracts, artifact injection, and prompt-injection payloads.

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
