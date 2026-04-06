import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const LOTTO_API_URL = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=";
const DEFAULT_MAX_SYNC_ROUNDS = 20;

export const EMPTY_OVERRIDE = {
  round: null,
  date: null,
  numbers: [],
  bonus: null,
};

function cloneOverride(override = EMPTY_OVERRIDE) {
  return {
    round: override.round ?? null,
    date: override.date ?? null,
    numbers: Array.isArray(override.numbers) ? override.numbers.slice() : [],
    bonus: override.bonus ?? null,
  };
}

export function normalizeDraw(draw) {
  if (
    !draw ||
    !Number.isInteger(Number(draw.round)) ||
    !draw.date ||
    !Array.isArray(draw.numbers) ||
    draw.numbers.length !== 6 ||
    !Number.isInteger(Number(draw.bonus))
  ) {
    return null;
  }

  const numbers = draw.numbers
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 45)
    .sort((left, right) => left - right);
  const bonus = Number(draw.bonus);
  const round = Number(draw.round);

  if (round < 1 || numbers.length !== 6 || new Set(numbers).size !== 6 || bonus < 1 || bonus > 45) {
    return null;
  }

  return {
    round,
    date: String(draw.date),
    numbers,
    bonus,
  };
}

export function normalizeHistory(history) {
  const byRound = new Map();

  for (const entry of Array.isArray(history) ? history : []) {
    const normalized = normalizeDraw(entry);
    if (normalized) {
      byRound.set(normalized.round, normalized);
    }
  }

  return Array.from(byRound.values()).sort((left, right) => left.round - right.round);
}

export function parseLottoDrawPayload(payload) {
  if (!payload || payload.returnValue !== "success") {
    return null;
  }

  return normalizeDraw({
    round: payload.drwNo,
    date: payload.drwNoDate,
    numbers: [payload.drwtNo1, payload.drwtNo2, payload.drwtNo3, payload.drwtNo4, payload.drwtNo5, payload.drwtNo6],
    bonus: payload.bnusNo,
  });
}

export async function fetchRoundData(round, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    return null;
  }

  try {
    const response = await fetchImpl(LOTTO_API_URL + round, { cache: "no-store" });
    const text = await response.text();
    return parseLottoDrawPayload(JSON.parse(text));
  } catch {
    return null;
  }
}

function loadWindowAssignment(scriptText, key) {
  const sandbox = { window: {} };
  vm.runInNewContext(scriptText, sandbox);
  return sandbox.window[key];
}

export async function readLottoData(repoRoot) {
  const historyPath = path.join(repoRoot, "data", "lotto-history.js");
  const overridePath = path.join(repoRoot, "data", "latest-draw.js");
  const [historyScript, overrideScript] = await Promise.all([
    fs.readFile(historyPath, "utf8"),
    fs.readFile(overridePath, "utf8"),
  ]);

  return {
    history: normalizeHistory(loadWindowAssignment(historyScript, "LOTTO_HISTORY")),
    override: normalizeDraw(loadWindowAssignment(overrideScript, "LOTTO_LATEST_OVERRIDE")),
  };
}

function mergeDraw(history, draw) {
  const nextHistory = history.slice();
  const existingIndex = nextHistory.findIndex((entry) => entry.round === draw.round);

  if (existingIndex >= 0) {
    nextHistory[existingIndex] = draw;
  } else {
    nextHistory.push(draw);
    nextHistory.sort((left, right) => left.round - right.round);
  }

  return nextHistory;
}

function areDrawsEqual(left, right) {
  const normalizedLeft = normalizeDraw(left);
  const normalizedRight = normalizeDraw(right);

  if (!normalizedLeft && !normalizedRight) {
    return true;
  }

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function areHistoriesEqual(left, right) {
  return JSON.stringify(normalizeHistory(left)) === JSON.stringify(normalizeHistory(right));
}

export async function syncLottoData({
  history,
  override,
  fetchImpl = globalThis.fetch,
  maxSyncRounds = DEFAULT_MAX_SYNC_ROUNDS,
} = {}) {
  let nextHistory = normalizeHistory(history);
  let nextOverride = normalizeDraw(override);
  const addedRounds = [];
  let nextRound = nextHistory.length ? nextHistory.at(-1).round + 1 : 1;

  for (let step = 0; step < maxSyncRounds; step += 1) {
    const draw = await fetchRoundData(nextRound, fetchImpl);

    if (!draw || draw.round !== nextRound) {
      break;
    }

    nextHistory = mergeDraw(nextHistory, draw);
    addedRounds.push(draw.round);
    nextRound = draw.round + 1;
  }

  if (nextOverride && nextHistory.length && nextOverride.round <= nextHistory.at(-1).round) {
    nextOverride = null;
  }

  return {
    history: nextHistory,
    override: nextOverride ? cloneOverride(nextOverride) : cloneOverride(EMPTY_OVERRIDE),
    addedRounds,
    latestRound: nextHistory.length ? nextHistory.at(-1).round : null,
    changed:
      !areHistoriesEqual(history, nextHistory) ||
      !areDrawsEqual(override, nextOverride),
  };
}

export function formatHistoryScript(history) {
  return `window.LOTTO_HISTORY = ${JSON.stringify(normalizeHistory(history))};\n`;
}

export function formatOverrideScript(override) {
  const normalized = normalizeDraw(override);
  const safeOverride = normalized ? cloneOverride(normalized) : cloneOverride(EMPTY_OVERRIDE);

  return [
    "window.LOTTO_LATEST_OVERRIDE = {",
    `  round: ${safeOverride.round === null ? "null" : safeOverride.round},`,
    `  date: ${safeOverride.date === null ? "null" : JSON.stringify(safeOverride.date)},`,
    `  numbers: ${JSON.stringify(safeOverride.numbers)},`,
    `  bonus: ${safeOverride.bonus === null ? "null" : safeOverride.bonus},`,
    "};",
    "",
  ].join("\n");
}

export async function writeLottoData(repoRoot, { history, override }) {
  const historyPath = path.join(repoRoot, "data", "lotto-history.js");
  const overridePath = path.join(repoRoot, "data", "latest-draw.js");

  await Promise.all([
    fs.writeFile(historyPath, formatHistoryScript(history), "utf8"),
    fs.writeFile(overridePath, formatOverrideScript(override), "utf8"),
  ]);
}

export async function runUpdate(repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const current = await readLottoData(repoRoot);
  const result = await syncLottoData(current);

  if (result.changed) {
    await writeLottoData(repoRoot, result);
  }

  return result;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "www");
    const targetRoot = process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot;
    const result = await runUpdate(targetRoot);
    const message = result.changed ? "Updated lotto data" : "Lotto data already up to date";

    console.log(message, {
      addedRounds: result.addedRounds,
      latestRound: result.latestRound,
      overrideRound: result.override.round,
    });
  } catch (error) {
    console.error("Failed to update lotto data.", error);
    process.exitCode = 1;
  }
}
