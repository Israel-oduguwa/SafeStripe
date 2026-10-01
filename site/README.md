# Website

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

The landing page currently says the unscoped package name is awaiting publication. After safestripe is published and verified by a clean registry install, update that note in site/index.html and remove the corresponding release-preview note from README.md. Keep the previous npm package available for existing consumers.

The demo remains a separate local application. A static host cannot run its Firestore worker or Express server.
