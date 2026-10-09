import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
await mkdir("media", { recursive: true });
await mkdir(".horizon", { recursive: true });
if (!existsSync(".env")) {
  const template = await readFile(".env.example", "utf8");
  await writeFile(
    ".env",
    template.replace(
      /HORIZON_TOKEN=\r?\n/,
      `HORIZON_TOKEN=${randomBytes(32).toString("hex")}\n`,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Created .env with a random server token. It is excluded from Git.",
  );
} else console.log(".env already exists. Existing configuration preserved.");
