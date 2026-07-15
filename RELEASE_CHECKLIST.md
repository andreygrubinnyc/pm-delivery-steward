# Release Checklist

Complete these checks from a normal internet-connected terminal before creating the GitHub release.

- Move the `Unreleased` changelog entries under the intended version and date, and make `package.json` use the same version.
- Confirm `git status --ignored` shows no `.env`, `data/pilot-data.json`, or `data/uploads/` files ready to commit.
- Run a clean `npm ci --ignore-scripts`, `npm test`, `npm audit --omit=dev`, and `npm audit signatures`.
- Open the app at `http://127.0.0.1:3000` and verify the fictional Northstar demo project loads.
- In a disposable copy, create/edit/delete a work item and milestone, upload and download one non-sensitive file, delete it, and confirm both its metadata and stored file are removed.
- Verify a milestone dated today is not classified as overdue in a non-UTC timezone.
- Verify invalid JSON field types and unknown fields return a clear `400` without changing saved data.
- Search the staged release for real names, work-item IDs, customer/company data, API keys, and local paths.
- Review production dependency advisories, registry signatures, the resolved dependency tree, CI, and CodeQL results.
- Review the repository name, description, and trademark/branding permissions before publishing.
- Read `SECURITY.md`, `CONTRIBUTING.md`, and `THIRD_PARTY_NOTICES.md`.

## Publish

```bash
git add .
git diff --cached --check
git commit -m "Release vX.Y.Z"
git push -u origin main
git tag -a vX.Y.Z -m "PM Delivery Steward vX.Y.Z"
git push origin vX.Y.Z
```

Create the GitHub release from the new tag, use the matching entry in `CHANGELOG.md` as release notes, and wait for CI and CodeQL to complete before sharing the repository. Confirm the dependency advisory and signature checks above are still clean at that exact tag.
