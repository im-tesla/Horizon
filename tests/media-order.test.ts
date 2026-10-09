import { test } from "node:test";
import assert from "node:assert/strict";
import { orderEpisodes } from "../src/shared/media-order";

const episode = (season: number, number: number) => ({
  id: `${season}:${number}`,
  season,
  episode: number,
  filename: `You.S${season}E${number}.mkv`,
});

test("episodes use numeric season and episode order regardless of upload order", () => {
  const uploaded = [6, 7, 8, 1, 2, 10, 3, 9, 5, 4].map((number) =>
    episode(5, number),
  );
  const before = [...uploaded];
  assert.deepEqual(
    orderEpisodes(uploaded).map((item) => item.episode),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.deepEqual(
    uploaded,
    before,
    "Sorting must not mutate the library received from the server.",
  );
  const seasons = [
    episode(10, 1),
    episode(2, 2),
    episode(0, 1),
    episode(1, 10),
    episode(2, 1),
    episode(1, 2),
  ];
  assert.deepEqual(
    orderEpisodes(seasons).map((item) => item.id),
    ["0:1", "1:2", "1:10", "2:1", "2:2", "10:1"],
  );
});

test("unnumbered episodes follow numbered episodes and filenames use natural order", () => {
  const items = [
    { id: "part10", season: 1, filename: "You.Part10.mkv" },
    episode(1, 2),
    { id: "part2", season: 1, filename: "you.Part2.mkv" },
    episode(1, 1),
  ];
  assert.deepEqual(
    orderEpisodes(items).map((item) => item.id),
    ["1:1", "1:2", "part2", "part10"],
  );
});
