import { defineConfig } from "vite";

// Base path: deployed to https://<user>.github.io/2048/
// (project root of a dedicated 2048 repository).
export default defineConfig({
  base: "/2048/",
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
  },
  worker: {
    format: "es",
  },
});
