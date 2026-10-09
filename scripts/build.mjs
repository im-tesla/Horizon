import { build } from "esbuild";
import { build as viteBuild } from "vite";
await Promise.all([
  build({
    entryPoints: ["src/server/index.ts"],
    outfile: "dist/server/index.mjs",
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    packages: "external",
  }),
  build({
    entryPoints: ["src/desktop/main.ts"],
    outfile: "dist/desktop/main.cjs",
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    packages: "external",
  }),
  build({
    entryPoints: ["src/desktop/preload.ts"],
    outfile: "dist/desktop/preload.cjs",
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["electron"],
  }),
  viteBuild(),
]);
