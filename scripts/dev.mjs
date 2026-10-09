import { spawn } from "node:child_process";
import { build } from "esbuild";
import electron from "electron";
import { prepareMpv } from "./bundle-mpv.mjs";
await prepareMpv();
await Promise.all([
  build({
    entryPoints: ["src/desktop/main.ts"],
    outfile: "dist/desktop/main.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
  }),
  build({
    entryPoints: ["src/desktop/preload.ts"],
    outfile: "dist/desktop/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  }),
]);
const children = [];
const launch = (args, env = process.env) => {
  const child = spawn(process.execPath, args, { stdio: "inherit", env });
  children.push(child);
  return child;
};
launch(["--import", "tsx", "src/server/index.ts"]);
launch(["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"]);
let ready = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    if ((await fetch("http://127.0.0.1:5173")).ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!ready) throw new Error("The development UI did not start.");
const env = { ...process.env, HORIZON_DEV_URL: "http://127.0.0.1:5173" };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = spawn(electron, ["."], { stdio: "inherit", env });
children.push(desktop);
const stop = () => {
  for (const child of children) child.kill();
};
desktop.on("exit", () => {
  stop();
  process.exit();
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
