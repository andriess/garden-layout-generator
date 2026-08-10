import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: './' makes the build use relative asset paths, so it works correctly
// on GitHub Pages project sites (https://<user>.github.io/<repo>/) without
// needing to hardcode the repo name here.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
