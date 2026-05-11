import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(repoRoot, "www");
const dataScript = fs.readFileSync(path.join(webRoot, "data/lotto-history.js"), "utf8");
const latestDrawScript = fs.readFileSync(path.join(webRoot, "data/latest-draw.js"), "utf8");
const sandbox = { window: {} };

vm.runInNewContext(dataScript, sandbox);
vm.runInNewContext(latestDrawScript, sandbox);

const history = sandbox.window.LOTTO_HISTORY;
const latestOverride = sandbox.window.LOTTO_LATEST_OVERRIDE;
const appSource = fs.readFileSync(path.join(webRoot, "app.js"), "utf8");
const appSandbox = {
  console,
  document: undefined,
  module: { exports: {} },
  exports: {},
  setTimeout,
  clearTimeout,
  window: {
    Capacitor: null,
    LOTTO_HISTORY: history,
    LOTTO_LATEST_OVERRIDE: latestOverride,
    location: { protocol: "file:" },
  },
};

appSandbox.global = appSandbox.window;
appSandbox.globalThis = appSandbox.window;
vm.runInNewContext(appSource, appSandbox);

const app = appSandbox.module.exports;

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

const scannedTicket = app.extractTicketInfoFromText("https://m.dhlottery.co.kr/?v=1223q161820323339w010203040506");
assert.equal(scannedTicket.round, 1223, "QR parser should extract the round from the ticket");
assert.equal(scannedTicket.games.length, 2, "QR parser should extract all encoded games");
assert.deepEqual(
  Array.from(scannedTicket.games[0]),
  [16, 18, 20, 32, 33, 39],
  "QR parser should decode six-number games",
);

const fiveLineTicket = app.extractTicketInfoFromText(
  "https://m.dhlottery.co.kr/?v=1222q121722273137w040718213134e101726313741r040721273237t011119293337202605021234",
);
assert.equal(fiveLineTicket.round, 1222, "QR parser should keep reading the round from multi-line tickets");
assert.equal(fiveLineTicket.games.length, 5, "QR parser should keep all five games even when metadata trails the last line");
assert.deepEqual(
  Array.from(fiveLineTicket.games[4]),
  [1, 11, 19, 29, 33, 37],
  "QR parser should preserve the final ticket line before trailing metadata",
);

const ticketCheckDom = Object.fromEntries(
  [
    "ticketCheckResults",
    "ticketCheckRoundLabel",
    "ticketCheckDateLabel",
    "ticketCheckWinningNumbers",
    "ticketCheckRows",
    "ticketCheckSummaryEyebrow",
    "ticketCheckSummaryHeadline",
    "ticketCheckSummaryText",
    "ticketCheckSummaryCard",
  ].map((id) => [
    id,
    {
      id,
      hidden: true,
      textContent: "",
      innerHTML: "",
      className: "",
    },
  ]),
);

appSandbox.document = {
  getElementById(id) {
    return ticketCheckDom[id] || null;
  },
};
app.renderScannedTicketResults(fiveLineTicket);

assert.equal(ticketCheckDom.ticketCheckResults.hidden, false, "rendered ticket results should become visible");
assert.equal(
  (ticketCheckDom.ticketCheckRows.innerHTML.match(/<article class="ticket-check-row">/g) || []).length,
  5,
  "rendered ticket results should include all five ticket rows",
);
assert.match(ticketCheckDom.ticketCheckRows.innerHTML, />E</, "rendered ticket results should include the final E row");

const evaluatedTicket = app.evaluateScannedTicket(scannedTicket, history);
assert.equal(evaluatedTicket.status, "ready", "known rounds should evaluate immediately");
assert.equal(evaluatedTicket.games[0].rank.label, "1등", "perfect matches should be recognized as first prize");
assert.equal(evaluatedTicket.games[1].rank.label, "미당첨", "non-winning games should be marked as misses");
const winningPresentation = app.getTicketResultPresentation(evaluatedTicket);
assert.equal(winningPresentation.tone, "rank-1", "winning ticket summary should emphasize the best rank");
assert.match(winningPresentation.headline, /1등/, "winning summary should mention the highest prize");

const pendingTicket = app.evaluateScannedTicket(
  { round: history.at(-1).round + 1, games: [[1, 2, 3, 4, 5, 6]] },
  history,
);
assert.equal(pendingTicket.status, "pending", "future rounds should stay pending");
assert.equal(app.getTicketResultPresentation(pendingTicket).tone, "pending", "future rounds should render as pending");

const missedTicket = app.evaluateScannedTicket(
  { round: history.at(-1).round, games: [[1, 2, 3, 4, 5, 6]] },
  history,
);
assert.equal(app.getTicketResultPresentation(missedTicket).tone, "miss", "non-winning tickets should render as misses");

const html = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
const healthHtml = fs.readFileSync(path.join(webRoot, "health/index.html"), "utf8");
assert.match(html, /data\/lotto-history\.js/, "index should load bundled history data");
assert.match(html, /data\/latest-draw\.js/, "index should load latest draw override data");
assert.match(html, /app\.js/, "index should load app.js");
assert.match(html, /unifiedNumberGrid/, "index should render the unified filter board");
assert.match(html, /poolNumberGrid/, "index should render the pool mix board");
assert.match(html, /ticketCheckModal/, "index should render the dedicated ticket check modal");
assert.match(html, /openTicketCheckModalBtn/, "index should render the bottom ticket check launch button");
assert.match(html, /ticketCheckUploadBtn/, "index should expose the desktop upload fallback");
assert.match(html, /ticketCheckRows/, "index should render the ticket result rows container");
assert.doesNotMatch(html, /ticketCheckQuickButton/, "header quick button should be removed");
assert.doesNotMatch(html, /QR 스캔 믹스형 \+ 당첨확인/, "pool mix profile should no longer include ticket checking");
assert.match(html, /historySyncStatus/, "index should render history sync status");
assert.match(html, /resultsFeedback/, "index should render generation feedback");
assert.match(appSource, /historySyncButton/, "app should render the manual update button");
assert.match(appSource, /renderScannedTicketResults/, "app should render scanned ticket result summaries");
assert.match(appSource, /openTicketCheckModalBtn/, "app should wire the modal launch button");
assert.match(appSource, /ticketCheckModal/, "app should manage the dedicated ticket check modal");
assert.match(appSource, /scanFile\(file, true\)/, "app should support scanning uploaded QR images");
assert.match(appSource, /setTicketCheckCameraAvailability/, "app should disable camera scanning in unsupported browsers");
assert.match(appSource, /ticketCheckCameraUnavailable/, "app should remember unsupported camera environments during the session");
assert.doesNotMatch(appSource, /setTimeout\(function \(\) \{\s*startTicketCheckScan\(\);/s, "modal should not auto-start camera on open");
assert.match(healthHtml, /"status":"ok"/, "health endpoint should advertise an ok status");

console.log("Regression OK:", {
  rounds: history.length,
  latestRound: history.at(-1).round,
  latestDate: history.at(-1).date,
  sampleTicket: result.tickets[0].numbers,
  filteredExcludedCount: filtered.filterState.excludedCount,
  overrideRound: latestOverride.round,
});
