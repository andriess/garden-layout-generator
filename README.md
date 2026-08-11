# Garden Paving Designer

Interactive tool for laying out organic hex/square/rectangle paving, Voronoi
material zones, boundary-aware paths, and obstacle-avoiding routing around
house/exclusion zones.

## Deploying to GitHub Pages (private repo)

1. **Create the repo** on GitHub (Settings can stay private — Pages works on
   private repos on paid plans; on the free plan the *site* is still public
   once deployed, only the source stays private).

2. **Push this code**:
   ```bash
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```

3. **Enable Pages**: repo → Settings → Pages → under "Build and deployment",
   set Source to **Deploy from a branch**, branch **gh-pages**, folder **/ (root)**.
   The `gh-pages` branch doesn't exist yet — it's created automatically the
   first time `deploy.yml` or `pr-preview.yml` runs, so push to `main` (or
   open a PR) once first, then come back and select it here.

4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.
   The included workflow (`.github/workflows/deploy.yml`) builds and deploys
   it automatically on every push to `main` — no further setup needed. First
   deploy takes a minute or two; check the Actions tab for progress.

### PR previews

Every pull request also gets its own live preview, deployed by
`.github/workflows/pr-preview.yml` to
`https://<your-username>.github.io/<repo-name>/pr-preview/pr-<number>/`. The
workflow posts the link as a comment on the PR once the first build finishes,
updates it on every push to the PR branch, and removes the preview when the
PR closes. It needs the same `gh-pages` branch as the main site (step 3
above) and no extra setup.

## Local development

```bash
npm install
npm run dev       # local dev server
npm run build     # production build -> dist/
```
