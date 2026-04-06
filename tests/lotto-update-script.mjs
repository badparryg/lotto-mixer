import assert from "node:assert/strict";

import {
  EMPTY_OVERRIDE,
  formatHistoryScript,
  formatOverrideScript,
  syncLottoData,
} from "../scripts/update-lotto-data.mjs";

function createSuccessPayload(round, date, numbers, bonus) {
  return {
    returnValue: "success",
    drwNo: round,
    drwNoDate: date,
    drwtNo1: numbers[0],
    drwtNo2: numbers[1],
    drwtNo3: numbers[2],
    drwtNo4: numbers[3],
    drwtNo5: numbers[4],
    drwtNo6: numbers[5],
    bnusNo: bonus,
  };
}

function createFetch(responsesByRound) {
  return async (url) => {
    const round = Number(url.split("drwNo=").at(-1));
    const payload = responsesByRound[round] ?? { returnValue: "fail" };

    return {
      async text() {
        return JSON.stringify(payload);
      },
    };
  };
}

const baseHistory = [
  { round: 1, date: "2002-12-07", numbers: [10, 23, 29, 33, 37, 40], bonus: 16 },
];

const preservedOverride = {
  round: 2,
  date: "2002-12-14",
  numbers: [9, 13, 21, 25, 32, 42],
  bonus: 2,
};

const synced = await syncLottoData({
  history: baseHistory,
  override: preservedOverride,
  fetchImpl: createFetch({
    2: createSuccessPayload(2, "2002-12-14", [9, 13, 21, 25, 32, 42], 2),
    3: createSuccessPayload(3, "2002-12-21", [11, 16, 19, 21, 27, 31], 30),
  }),
});

assert.deepEqual(synced.addedRounds, [2, 3], "sync should append any newly fetched rounds");
assert.equal(synced.history.at(-1).round, 3, "history should advance to the last fetched round");
assert.deepEqual(synced.override, EMPTY_OVERRIDE, "override should clear once history catches up");
assert.match(formatHistoryScript(synced.history), /^window\.LOTTO_HISTORY = \[/, "history should serialize as a window assignment");
assert.match(
  formatOverrideScript(synced.override),
  /round: null/,
  "empty override should serialize with null round",
);

const unsynced = await syncLottoData({
  history: baseHistory,
  override: preservedOverride,
  fetchImpl: createFetch({}),
});

assert.deepEqual(unsynced.addedRounds, [], "sync should stop cleanly when no new official round exists");
assert.equal(unsynced.history.at(-1).round, 1, "history should stay unchanged when nothing new is fetched");
assert.deepEqual(unsynced.override, preservedOverride, "newer manual override should stay until history catches up");

console.log("Update script OK:", {
  syncedLatestRound: synced.history.at(-1).round,
  unsyncedOverrideRound: unsynced.override.round,
});
