import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataScript = fs.readFileSync(path.join(repoRoot, "data/lotto-history.js"), "utf8");
const latestDrawScript = fs.readFileSync(path.join(repoRoot, "data/latest-draw.js"), "utf8");
const sandbox = { window: {} };

vm.runInNewContext(dataScript, sandbox);
vm.runInNewContext(latestDrawScript, sandbox);

const history = sandbox.window.LOTTO_HISTORY;
const latestOverride = sandbox.window.LOTTO_LATEST_OVERRIDE;
const app = require(path.join(repoRoot, "app.js"));

assert.ok(history.length > 0, "history should not be empty");
assert.equal(history[0].round, 1, "first round should be 1");

history.forEach((draw, index) => {
  assert.equal(draw.round, index + 1, `draw ${index + 1} should stay sequential`);
  assert.match(draw.date, /^\d{4}-\d{2}-\d{2}$/, `draw ${draw.round} should keep ISO date format`);
  assert.equal(draw.numbers.length, 6, `draw ${draw.round} should have six numbers`);
  assert.equal(new Set(draw.numbers).size, 6, `draw ${draw.round} numbers should stay unique`);
  assert.deepEqual(
    Array.from(draw.numbers).slice().sort((left, right) => left - right),
    Array.from(draw.numbers),
    `draw ${draw.round} numbers should stay sorted`,
  );
  draw.numbers.forEach((number) => {
    assert.ok(number >= 1 && number <= 45, `draw ${draw.round} number ${number} should stay in range`);
  });
  assert.ok(draw.bonus >= 1 && draw.bonus <= 45, `draw ${draw.round} bonus should stay in range`);
});

if (latestOverride && latestOverride.round !== null) {
  assert.ok(
    latestOverride.round >= history.at(-1).round,
    "latest override should not point to an older round than history",
  );
  assert.match(latestOverride.date, /^\d{4}-\d{2}-\d{2}$/, "latest override should keep ISO date format");
  assert.equal(latestOverride.numbers.length, 6, "latest override should have six numbers");
  assert.equal(new Set(latestOverride.numbers).size, 6, "latest override numbers should stay unique");
} else {
  assert.equal(latestOverride.round, null, "empty override should keep a null round");
}

const mergedHistory = app.mergeLatestOverride(history, {
  round: history.at(-1).round + 1,
  date: "2099-12-31",
  numbers: [1, 2, 3, 4, 5, 6],
  bonus: 7,
});
assert.equal(mergedHistory.at(-1).round, history.at(-1).round + 1, "override should append a newer round");
assert.deepEqual(
  Array.from(mergedHistory.at(-1).numbers),
  [1, 2, 3, 4, 5, 6],
  "override numbers should be normalized into history",
);

const result = app.generateRecommendations(history, {
  profile: "balanced",
  ticketCount: 5,
  recentWindow: 24,
});

assert.equal(result.tickets.length, 5, "should create five tickets");
assert.equal(result.scoreTable.length, 45, "score table should include 45 numbers");

result.tickets.forEach((ticket, index) => {
  assert.equal(ticket.numbers.length, 6, `ticket ${index + 1} should have six numbers`);
  assert.equal(new Set(ticket.numbers).size, 6, `ticket ${index + 1} should not duplicate numbers`);
  assert.ok(
    app.validateTicket(ticket.numbers, result.stats, result.profile),
    `ticket ${index + 1} should satisfy ticket constraints`,
  );
});

const filtered = app.generateRecommendations(history, {
  profile: "balanced",
  ticketCount: 3,
  recentWindow: 24,
  includedNumbers: [11, 17],
  excludedNumbers: [1, 2, 3, 4, 5, 6],
});

assert.equal(filtered.error, "", "filtered generation should still succeed");
assert.equal(filtered.tickets.length, 3, "filtered generation should create three tickets");
assert.ok(filtered.filterState.excludedCount > 0, "filters should exclude some numbers");
assert.equal(
  filtered.scoreTable.length,
  45 - filtered.filterState.excludedCount,
  "score table should shrink to allowed numbers only",
);

filtered.tickets.forEach((ticket, index) => {
  ticket.numbers.forEach((number) => {
    assert.ok(
      !filtered.filterState.excludedSet.has(number),
      `filtered ticket ${index + 1} should avoid excluded number ${number}`,
    );
  });
  assert.ok(
    app.validateTicket(ticket.numbers, filtered.stats, filtered.profile, filtered.filterState),
    `filtered ticket ${index + 1} should satisfy constraints with filters`,
  );
  assert.ok(ticket.numbers.includes(11), `filtered ticket ${index + 1} should include fixed number 11`);
  assert.ok(ticket.numbers.includes(17), `filtered ticket ${index + 1} should include fixed number 17`);
});

const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
assert.match(html, /data\/lotto-history\.js/, "index should load bundled history data");
assert.match(html, /data\/latest-draw\.js/, "index should load latest draw override data");
assert.match(html, /app\.js/, "index should load app.js");
assert.match(html, /includeNumberGrid/, "index should render include number board");
assert.match(html, /excludeNumberGrid/, "index should render exclude number board");
assert.match(html, /historySyncStatus/, "index should render history sync status");
assert.match(html, /historySyncButton/, "index should render the manual update button");

console.log("Regression OK:", {
  rounds: history.length,
  latestRound: history.at(-1).round,
  latestDate: history.at(-1).date,
  sampleTicket: result.tickets[0].numbers,
  filteredExcludedCount: filtered.filterState.excludedCount,
  overrideRound: latestOverride.round,
});
