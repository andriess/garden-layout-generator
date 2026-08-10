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
   set Source to **GitHub Actions**. The included workflow
   (`.github/workflows/deploy.yml`) will then build and deploy automatically
   on every push to `main` — no further setup needed. First deploy takes a
   minute or two; check the Actions tab for progress.

4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.

## Local development

```bash
npm install
npm run dev       # local dev server
npm run build     # production build -> dist/
```
