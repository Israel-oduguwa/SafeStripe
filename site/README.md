# Website

Public preview: https://israel-oduguwa.github.io/SafeStripe/

The public site is a static landing page and the generated SafeStripe handbook. It has no API server, analytics script or third-party font request.

## Preview locally

~~~bash
npm ci
npm run site:build
npm run site:check
npm run site:preview
~~~

Open http://127.0.0.1:4243. Build output lives in site-dist and is excluded from Git and the npm package. Build again after changing a page, stylesheet or documentation source.

## Publish

Use these settings on a static host:

| Setting | Value |
| --- | --- |
| Node | 22.19 or newer |
| Install | npm ci |
| Build | npm run site:build && npm run site:check |
| Output | site-dist |
| Framework preset | Other / static site |

On Vercel, import the SafeStripe repository and use the supplied vercel.json. The preview server is for local review only; Vercel serves the generated files directly.

On GitHub Pages, enable Pages with GitHub Actions as its source and run the **Publish website** workflow manually. The workflow builds and checks the site before deploying. It is manual so a documentation change does not publish an unfinished release.

The site uses relative links and works from a project subpath. Do not upload the whole repository, .env files, service-account keys or the local demo app.

## Package name transition

The unscoped `safestripe@0.3.0` package is published. A [clean registry installation](../docs/evidence/npm-registry-2026-10-06.json) verified the archive, exports and types before `npmPublished` was set to `true` in `site/release.json`. The copy button now supplies the public install command. The release remains an evaluation preview; publication alone does not change the [readiness requirements](../docs/28-release-readiness.md). Keep the previous npm package available for existing consumers.

The demo is a separate application with a Vercel frontend and a Render Express backend. Its Firestore worker runs on the backend; a static documentation host cannot run it.

## Support link

Set `url` in `support.json` to the maintainer's verified public Buy Me a Coffee creator URL. A null value hides the support button. Both the landing page and offline handbook use this configuration. The build rejects unrelated domains, credentials, query strings and non-HTTPS URLs rather than publishing an incorrect payment destination.

The modal opens only when someone chooses it. It uses a native dialog with Escape dismissal and focus restoration, and links to Buy Me a Coffee in a separate tab. No payment fields, embedded widget or third-party tracking load on SafeStripe's pages.
