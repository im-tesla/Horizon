import { test } from "node:test";
import assert from "node:assert/strict";
import { newerGlibcRequirements } from "../scripts/verify-linux-runtime.mjs";

test("Linux compatibility rejects the GLIBC_2.38 library regression", () => {
  const symbols = `
  11: 00000000 0 FUNC GLOBAL DEFAULT UND memcpy@GLIBC_2.14 (2)
  12: 00000000 0 FUNC GLOBAL DEFAULT UND strtoul@GLIBC_2.38 (3)
  13: 00000000 0 FUNC GLOBAL DEFAULT UND strtoull@GLIBC_2.38 (3)
  14: 00000000 0 FUNC GLOBAL DEFAULT UND example@GLIBC_2.9 (4)
  15: 00000000 0 FUNC GLOBAL DEFAULT UND example@GLIBC_2.35 (5)
  16: 00000001 0 FUNC GLOBAL DEFAULT 12 own_symbol@@GLIBC_2.39
  17: 00000000 0 FUNC GLOBAL DEFAULT UND example@GLIBCXX_3.4.30 (6)
`;
  assert.deepEqual(newerGlibcRequirements(symbols), ["2.38"]);
  assert.deepEqual(newerGlibcRequirements(symbols, "2.38"), []);
});
