import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { MediaLibrary, type LibraryOptions } from "./library";
import { parseRange } from "./range";
import { registerWatchTogether } from "./watch-together";

export interface ServerOptions extends LibraryOptions {
  token: string;
  logger?: boolean;
}
export async function createServer(options: ServerOptions) {
  if (options.token.length < 24)
    throw new Error(
      "HORIZON_TOKEN must contain at least 24 characters. Run npm run setup.",
    );
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.x-horizon-room-token",
          ],
        }
      : false,
    exposeHeadRoutes: true,
    bodyLimit: 16384,
  });
  const library = new MediaLibrary(options);
  library.on("watch-error", (error) =>
    app.log.error(error, "Media folder watcher failed"),
  );
  library.on("scan-error", (error) =>
    app.log.error(error, "Media folder scan failed"),
  );
  await library.start();
  await app.register(rateLimit, { global: false });
  const expected = createHash("sha256").update(options.token).digest();
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "private, no-store");
    if (request.routeOptions.url === "/api/health") return;
    const value = request.headers.authorization;
    const supplied =
      typeof value === "string" && value.startsWith("Bearer ")
        ? value.slice(7)
        : "";
    if (
      !timingSafeEqual(expected, createHash("sha256").update(supplied).digest())
    ) {
      reply.header("WWW-Authenticate", "Bearer");
      return reply.code(401).send({ error: "Invalid server access token." });
    }
  });
  app.get(
    "/api/health",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async () => ({ status: "ok", protocol: 1 }),
  );
  app.get(
    "/api/library",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async () => library.snapshot(),
  );
  const serve = async (request: any, reply: any) => {
    const file = await library.resolve(
      request.params.id,
      request.params.subtitleId,
    );
    if (!file) return reply.code(404).send({ error: "Media file not found." });
    let handle;
    try {
      handle = await open(file, "r");
    } catch {
      return reply.code(404).send({ error: "Media file not found." });
    }
    const info = await handle.stat();
    if (!info.isFile()) {
      await handle.close();
      return reply.code(404).send({ error: "Media file not found." });
    }
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    reply.header("Accept-Ranges", "bytes");
    reply.header("ETag", etag);
    reply.header("Last-Modified", info.mtime.toUTCString());
    const extension = path.extname(file).toLowerCase();
    reply.type(
      (
        {
          ".mkv": "video/x-matroska",
          ".mp4": "video/mp4",
          ".m4v": "video/mp4",
          ".webm": "video/webm",
          ".m2ts": "video/mp2t",
          ".ts": "video/mp2t",
          ".srt": "application/x-subrip",
          ".ass": "text/x-ssa",
          ".vtt": "text/vtt",
        } as Record<string, string>
      )[extension] ?? "application/octet-stream",
    );
    const ifRange = request.headers["if-range"];
    const range = parseRange(
      ifRange && ifRange !== etag && ifRange !== info.mtime.toUTCString()
        ? undefined
        : request.headers.range,
      info.size,
    );
    if (range === "invalid") {
      await handle.close();
      return reply
        .header("Content-Range", `bytes */${info.size}`)
        .code(416)
        .send();
    }
    const start = range?.start ?? 0,
      end = range?.end ?? info.size - 1;
    reply.header("Content-Length", range ? end - start + 1 : info.size);
    if (range)
      reply
        .code(206)
        .header("Content-Range", `bytes ${start}-${end}/${info.size}`);
    if (request.method === "HEAD") {
      await handle.close();
      reply.hijack();
      reply.raw.writeHead(reply.statusCode, reply.getHeaders());
      reply.raw.end();
      return reply;
    }
    if (info.size === 0) {
      await handle.close();
      return reply.send();
    }
    const stream = handle.createReadStream({ start, end, autoClose: true });
    reply.raw.on("close", () => stream.destroy());
    return reply.send(stream);
  };
  app.get("/api/media/:id", serve);
  app.get("/api/subtitles/:id/:subtitleId", serve);
  registerWatchTogether(app, (id) =>
    library.snapshot().items.find((item) => item.id === id),
  );
  app.addHook("onClose", async () => library.close());
  return { app, library };
}
