# PM Delivery Steward

PM Delivery Steward is a local, evidence-grounded workspace for Project Managers and Scrum Masters. It helps turn recorded work-item updates, meeting notes, milestones, and follow-ups into clear daily triage and reviewable stakeholder communication.

It is intentionally a **single-user local application**. It is not a hosted multi-user platform, Jira replacement, or system for automatically sending communications.

## Why it is different

Large delivery and PPM products usually optimize for enterprise administration, integrations, reporting governance, and shared workflows. Delivery Steward focuses on the hands-on PM workflow: what needs attention today, what evidence changed, and what can be communicated without inventing project facts.

- Runs on your machine and binds to `127.0.0.1` only.
- Stores data locally in JSON files; no database or account is required.
- Keeps DSU evidence extraction deterministic.
- Offers optional AI drafting for status summaries and Teams messages, always as reviewable output.

## Quick Start

Requirements: Node.js 20 or newer.

```bash
npm ci
npm start
```

Open `http://127.0.0.1:3000`.

If port 3000 is already in use, start the app on another local port, for example: `PORT=3001 npm start`.

On first run, the app copies the fictional example from `data/demo-data.json` to the ignored local file `data/pilot-data.json`.

## Optional AI Drafting

The app works without AI. To enable optional AI drafts:

```bash
cp .env.example .env
```

Add either an OpenAI or Anthropic API key to `.env`, then restart the app. Keys remain on your local server and are never sent to the browser. AI drafts must be reviewed before copying or sending.

## Privacy and Security

- Do not commit `.env`, `data/pilot-data.json`, or `data/uploads/`.
- The included data is fictional demo content only.
- This release is designed for local use, not public deployment. It has no authentication or multi-user access control.
- Use only data you are authorized to store and send to any configured AI provider.

## Commands

```bash
npm start   # Run the local server
npm test    # Syntax and release checks
npm audit   # Check known production dependency vulnerabilities
```

## Project Layout

```text
data/demo-data.json  Fictional tracked demo data
public/              Browser application and local font assets
server.js            Express server and local APIs
.env.example         Optional AI configuration template
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before opening an issue or pull request.

## License

This project is licensed under the [MIT License](LICENSE). The bundled IBM Plex fonts are covered separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
