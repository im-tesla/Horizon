import "dotenv/config";
import path from "node:path";
import { createServer } from "./app";

const { app } = await createServer({
  token: process.env.HORIZON_TOKEN ?? "",
  mediaDir: path.resolve(process.env.HORIZON_MEDIA_DIR ?? "./media"),
  dataDir: path.resolve(process.env.HORIZON_DATA_DIR ?? "./.horizon/server"),
  ffprobe: process.env.HORIZON_FFPROBE || "ffprobe",
  polling: process.env.HORIZON_WATCH_POLLING === "true",
  logger: true,
});
const port = Number(process.env.HORIZON_PORT ?? 8090);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid HORIZON_PORT.");
try {
  await app.listen({ host: process.env.HORIZON_HOST ?? "127.0.0.1", port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
