# Version 1.0 Release Checklist

Complete these checks from a normal internet-connected terminal before creating the GitHub release.

- Confirm `git status --ignored` shows no `.env`, `data/pilot-data.json`, or `data/uploads/` files ready to commit.
- Run `npm ci`, `npm test`, and `npm audit --omit=dev`.
- Open the app at `http://127.0.0.1:3000` and verify the fictional Northstar demo project loads.
- Upload one non-sensitive text file and confirm it appears only in `data/uploads/`, which Git ignores.
- Search the staged release for real names, work-item IDs, customer/company data, API keys, and local paths.
- Review the repository name, description, and trademark/branding permissions before publishing.
- Read `SECURITY.md`, `CONTRIBUTING.md`, and `THIRD_PARTY_NOTICES.md`.

## Publish

```bash
git add .
git diff --cached --check
git commit -m "Release v1.0.0"
git remote add origin https://github.com/YOUR-ACCOUNT/pm-delivery-steward.git
git push -u origin main
git tag -a v1.0.0 -m "PM Delivery Steward v1.0.0"
git push origin v1.0.0
```

Create the GitHub release from the `v1.0.0` tag, use the entry in `CHANGELOG.md` as release notes, and wait for the CI and CodeQL checks to complete before sharing the repository.
