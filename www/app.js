(function (global) {
  "use strict";

  var NUMBER_RANGE = Array.from({ length: 45 }, function (_, index) {
    return index + 1;
  });
  var PROFILE_COPY = {
    balanced: "균형형",
    trend: "트렌드형",
    contrarian: "역발상형",
    random: "오토 믹스",
  };
  var GRID_COLUMN_COUNT = 7;
  var GRID_ROW_COUNT = 7;
  var RANGE_GROUPS = [
    { key: "1-10", label: "1~10", start: 1, end: 10 },
    { key: "11-20", label: "11~20", start: 11, end: 20 },
    { key: "21-30", label: "21~30", start: 21, end: 30 },
    { key: "31-40", label: "31~40", start: 31, end: 40 },
    { key: "41-45", label: "41~45", start: 41, end: 45 },
  ];
  var isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var isLocalFile = window.location.protocol === "file:";
  var LOTTO_API_URL = (isNativeApp || isLocalFile) 
    ? "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=" 
    : "/api/lotto/";
  var MAX_SYNC_ROUNDS = 20;
  var appState = {
    history: Array.isArray(global.LOTTO_HISTORY) ? global.LOTTO_HISTORY.slice() : [],
    latestResult: null,
    activeTicketIndex: -1,
    isSyncing: false,
    filterStateMap: {},
    poolNumberSet: new Set(),
  };

  function createRng(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function createEmptyCounts() {
    return Array.from({ length: 46 }, function () {
      return 0;
    });
  }

  function average(values) {
    return values.length
      ? values.reduce(function (sum, value) {
          return sum + value;
        }, 0) / values.length
      : 0;
  }

  function normalize(values) {
    var min = Math.min.apply(Math, values);
    var max = Math.max.apply(Math, values);

    if (max === min) {
      return values.map(function () {
        return 0.5;
      });
    }

    return values.map(function (value) {
      return (value - min) / (max - min);
    });
  }

  function countConsecutive(numbers) {
    var maxRun = 1;
    var currentRun = 1;

    for (var index = 1; index < numbers.length; index += 1) {
      if (numbers[index] === numbers[index - 1] + 1) {
        currentRun += 1;
        maxRun = Math.max(maxRun, currentRun);
      } else {
        currentRun = 1;
      }
    }

    return maxRun;
  }

  function getBucket(number) {
    if (number <= 9) {
      return 0;
    }
    if (number <= 19) {
      return 1;
    }
    if (number <= 29) {
      return 2;
    }
    if (number <= 39) {
      return 3;
    }
    return 4;
  }

  function getBallClass(number) {
    if (number <= 10) {
      return "ball-yellow";
    }
    if (number <= 20) {
      return "ball-blue";
    }
    if (number <= 30) {
      return "ball-red";
    }
    if (number <= 40) {
      return "ball-gray";
    }
    return "ball-green";
  }

  function range(start, end) {
    return Array.from({ length: end - start + 1 }, function (_, index) {
      return start + index;
    });
  }

  function getRowNumbers(row) {
    return range((row - 1) * GRID_COLUMN_COUNT + 1, Math.min(row * GRID_COLUMN_COUNT, 45));
  }

  function getColumnNumbers(column) {
    var numbers = [];
    for (var number = column; number <= 45; number += GRID_COLUMN_COUNT) {
      numbers.push(number);
    }
    return numbers;
  }

  function sumNumbers(values) {
    return values.reduce(function (sum, value) {
      return sum + value;
    }, 0);
  }

  function uniqueBuckets(numbers) {
    return Array.from(
      new Set(
        numbers.map(function (number) {
          return getBucket(number);
        }),
      ),
    );
  }

  function normalizeUniqueNumbers(values, min, max) {
    return (values || [])
      .map(function (value) {
        return Number(value);
      })
      .filter(function (value, index, array) {
        return value >= min && value <= max && array.indexOf(value) === index;
      })
      .sort(function (left, right) {
        return left - right;
      });
  }

  function combinations(n, k) {
    if (k > n || k < 0) return 0;
    if (k === 0 || k === n) return 1;
    if (k * 2 > n) k = n - k;
    var result = 1;
    for (var i = 1; i <= k; i++) {
      result = (result * (n - i + 1)) / i;
    }
    return result;
  }

  function extractNumbersFromText(text) {
    var rawText = text || "";
    var numbers = [];
    var qrMatch = rawText.match(/v=([a-zA-Z0-9]+)/);
    
    if (qrMatch) {
      var data = qrMatch[1];
      var body = data.substring(4);
      var parts = body.split(/[A-Za-z]/);
      parts.forEach(function(part) {
        if (part.length === 12) {
          for (var i = 0; i < 12; i += 2) {
            numbers.push(parseInt(part.substring(i, i+2), 10));
          }
        }
      });
    }
    var tokens = rawText.match(/\b([1-9]|[1-3][0-9]|4[0-5])\b/g) || [];
    tokens.forEach(function(t) {
      numbers.push(parseInt(t, 10));
    });
    
    return Array.from(new Set(numbers)).filter(function(n) { return n >= 1 && n <= 45; }).sort(function(a,b){return a-b;});
  }

  function extractGamesFromText(text) {
    var rawText = text || "";
    var games = [];
    var qrMatch = rawText.match(/v=([a-zA-Z0-9]+)/);
    
    if (qrMatch) {
      var data = qrMatch[1];
      var body = data.substring(4);
      var parts = body.split(/[A-Za-z]/);
      parts.forEach(function(part) {
        if (part.length === 12) {
          var gameNums = [];
          for (var i = 0; i < 12; i += 2) {
            gameNums.push(parseInt(part.substring(i, i+2), 10));
          }
          if (new Set(gameNums).size === 6) {
            games.push(gameNums.sort(function(a,b) { return a - b; }));
          }
        }
      });
    }
    return games;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeDraw(draw) {
    if (!draw || !draw.round || !draw.date || !Array.isArray(draw.numbers) || draw.numbers.length !== 6 || !draw.bonus) {
      return null;
    }

    var normalizedNumbers = draw.numbers
      .map(function (value) {
        return Number(value);
      })
      .filter(function (value) {
        return value >= 1 && value <= 45;
      })
      .sort(function (left, right) {
        return left - right;
      });

    if (normalizedNumbers.length !== 6 || new Set(normalizedNumbers).size !== 6) {
      return null;
    }

    return {
      round: Number(draw.round),
      date: String(draw.date),
      numbers: normalizedNumbers,
      bonus: Number(draw.bonus),
    };
  }

  function mergeLatestOverride(history, override) {
    var normalizedOverride = normalizeDraw(override);

    if (!normalizedOverride) {
      return history.slice();
    }

    var nextHistory = history.slice();
    var existingIndex = nextHistory.findIndex(function (draw) {
      return draw.round === normalizedOverride.round;
    });

    if (existingIndex >= 0) {
      nextHistory[existingIndex] = normalizedOverride;
    } else {
      nextHistory.push(normalizedOverride);
      nextHistory.sort(function (left, right) {
        return left.round - right.round;
      });
    }

    return nextHistory;
  }

  function clampTicketIndex(index, result) {
    if (!result || !result.tickets.length) {
      return -1;
    }
    if (index < 0) return -1;
    return Math.min(index, result.tickets.length - 1);
  }

  function pairKey(left, right) {
    return left < right ? left + "-" + right : right + "-" + left;
  }

  function buildFilterState(options) {
    var selectedRanges = ((options && options.excludedRanges) || [])
      .filter(function (value, index, array) {
        return array.indexOf(value) === index;
      })
      .filter(function (value) {
        return RANGE_GROUPS.some(function (group) {
          return group.key === value;
        });
      });
    var selectedRows = normalizeUniqueNumbers(options && options.excludedRows, 1, GRID_ROW_COUNT);
    var selectedCols = normalizeUniqueNumbers(options && options.excludedCols, 1, GRID_COLUMN_COUNT);
    var includedNumbers = normalizeUniqueNumbers(options && options.includedNumbers, 1, 45);
    var directExcludedNumbers = normalizeUniqueNumbers(options && options.excludedNumbers, 1, 45);
    var includedSet = new Set(includedNumbers);
    var excludedSet = new Set();
    var labels = [];

    directExcludedNumbers.forEach(function (number) {
      excludedSet.add(number);
      labels.push(number + "번");
    });

    RANGE_GROUPS.forEach(function (group) {
      if (!selectedRanges.includes(group.key)) {
        return;
      }
      range(group.start, group.end).forEach(function (number) {
        excludedSet.add(number);
      });
      labels.push(group.label);
    });

    selectedRows.forEach(function (row) {
      getRowNumbers(row).forEach(function (number) {
        excludedSet.add(number);
      });
      labels.push("가로 " + row);
    });

    selectedCols.forEach(function (column) {
      getColumnNumbers(column).forEach(function (number) {
        excludedSet.add(number);
      });
      labels.push("세로 " + column);
    });

    includedNumbers.forEach(function (number) {
      excludedSet.delete(number);
    });

    var excludedNumbers = Array.from(excludedSet).sort(function (left, right) {
      return left - right;
    });

    return {
      selectedRanges: selectedRanges,
      selectedRows: selectedRows,
      selectedCols: selectedCols,
      includedNumbers: includedNumbers,
      directExcludedNumbers: directExcludedNumbers,
      includedSet: includedSet,
      labels: labels,
      excludedSet: excludedSet,
      excludedNumbers: excludedNumbers,
      excludedCount: excludedNumbers.length,
      allowedNumbers: NUMBER_RANGE.filter(function (number) {
        return !excludedSet.has(number) || includedSet.has(number);
      }),
    };
  }

  function analyzeHistory(history, options) {
    var recentWindow = Number(options && options.recentWindow) || 24;
    var midWindow = Math.max(40, recentWindow * 2);
    var pairWindow = Math.max(80, recentWindow * 3);
    var overall = createEmptyCounts();
    var recent = createEmptyCounts();
    var mid = createEmptyCounts();
    var bonus = createEmptyCounts();
    var lastSeen = Array.from({ length: 46 }, function () {
      return 0;
    });
    var pairCounts = new Map();
    var latest = history[history.length - 1];
    var latestRound = latest.round;

    history.forEach(function (draw) {
      draw.numbers.forEach(function (number) {
        overall[number] += 1;
        lastSeen[number] = draw.round;
      });
      bonus[draw.bonus] += 1;
    });

    history.slice(-recentWindow).forEach(function (draw) {
      draw.numbers.forEach(function (number) {
        recent[number] += 1;
      });
    });

    history.slice(-midWindow).forEach(function (draw) {
      draw.numbers.forEach(function (number) {
        mid[number] += 1;
      });
    });

    history.slice(-pairWindow).forEach(function (draw) {
      for (var left = 0; left < draw.numbers.length; left += 1) {
        for (var right = left + 1; right < draw.numbers.length; right += 1) {
          var key = pairKey(draw.numbers[left], draw.numbers[right]);
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    });

    var gaps = createEmptyCounts();
    NUMBER_RANGE.forEach(function (number) {
      gaps[number] = latestRound - lastSeen[number];
    });

    return {
      history: history,
      recentWindow: recentWindow,
      midWindow: midWindow,
      pairWindow: pairWindow,
      overall: overall,
      recent: recent,
      mid: mid,
      bonus: bonus,
      gaps: gaps,
      pairCounts: pairCounts,
      latest: latest,
      latestRound: latestRound,
      rounds: history.length,
    };
  }

  function buildScoreTable(stats, profile) {
    var weights = {
      balanced: { overall: 0.34, recent: 0.24, mid: 0.18, gap: 0.2, cool: 0.04, latestPenalty: 0.07 },
      trend: { overall: 0.18, recent: 0.42, mid: 0.24, gap: 0.1, cool: 0.06, latestPenalty: 0.09 },
      contrarian: { overall: 0.16, recent: 0.08, mid: 0.14, gap: 0.4, cool: 0.18, latestPenalty: 0.05 },
    }[profile] || { overall: 0.34, recent: 0.24, mid: 0.18, gap: 0.2, cool: 0.04, latestPenalty: 0.07 };
    var overallNorm = normalize(NUMBER_RANGE.map(function (number) { return stats.overall[number]; }));
    var recentNorm = normalize(NUMBER_RANGE.map(function (number) { return stats.recent[number]; }));
    var midNorm = normalize(NUMBER_RANGE.map(function (number) { return stats.mid[number]; }));
    var gapNorm = normalize(NUMBER_RANGE.map(function (number) { return stats.gaps[number]; }));
    var coolNorm = normalize(NUMBER_RANGE.map(function (number) { return stats.recentWindow - stats.recent[number]; }));
    var latestSet = new Set(stats.latest.numbers);

    return NUMBER_RANGE.map(function (number, index) {
      var score =
        overallNorm[index] * weights.overall +
        recentNorm[index] * weights.recent +
        midNorm[index] * weights.mid +
        gapNorm[index] * weights.gap +
        coolNorm[index] * weights.cool;

      if (latestSet.has(number)) {
        score -= weights.latestPenalty;
      }

      return {
        number: number,
        score: Math.max(0.01, score),
        overall: stats.overall[number],
        recent: stats.recent[number],
        gap: stats.gaps[number],
      };
    }).sort(function (left, right) {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.number - right.number;
    });
  }

  function validateTicket(numbers, stats, profile, filterState) {
    var sorted = numbers.slice().sort(function (left, right) {
      return left - right;
    });
    var latestSet = new Set(stats.latest.numbers);
    var bucketUsage = {};
    var allowedNumbers =
      filterState && filterState.allowedNumbers && filterState.allowedNumbers.length
        ? filterState.allowedNumbers.slice()
        : NUMBER_RANGE.slice();
    var availableBuckets = uniqueBuckets(allowedNumbers);
    var bucketLimit = availableBuckets.length >= 4 ? 2 : availableBuckets.length === 3 ? 3 : availableBuckets.length === 2 ? 4 : 6;
    var minDistinctBuckets = Math.min(3, availableBuckets.length);
    var oddCount = sorted.filter(function (number) {
      return number % 2 !== 0;
    }).length;
    var overlap = sorted.filter(function (number) {
      return latestSet.has(number);
    }).length;
    var total = sumNumbers(sorted);
    var allowedSorted = allowedNumbers.slice().sort(function (left, right) {
      return left - right;
    });
    var totalLowerBound = Math.max(95, sumNumbers(allowedSorted.slice(0, 6)));
    var totalUpperBound = Math.min(185, sumNumbers(allowedSorted.slice(-6)));

    if (new Set(sorted).size !== 6) {
      return false;
    }
    if (filterState && filterState.includedNumbers.some(function (number) { return !sorted.includes(number); })) {
      return false;
    }
    if (
      filterState &&
      sorted.some(function (number) { return filterState.excludedSet.has(number) && !filterState.includedSet.has(number); })
    ) {
      return false;
    }
    if (oddCount < 2 || oddCount > 4) {
      return false;
    }
    if (countConsecutive(sorted) > 2) {
      return false;
    }
    if (total < totalLowerBound || total > totalUpperBound) {
      return false;
    }
    if (profile === "trend" ? overlap > 2 : overlap > 1) {
      return false;
    }

    sorted.forEach(function (number) {
      var bucket = getBucket(number);
      bucketUsage[bucket] = (bucketUsage[bucket] || 0) + 1;
    });

    if (Object.values(bucketUsage).some(function (count) { return count > bucketLimit; })) {
      return false;
    }
    if (Object.keys(bucketUsage).length < minDistinctBuckets) {
      return false;
    }
    return true;
  }

  function pickWeighted(candidates, rng) {
    var totalWeight = candidates.reduce(function (sum, candidate) {
      return sum + candidate.weight;
    }, 0);
    var threshold = rng() * totalWeight;
    var cursor = 0;

    for (var index = 0; index < candidates.length; index += 1) {
      cursor += candidates[index].weight;
      if (cursor >= threshold) {
        return candidates[index].number;
      }
    }

    return candidates[candidates.length - 1].number;
  }

  function generateOneTicket(scoreMap, stats, profile, rng, filterState) {
    var chosen = filterState.includedNumbers.slice();
    var latestSet = new Set(stats.latest.numbers);
    var bucketUsage = {};
    var allowedNumbers = filterState.allowedNumbers;

    chosen.forEach(function (number) {
      var bucket = getBucket(number);
      bucketUsage[bucket] = (bucketUsage[bucket] || 0) + 1;
    });

    if (chosen.length === 6) {
      return chosen.sort(function (left, right) {
        return left - right;
      });
    }

    for (var step = chosen.length; step < 6; step += 1) {
      var candidates = allowedNumbers
        .filter(function (number) {
          return !chosen.includes(number);
        })
        .map(function (number) {
          var scoreItem = scoreMap[number] || { score: 0.01 };
          var weight = Math.pow(scoreItem.score + 0.02, 1.45);
          var bucket = getBucket(number);
          var averageNumber;

          if ((bucketUsage[bucket] || 0) >= 2) {
            weight *= 0.08;
          }
          if (latestSet.has(number)) {
            weight *= profile === "trend" ? 0.9 : 0.55;
          }

          chosen.forEach(function (selected) {
            var pairHits = stats.pairCounts.get(pairKey(number, selected)) || 0;
            weight *= profile === "trend" ? 1 + pairHits * 0.05 : 1 / (1 + pairHits * 0.08);
            if (Math.abs(number - selected) === 1) {
              weight *= 0.9;
            }
          });

          averageNumber = chosen.length === 0 ? number : average(chosen.concat(number));
          if (averageNumber < 13 || averageNumber > 35) {
            weight *= 0.92;
          }

          return { number: number, weight: Math.max(weight, 0.001) };
        });
      var picked = pickWeighted(candidates, rng);
      chosen.push(picked);
      bucketUsage[getBucket(picked)] = (bucketUsage[getBucket(picked)] || 0) + 1;
    }

    return chosen.sort(function (left, right) {
      return left - right;
    });
  }

  function buildTicketMeta(numbers, stats, filterState) {
    var oddCount = numbers.filter(function (number) {
      return number % 2 !== 0;
    }).length;
    var latestSet = new Set(stats.latest.numbers);
    var overlap = numbers.filter(function (number) {
      return latestSet.has(number);
    }).length;
    var total = sumNumbers(numbers);
    var fixedCount = filterState
      ? numbers.filter(function (number) {
          return filterState.includedSet.has(number);
        }).length
      : 0;
    var meta = [oddCount + ":" + (6 - oddCount) + " 홀짝", "합계 " + total, "최신 중복 " + overlap];

    if (fixedCount) {
      meta.push("고정 포함 " + fixedCount);
    }

    return meta;
  }

  function generateRecommendations(history, options) {
    var profile = options && options.profile ? options.profile : "balanced";
    var ticketCount = Number(options && options.ticketCount) || 5;
    var poolNumbers = options && options.poolNumbers ? options.poolNumbers : [];
    var recentWindow = Number(options && options.recentWindow) || 24;
    var filterState = buildFilterState(options);
    var stats = analyzeHistory(history, { recentWindow: recentWindow });
    var scoreTable = buildScoreTable(stats, profile).filter(function (item) {
      return filterState.allowedNumbers.includes(item.number);
    });
    var scoreMap = {};
    var tickets = [];
    var seen = new Set();
    var attempts = 0;
    var maxAttempts = 8000;
    var rng = createRng(
      stats.latestRound * 997 +
        ticketCount * 53 +
        recentWindow * 11 +
        profile.length * 101 +
        filterState.excludedCount * 17 +
        sumNumbers(filterState.includedNumbers) * 7 +
        Date.now(),
    );

    if (profile === "pool_mix") {
      filterState.allowedNumbers = poolNumbers.filter(function(n) {
        return !filterState.excludedSet.has(n) || filterState.includedSet.has(n);
      });
    }

    if (filterState.includedNumbers.length > 6) {
      return { profile: profile, ticketCount: ticketCount, recentWindow: recentWindow, stats: stats, scoreTable: scoreTable, tickets: tickets, filterState: filterState, error: "고정 번호는 최대 6개까지 선택할 수 있습니다." };
    }
    if (filterState.allowedNumbers.length < 6) {
      return { profile: profile, ticketCount: ticketCount, recentWindow: recentWindow, stats: stats, scoreTable: scoreTable, tickets: tickets, filterState: filterState, error: "제외 조건이 너무 많아서 추천 후보가 6개보다 적습니다." };
    }

    scoreTable.forEach(function (item) {
      scoreMap[item.number] = item;
    });

    while (tickets.length < ticketCount && attempts < maxAttempts) {
      attempts += 1;
      var currentProfile = profile === "random" || profile === "pool_mix" ? ["balanced", "trend", "contrarian"][Math.floor(rng() * 3)] : profile;
      var currentScoreMap = scoreMap;
      if (profile === "random") {
        var tTable = buildScoreTable(stats, currentProfile);
        currentScoreMap = {};
        tTable.forEach(function (item) { currentScoreMap[item.number] = item; });
      }

      var numbers = generateOneTicket(currentScoreMap, stats, currentProfile, rng, filterState);
      var key = numbers.join("-");

      if (seen.has(key)) {
        continue;
      }
      
      var isStrict = profile === "pool_mix" ? (attempts < maxAttempts * 0.3) : (attempts < maxAttempts * 0.8);
      if (isStrict && !validateTicket(numbers, stats, currentProfile, filterState)) {
        continue;
      }

      seen.add(key);
      tickets.push({
        profile: currentProfile,
        numbers: numbers,
        meta: buildTicketMeta(numbers, stats, filterState).concat(filterState.excludedCount ? ["제외 반영 " + filterState.excludedCount] : []),
      });
    }

    return {
      profile: profile,
      ticketCount: ticketCount,
      recentWindow: recentWindow,
      stats: stats,
      scoreTable: scoreTable,
      tickets: tickets,
      filterState: filterState,
      error: tickets.length < ticketCount ? "조건이 촘촘해서 일부 조합만 만들었습니다. 제외 조건을 조금 줄여보세요." : "",
    };
  }

  function topItems(scoreTable, key, count) {
    return scoreTable.slice().sort(function (left, right) {
      if (right[key] !== left[key]) {
        return right[key] - left[key];
      }
      return left.number - right.number;
    }).slice(0, count);
  }

  function overdueItems(scoreTable, count) {
    return scoreTable.slice().sort(function (left, right) {
      if (right.gap !== left.gap) {
        return right.gap - left.gap;
      }
      return left.number - right.number;
    }).slice(0, count);
  }

  function pairItems(pairCounts, count) {
    return Array.from(pairCounts.entries()).sort(function (left, right) {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    }).slice(0, count);
  }

  function ballMarkup(number, options) {
    var classNames = ["ball", getBallClass(number)];
    if (options && options.fixed) {
      classNames.push("ball-fixed");
    }
    return '<span class="' + classNames.join(" ") + '">' + number + "</span>";
  }

  function chipMarkup(label, value) {
    return '<span class="number-chip"><strong>' + escapeHtml(label) + "</strong> " + escapeHtml(value) + "</span>";
  }

  function renderFilterControls() {
    var gridTarget = document.getElementById("unifiedNumberGrid");
    if (!gridTarget) return;

    gridTarget.innerHTML = NUMBER_RANGE.map(function (number) {
      var state = appState.filterStateMap[number];
      var boxClass = "number-pick-box";
      if (state === "include") boxClass += " is-include";
      if (state === "exclude") boxClass += " is-exclude";

      return '<div class="number-pick"><button type="button" class="' + boxClass + '" data-num="' + number + '">' + number + '</button></div>';
    }).join("");
  }

  function collectFormOptions() {
    var includedNumbers = [];
    var excludedNumbers = [];
    Object.keys(appState.filterStateMap).forEach(function(k) {
      if (appState.filterStateMap[k] === "include") includedNumbers.push(k);
      else if (appState.filterStateMap[k] === "exclude") excludedNumbers.push(k);
    });

    var profileEl = document.getElementById("profile");
    var countEl = document.getElementById("ticketCount");
    var windowEl = document.getElementById("recentWindow");

    return {
      profile: profileEl ? profileEl.value : "balanced",
      ticketCount: countEl ? countEl.value : "5",
      recentWindow: windowEl ? windowEl.value : "24",
      includedNumbers: includedNumbers,
      excludedNumbers: excludedNumbers,
      poolNumbers: Array.from(appState.poolNumberSet).sort(function(a,b){return a-b;})
    };
  }

  function summarizeNumberSelection(numbers) {
    if (!numbers.length) {
      return "";
    }
    if (numbers.length <= 6) {
      return numbers.join(", ");
    }
    return numbers.slice(0, 6).join(", ") + " 외 " + (numbers.length - 6) + "개";
  }

  function formatFilterSummary(filterState) {
    return filterState.excludedCount ? "제외 " + filterState.excludedCount + "개: " + summarizeNumberSelection(filterState.excludedNumbers) : "제외 번호 없음";
  }

  function formatIncludeSummary(filterState) {
    return filterState.includedNumbers.length ? "포함 " + filterState.includedNumbers.length + "개: " + summarizeNumberSelection(filterState.includedNumbers) : "포함 번호 없음";
  }

  function setHistorySyncStatus(message, tone) {
    if (typeof document === "undefined") {
      return;
    }

    var target = document.getElementById("historySyncStatus");

    if (!target) {
      return;
    }

    target.textContent = message;
    target.style.color = tone === "error" ? "#ffb4ab" : tone === "success" ? "#74f2ce" : "";
  }

  function setSyncButtonState(isBusy) {
    if (typeof document === "undefined") {
      return;
    }

    var button = document.getElementById("historySyncButton");

    if (!button) {
      return;
    }

    if (typeof fetch !== "function") {
      button.disabled = true;
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>';
      button.title = "업데이트 불가";
      button.classList.remove("spinning");
      return;
    }

    button.disabled = Boolean(isBusy);
    if (isBusy) {
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>';
      button.classList.add("spinning");
    } else {
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
      button.classList.remove("spinning");
    }
    button.title = isBusy ? "업데이트 중..." : "최신 회차 가져오기";
  }

  function updateFilterPreview() {
    var includeChips = document.getElementById("includeChips");
    var excludeChips = document.getElementById("excludeChips");
    var feedback = document.getElementById("resultsFeedback");
    var hint = document.querySelector(".filter-preview-panel .filter-hint");
    var filterState = buildFilterState(collectFormOptions());

    if (includeChips) {
      includeChips.innerHTML = filterState.includedNumbers.map(function(num) {
        return chipMarkup(num + "번", "고정");
      }).join("");
    }
    if (excludeChips) {
      var exHTML = filterState.excludedNumbers.slice(0, 18).map(function(num) {
        return chipMarkup(num + "번", "제외");
      }).join("");
      if (filterState.excludedCount > 18) exHTML += chipMarkup("외", (filterState.excludedCount - 18) + "개");
      excludeChips.innerHTML = exHTML;
    }
    var previewPanel = document.querySelector(".filter-preview-panel");
    if (previewPanel) {
      previewPanel.style.display = (!filterState.includedNumbers.length && !filterState.excludedCount) ? "none" : "block";
    }
    if (hint) {
      hint.style.display = "none";
    }
    if (feedback) {
      if (filterState.includedNumbers.length) feedback.textContent = "포함 번호는 항상 고정 반영되고, 제외 번호는 후보에서 제거됩니다.";
      else if (filterState.excludedCount) feedback.textContent = "현재 제외 조건만 반영된 랜덤 조합이 갱신됩니다.";
      else feedback.textContent = "현재 설정으로 아래 추천 카드가 생성됩니다.";
    }

    return filterState;
  }

  function renderHeroStats(result) {
    var hottest = topItems(result.scoreTable, "overall", 1)[0];
    var overdue = overdueItems(result.scoreTable, 1)[0];
    var heroStats = document.getElementById("heroStats");

    if (!heroStats) {
      return;
    }

    heroStats.innerHTML =
    heroStats.innerHTML =
      '<article class="hero-stat"><div style="display:flex;align-items:center;margin-bottom:0.3rem;"><span class="hero-stat-label" style="display:inline-flex;align-items:center;gap:0.3rem;margin:0;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg> 최신 당첨 회차</span><button type="button" id="historySyncButton" class="history-sync-icon" title="최신 회차 가져오기"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button></div><span class="hero-stat-value" style="display:block;">' +
      result.stats.latestRound +
      "회 / " +
      escapeHtml(result.stats.latest.date) +
      '</span><div class="ball-row" style="margin-top:0.45rem;">' +
      result.stats.latest.numbers.map(function (number) { return ballMarkup(number); }).join("") +
      '<span style="display:inline-flex;color:var(--muted);align-items:center;">+</span>' +
      ballMarkup(result.stats.latest.bonus) +
      '</div></article>' +
      '<article class="hero-stat"><span class="hero-stat-label" style="display:inline-flex;align-items:center;gap:0.3rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg> 추세 분석 데이터 범위</span><span class="hero-stat-value" style="color:var(--mint);font-size:1.1rem;">로컬 데이터 베이스 가동 중</span><div style="margin-top:0.45rem;line-height:1.6;font-size:0.92rem;color:var(--muted);"><strong style="color:var(--text);font-weight:700;">' +
      result.stats.rounds +
      '</strong>회차 전체 이력 기반<br><strong style="color:var(--text);font-weight:700;">' +
      result.recentWindow +
      '</strong>회차 핫&콜드 구간 가중치 반영</div></article>' +
      '<article class="hero-stat"><span class="hero-stat-label" style="display:inline-flex;align-items:center;gap:0.3rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg> 주요 주목 (예상) 번호</span><span class="hero-stat-value" style="color:var(--accent);font-size:1.1rem;">시그널 감지 렌즈 동작</span><div style="margin-top:0.6rem;display:flex;gap:0.4rem;align-items:center;">' +
      (hottest && overdue ? ballMarkup(hottest.number) + '<div style="display:flex;flex-direction:column;margin-right:0.6rem;"><span style="color:var(--text);font-size:0.85rem;font-weight:700;">강세 구간</span><span style="color:var(--muted);font-size:0.75rem;">+누적 ' + hottest.overall + '회</span></div><span style="border-left:1px solid rgba(255,255,255,0.1);height:1.8rem;margin:0 0.2rem;"></span>' + ballMarkup(overdue.number) + '<div style="display:flex;flex-direction:column;"><span style="color:var(--text);font-size:0.85rem;font-weight:700;">콜드 구간</span><span style="color:var(--muted);font-size:0.75rem;">'+ overdue.gap +'회 연속 미출현</span></div>' : '<span class="microcopy">추천 핵심 번호 계산 중</span>') +
      "</div></article>";
  }

  function renderPatternPanel(result, ticketIndex) {
    var title = document.getElementById("patternTitle");
    var board = document.getElementById("patternBoard");
    var legend = document.getElementById("heatmapLegend");
    var summary = document.getElementById("patternSummary");

    if (!title || !board) {
      return;
    }

    var activeIndex = clampTicketIndex(ticketIndex, result);
    
    if (!result || !result.tickets.length || activeIndex < 0) {
      title.textContent = "아래 번호를 눌러주세요";
      if (summary) summary.style.display = "none";
      if (legend) legend.style.display = "none";
      board.innerHTML = NUMBER_RANGE.map(function (number) {
        return '<div class="pattern-cell"><span class="pattern-cell-number">' + number + "</span></div>";
      }).join("");
      return;
    }

    var activeIndex = clampTicketIndex(ticketIndex, result);
    var ticket = result.tickets[activeIndex];
    var selectedSet = new Set(ticket.numbers);
    var total = sumNumbers(ticket.numbers);
    var oddCount = ticket.numbers.filter(function (number) { return number % 2 !== 0; }).length;

    var maxRecent = 0;
    if (result.scoreTable) {
      Object.keys(result.scoreTable).forEach(function(num) {
        if (result.scoreTable[num].recent > maxRecent) maxRecent = result.scoreTable[num].recent;
      });
    }

    title.textContent = String(activeIndex + 1).padStart(2, "0") + "번 세트 패턴 분석";
    if (summary) summary.style.display = "none";
    if (legend) legend.style.display = "flex";
    
    board.innerHTML = NUMBER_RANGE.map(function (number) {
      var classNames = ["pattern-cell"];
      var style = "";
      var isSelected = selectedSet.has(number);
      var isFixed = result.filterState.includedSet.has(number);

      if (isSelected) classNames.push("is-selected");
      if (isFixed) classNames.push("is-fixed");

      if (maxRecent > 0) {
        var recentCount = result.scoreTable[number] ? result.scoreTable[number].recent : 0;
        var ratio = recentCount / maxRecent; 
        if (ratio > 0) {
          var bgAlpha = isSelected ? ratio * 0.9 : ratio * 0.5;
          var borderOverride = (isSelected || isFixed) ? "" : ' border-color: rgba(255, 60, 60, ' + (ratio * 0.3) + ');';
          style = ' style="background-color: rgba(255, 60, 60, ' + bgAlpha + ');' + borderOverride + ' color: #fff;"';
        }
      }

      return '<div class="' + classNames.join(" ") + '"' + style + '><span class="pattern-cell-number">' + number + "</span></div>";
    }).join("");
  }

  function renderTickets(result) {
    var target = document.getElementById("ticketsGrid");
    var generationMeta = document.getElementById("generationMeta");
    var feedback = document.getElementById("resultsFeedback");
    var filterSummary = formatFilterSummary(result.filterState);
    var includeSummary = formatIncludeSummary(result.filterState);
    var activeIndex = clampTicketIndex(appState.activeTicketIndex, result);

    var sourcePattern = document.getElementById("patternPanel");
    if (sourcePattern) {
      sourcePattern.style.display = "none";
      document.body.appendChild(sourcePattern);
    }

    if (generationMeta) {
      generationMeta.textContent = PROFILE_COPY[result.profile] + " / 최근 " + result.recentWindow + "회 특별 반영 / " + includeSummary + " / " + filterSummary;
    }
    if (feedback) {
      feedback.textContent = result.error ? result.error : PROFILE_COPY[result.profile] + " 기준으로 " + result.ticketCount + "개 조합이 생성되었습니다. 우측 패턴 지도를 확인해 보세요.";
    }
    if (!target) {
      renderPatternPanel(result, activeIndex);
      return;
    }
    if (!result.tickets.length) {
      target.innerHTML = '<article class="ticket-card ticket-card-empty"><div class="ticket-head"><span class="ticket-index">!</span><span class="ticket-mode">조건 조정 필요</span></div><p>' + escapeHtml(result.error || "현재 조건으로는 유효한 조합을 만들 수 없습니다.") + '</p><div class="ticket-meta"><span class="pill">' + escapeHtml(filterSummary) + "</span></div></article>";
      renderPatternPanel(result, activeIndex);
      return;
    }

    target.innerHTML = result.tickets.map(function (ticket, index) {
      var activeClass = index === activeIndex ? " is-active" : "";
      var delay = index * 0.06 + "s";
      var inlineContainer = index === activeIndex ? '<div id="inlinePatternTarget" style="margin-top: 1rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 1rem; cursor: default;" onclick="event.stopPropagation();"></div>' : '';
      return '<div class="ticket-card animate-in' + activeClass + '" data-ticket-index="' + index + '" style="animation-delay: ' + delay + '; cursor: pointer;">' +
        '<span class="ball-row" style="align-items: center; margin-bottom: 0.6rem;">' +
        '<span class="ticket-index" style="margin-right: 0.2rem;">' + String(index + 1).padStart(2, "0") + '</span>' +
        ticket.numbers.map(function (number) {
          return ballMarkup(number, { fixed: result.filterState.includedSet.has(number) });
        }).join("") +
        '</span><span class="ticket-meta" style="margin-top: 0;">' +
        '<span class="pill" style="color:var(--text); background:rgba(255,255,255,0.1)">' + PROFILE_COPY[ticket.profile || result.profile] + '</span>' +
        ticket.meta.map(function (item) { return '<span class="pill">' + escapeHtml(item) + "</span>"; }).join("") +
        "</span>" + inlineContainer + "</div>";
    }).join("");

    renderPatternPanel(result, activeIndex);

    var targetPattern = document.getElementById("inlinePatternTarget");
    if (targetPattern && sourcePattern) {
      targetPattern.appendChild(sourcePattern);
      sourcePattern.style.display = "block";
      sourcePattern.style.margin = "0";
      sourcePattern.style.padding = "0";
      sourcePattern.style.background = "transparent";
      sourcePattern.style.border = "none";
      setTimeout(drawPatternLines, 50);
    }
  }

  function drawPatternLines() {
    var board = document.getElementById("patternBoard");
    if (!board) return;

    var existingSvg = board.querySelector("svg.pattern-lines-svg");
    if (existingSvg) existingSvg.remove();

    var selectedCells = Array.from(board.querySelectorAll(".pattern-cell.is-selected"));
    if (selectedCells.length < 2) return;

    selectedCells.sort(function(a, b) {
      return parseInt(a.textContent, 10) - parseInt(b.textContent, 10);
    });

    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "pattern-lines-svg");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "1";

    board.style.position = "relative";

    var points = [];
    var boardRect = board.getBoundingClientRect();

    selectedCells.forEach(function(cell) {
      var cellRect = cell.getBoundingClientRect();
      var x = cellRect.left - boardRect.left + (cellRect.width / 2);
      var y = cellRect.top - boardRect.top + (cellRect.height / 2);
      points.push(x + "," + y);
    });

    var polyline = document.createElementNS(svgNS, "polyline");
    polyline.setAttribute("points", points.join(" "));
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "rgba(255, 79, 165, 0.8)");
    polyline.setAttribute("stroke-width", "2");
    
    svg.appendChild(polyline);
    board.appendChild(svg);
  }

  function renderAnalysis(result) {
    var target = document.getElementById("analysisGrid");
    var hotRecent;
    var hotOverall;
    var overdue;
    var pairs;

    if (!target) {
      return;
    }

    hotRecent = topItems(result.scoreTable, "recent", 7);
    hotOverall = topItems(result.scoreTable, "overall", 7);
    overdue = overdueItems(result.scoreTable, 7);
    pairs = pairItems(result.stats.pairCounts, 5);

    function formatConsecutive(numbers) {
      var nums = numbers.slice().sort(function(a, b) { return a - b; });
      var groups = [];
      var currentGroup = [nums[0]];
      for (var i = 1; i < nums.length; i++) {
        if (nums[i] === nums[i - 1] + 1) {
          currentGroup.push(nums[i]);
        } else {
          groups.push(currentGroup.length > 1 ? '<span style="color:var(--yellow-ball);">(' + currentGroup.join(" ") + ')</span>' : currentGroup[0]);
          currentGroup = [nums[i]];
        }
      }
      groups.push(currentGroup.length > 1 ? '<span style="color:var(--yellow-ball);">(' + currentGroup.join(" ") + ')</span>' : currentGroup[0]);
      return groups.join(" ");
    }

    var recentDraws = global.LOTTO_HISTORY.slice(-4).reverse();
    var consecutiveHtml = recentDraws.map(function(d) {
      return '<div style="margin-bottom:0.6rem;display:flex;align-items:center;gap:0.8rem;"><span style="color:var(--muted);font-size:0.85rem;min-width:3rem;">' + d.round + '회</span><span style="font-weight:700;letter-spacing:1px;color:#fff;">' + formatConsecutive(d.numbers) + '</span></div>';
    }).join("");

    target.innerHTML =
      '<article class="analysis-card"><h3>📈 최근 연속 번호 릴레이</h3><p>가장 최근 4회차 당첨 번호의 연속 숫자(연번) 추세입니다.</p><div style="margin-top:0.8rem;">' +
      consecutiveHtml +
      '</div></article>' +
      '<article class="analysis-card"><h3>🔥 최근 강세 번호</h3><p>최근 ' + result.recentWindow + '회 안에서 자주 등장한 번호입니다.</p><div class="number-list">' +
      hotRecent.map(function (item) { return chipMarkup(item.number + "번", item.recent + "회"); }).join("") +
      '</div></article>' +
      '<article class="analysis-card"><h3>⭐ 누적 강세 번호</h3><p>동행복권 1회차부터 가장 꾸준히 나온 번호입니다.</p><div class="number-list">' +
      hotOverall.map(function (item) { return chipMarkup(item.number + "번", item.overall + "회"); }).join("") +
      '</div></article>' +
      '<article class="analysis-card"><h3>⏳ 오래 쉰 번호</h3><p>현재 최신 회차를 기준으로 오랫동안 나오지 않고 있는 번호입니다.</p><div class="number-list">' +
      overdue.map(function (item) { return chipMarkup(item.number + "번", item.gap + "회 공백"); }).join("") +
      '</div></article>' +
      '<article class="analysis-card"><h3>🎯 필터 조건 현황</h3><p>선택하신 고정 및 제외 번호가 생성 카드에 적용됩니다.</p><div class="number-list">' +
      (result.filterState.includedNumbers.length ? result.filterState.includedNumbers.map(function (number) { return chipMarkup(number + "번", "고정"); }).join("") : chipMarkup("고정 번호", "없음")) +
      (result.filterState.excludedCount ? result.filterState.excludedNumbers.slice(0, 12).map(function (number) { return chipMarkup(number + "번", "제외"); }).join("") + (result.filterState.excludedCount > 12 ? chipMarkup("외", String(result.filterState.excludedCount - 12) + "개") : "") : chipMarkup("제외 번호", "없음")) +
      '</div></article>' +
      '<article class="analysis-card"><h3>🤝 단짝 번호쌍</h3><p>해당 구간 내에서 항상 함께 다니는 단짝 조합입니다.</p><div class="number-list">' +
      pairs.map(function (entry) { return chipMarkup(entry[0] + "번 조합", entry[1] + "회"); }).join("") +
      "</div></article>";
  }

  function renderScoreboard(result) {
    var target = document.getElementById("scoreboard");

    if (!target) {
      return;
    }
    if (!result.scoreTable.length) {
      target.innerHTML = '<div class="score-row"><div class="score-label">조건이 많습니다</div><div class="score-bar"><span style="width:0%"></span></div><div class="score-value">0점</div><div class="score-detail">제외를 조금 줄여보세요</div></div>';
      return;
    }

    var topScore = result.scoreTable[0].score;
    target.innerHTML = result.scoreTable.slice(0, 15).map(function (item) {
      var width = ((item.score / topScore) * 100).toFixed(1);
      return '<div class="score-row"><div class="score-label">' +
        ballMarkup(item.number, { fixed: result.filterState.includedSet.has(item.number) }) +
        '</div><div class="score-bar"><span style="width:' +
        width +
        '%"></span></div><div class="score-value">' +
        Math.round(item.score * 1000) +
        '점</div><div class="score-detail">최근 ' +
        item.recent +
        "회 / 공백 " +
        item.gap +
        "회</div></div>";
    }).join("");
  }

  function getActiveHistory() {
    var baseHistory = [];

    if (Array.isArray(global.LOTTO_HISTORY) && global.LOTTO_HISTORY.length) {
      baseHistory = global.LOTTO_HISTORY.slice();
    } else if (appState.history && appState.history.length) {
      baseHistory = appState.history.slice();
    }

    appState.history = mergeLatestOverride(baseHistory, global.LOTTO_LATEST_OVERRIDE);
    return appState.history;
  }

  function runApp(options) {
    if (options && options.profile === "pool_mix") {
      var size = appState.poolNumberSet.size;
      var combs = combinations(size, 6);
      if (size < 6 || combs < options.count) {
        alert("풀에 선택된 번호가 부족하여 " + options.count + "개의 세트를 생성할 수 없습니다.");
        return appState.latestResult || null;
      }
    }
    
    var history = (options && options.history) || getActiveHistory();

    if (!history.length) {
      throw new Error("LOTTO_HISTORY data is missing.");
    }

    var result = generateRecommendations(history, options);
    appState.latestResult = result;
    appState.activeTicketIndex = clampTicketIndex(appState.activeTicketIndex, result);
    renderHeroStats(result);
    renderTickets(result);
    renderAnalysis(result);
    renderScoreboard(result);
    return result;
  }

  function handleNumberPick(numberStr) {
    var number = Number(numberStr);
    var currentState = appState.filterStateMap[number];
    if (currentState === "include") {
      appState.filterStateMap[number] = "exclude";
    } else if (currentState === "exclude") {
      delete appState.filterStateMap[number];
    } else {
      var includeCount = Object.keys(appState.filterStateMap).filter(function(k) { return appState.filterStateMap[k] === "include"; }).length;
      if (includeCount >= 6) {
        var feedback = document.getElementById("resultsFeedback");
        if (feedback) feedback.textContent = "고정 번호는 최대 6개까지 선택할 수 있습니다.";
        return;
      }
      appState.filterStateMap[number] = "include";
    }
    renderFilterControls();
    updateFilterPreview();
  }

  function handleTicketSelection(event) {
    var card = event.target.closest("[data-ticket-index]");
    if (!card || !appState.latestResult) {
      return;
    }
    var clickedIndex = Number(card.getAttribute("data-ticket-index")) || 0;
    if (appState.activeTicketIndex === clickedIndex) {
      appState.activeTicketIndex = -1;
    } else {
      appState.activeTicketIndex = clickedIndex;
    }
    renderTickets(appState.latestResult);
  }

  function parseLottoDrawPayload(payload) {
    var numbers;

    if (!payload || payload.returnValue !== "success") {
      return null;
    }

    numbers = range(1, 6).map(function (index) {
      return Number(payload["drwtNo" + index]);
    });

    if (
      numbers.some(function (number) {
        return !number;
      })
    ) {
      return null;
    }

    return {
      round: Number(payload.drwNo),
      date: String(payload.drwNoDate),
      numbers: numbers.sort(function (left, right) {
        return left - right;
      }),
      bonus: Number(payload.bnusNo),
    };
  }

  function fetchRoundData(round) {
    if (typeof fetch !== "function") {
      return Promise.resolve(null);
    }

    return fetch(LOTTO_API_URL + round, { cache: "no-store" })
      .then(function (response) {
        return response.text();
      })
      .then(function (text) {
        return parseLottoDrawPayload(JSON.parse(text));
      })
      .catch(function () {
        return null;
      });
  }

  function syncLatestHistory(silentMode) {
    var history = getActiveHistory();
    var baseRound;
    var expectedRound;
    var expectedDiff;
    var nextRound;
    var syncedRounds = 0;
    var updatedHistory;

    if (!history.length) {
      setHistorySyncStatus("내장 회차 데이터가 없어 최신 회차를 확인할 수 없습니다.", "error");
      return Promise.resolve(0);
    }

    baseRound = history[history.length - 1].round;
    var firstDrawTime = new Date('2002-12-07T20:45:00+09:00').getTime();
    expectedRound = Math.floor((Date.now() - firstDrawTime) / (1000 * 60 * 60 * 24 * 7)) + 1;
    expectedDiff = expectedRound - baseRound;

    if (expectedDiff <= 0) {
      if (!silentMode) {
        setHistorySyncStatus("이미 로컬 데이터가 최신(" + baseRound + "회)입니다. 업데이트 불필요.", "success");
      }
      return Promise.resolve(0);
    }

    nextRound = baseRound + 1;
    updatedHistory = history.slice();
    if (!silentMode) {
      setHistorySyncStatus("로컬 " + baseRound + "회 기준, 예상 누락 회차(" + expectedDiff + "회)를 동행복권에서 가져옵니다.", "info");
    }

    function step() {
      if (nextRound > expectedRound || nextRound > baseRound + MAX_SYNC_ROUNDS) {
        return Promise.resolve();
      }

      return fetchRoundData(nextRound).then(function (draw) {
        if (!draw) {
          return null;
        }

        updatedHistory.push(draw);
        syncedRounds += 1;
        nextRound += 1;
        return step();
      });
    }

    return step().then(function () {
      appState.history = updatedHistory;
      global.LOTTO_HISTORY = updatedHistory;

      if (syncedRounds) {
        setHistorySyncStatus(syncedRounds + "개 회차를 가져왔습니다! (현재 " + updatedHistory[updatedHistory.length - 1].round + "회)", "success");
      } else {
        if (silentMode) {
          setHistorySyncStatus("최신 회차 확인 대기 중... (현재 " + baseRound + "회)", "info");
        } else {
          setHistorySyncStatus("API 상태가 원활하지 않아 로컬 데이터 " + baseRound + "회 기준으로 표시 중입니다.", "info");
        }
      }

      return syncedRounds;
    });
  }

  function handleHistorySyncRequest(silentMode) {
    if (appState.isSyncing) {
      return Promise.resolve(0);
    }

    appState.isSyncing = true;
    setSyncButtonState(true);

    return syncLatestHistory(silentMode)
      .then(function (syncedRounds) {
        if (syncedRounds) {
          appState.activeTicketIndex = -1;
          runApp(collectFormOptions());
        }
        return syncedRounds;
      })
      .catch(function () {
        setHistorySyncStatus("최신 회차를 불러오는 중 오류가 발생했습니다.", "error");
        return 0;
      })
      .then(function (syncedRounds) {
        appState.isSyncing = false;
        setSyncButtonState(false);
        return syncedRounds;
      });
  }

  function initDom() {
    var form = document.getElementById("generatorForm");
    var ticketsGrid = document.getElementById("ticketsGrid");
    var historySyncButton = document.getElementById("historySyncButton");
    var unifiedGrid = document.getElementById("unifiedNumberGrid");

    if (!form) {
      return;
    }

    renderFilterControls();
    updateFilterPreview();
    runApp(collectFormOptions());
    setSyncButtonState(false);

    if (typeof fetch === "function") {
      handleHistorySyncRequest(true).then(function(syncedRounds) {
        if (!syncedRounds) {
           var history = getActiveHistory();
           if (history.length) setHistorySyncStatus("오프라인-First: 로컬 데이터(" + history[history.length - 1].round + "회)가 최신과 동일합니다. (트래픽 0)", "success");
        }
      });
    } else {
      setHistorySyncStatus("이 환경에서는 최신 회차 업데이트를 사용할 수 없습니다.", "error");
    }
    
    var resetBtn = document.getElementById("resetFiltersBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", function() {
        appState.filterStateMap = {};
        if (appState.filterState) {
          appState.filterState.includedSet.clear();
          appState.filterState.excludedSet.clear();
        }
        renderFilterControls();
        updateFilterPreview();
      });
    }

    var refreshTicketsBtn = document.getElementById("refreshTicketsBtn");
    if (refreshTicketsBtn) {
      refreshTicketsBtn.addEventListener("click", function() {
        runApp(collectFormOptions());
      });
    }
    
    var profileEl = document.getElementById("profile");
    var poolPanel = document.getElementById("poolPanel");
    if (profileEl && poolPanel) {
      function togglePoolPanel() {
        if (profileEl.value === "pool_mix") {
          poolPanel.style.display = "block";
        } else {
          poolPanel.style.display = "none";
        }
        if (typeof renderPoolGrid === "function") renderPoolGrid();
      }
      profileEl.addEventListener("change", togglePoolPanel);
      togglePoolPanel();
    }
    
    var ticketCountEl = document.getElementById("ticketCount");
    if (ticketCountEl) {
      ticketCountEl.addEventListener("change", function() {
        if (typeof renderPoolGrid === "function") renderPoolGrid();
      });
    }

    var poolGridTarget = document.getElementById("poolNumberGrid");
    var poolCountEl = document.getElementById("poolCount");
    var poolHelperEl = document.getElementById("poolCombinationHelper");
    var resetPoolBtn = document.getElementById("resetPoolBtn");
    
    function renderPoolGrid() {
      if (!poolGridTarget) return;
      poolGridTarget.innerHTML = NUMBER_RANGE.map(function(number) {
        var isSelected = appState.poolNumberSet.has(number);
        var boxClass = isSelected ? "number-pick-box is-include" : "number-pick-box";
        return '<div class="number-pick"><button type="button" class="' + boxClass + '" data-num="' + number + '">' + number + '</button></div>';
      }).join("");
      
      var size = appState.poolNumberSet.size;
      var generateBtn = document.getElementById("generateBtn");
      var currentProfile = profileEl ? profileEl.value : "balanced";
      var currentTicketCount = ticketCountEl ? parseInt(ticketCountEl.value, 10) : 5;
      var isPoolMix = currentProfile === "pool_mix";

      if (poolCountEl) poolCountEl.textContent = size;
      if (poolHelperEl) {
        if (size < 6) {
          poolHelperEl.textContent = "6개 이상의 숫자를 선택해주세요.";
          poolHelperEl.style.color = "var(--danger, #ff4e4e)";
          if (isPoolMix && generateBtn) generateBtn.disabled = true;
        } else {
          var combs = combinations(size, 6);
          if (combs < currentTicketCount) {
             poolHelperEl.textContent = "선택된 풀 조합의 수(" + combs.toLocaleString() + "개)가 요청한 생성 개수(" + currentTicketCount + "개)보다 적습니다.";
             poolHelperEl.style.color = "var(--danger, #ff4e4e)";
             if (isPoolMix && generateBtn) generateBtn.disabled = true;
          } else {
            poolHelperEl.textContent = "총 " + combs.toLocaleString() + "개의 조합 중 추출됩니다.";
            poolHelperEl.style.color = "";
            if (isPoolMix && generateBtn) generateBtn.disabled = false;
          }
        }
      }
      
      if (!isPoolMix && generateBtn) {
        generateBtn.disabled = false;
      }
    }

    if (resetPoolBtn) {
      resetPoolBtn.addEventListener("click", function() {
        appState.poolNumberSet.clear();
        document.getElementById("scannedGamesPreview").innerHTML = "";
        renderPoolGrid();
      });
    }

    if (poolGridTarget) {
      poolGridTarget.addEventListener("click", function(event) {
        var btn = event.target.closest("button[data-num]");
        if (!btn) return;
        var num = parseInt(btn.getAttribute("data-num"), 10);
        if (appState.poolNumberSet.has(num)) {
          appState.poolNumberSet.delete(num);
        } else {
          appState.poolNumberSet.add(num);
        }
        renderPoolGrid();
      });
    }

    renderPoolGrid();

    var startQrBtn = document.getElementById("startQrBtn");
    var stopQrBtn = document.getElementById("stopQrBtn");
    var html5QrCode;
    
    if (startQrBtn && stopQrBtn) {
      startQrBtn.addEventListener("click", function() {
        if (typeof Html5Qrcode === "undefined") {
          alert("QR 스캐너 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
          return;
        }
        html5QrCode = new Html5Qrcode("qrReader");
        document.getElementById("qrReader").style.display = "block";
        startQrBtn.style.display = "none";
        stopQrBtn.style.display = "block";
        
        html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          function(decodedText, decodedResult) {
            var games = extractGamesFromText(decodedText);
            if (games.length > 0) {
               games.forEach(function(game) {
                 game.forEach(function(n) { appState.poolNumberSet.add(n); });
               });
               
               var previewHtml = games.map(function(game, index) {
                 var letter = String.fromCharCode(65 + index);
                 return '<div style="display: flex; align-items: center; gap: 8px;">' +
                   '<span style="font-weight: 700; width: 14px;">' + letter + '</span>' +
                   '<div class="ticket-balls" style="font-size: 0.8em; margin: 0;">' + 
                   game.map(function(n){ return ballMarkup(n); }).join("") +
                   '</div></div>';
               }).join("");
               
               document.getElementById("scannedGamesPreview").innerHTML = previewHtml;
               renderPoolGrid();
            }
            html5QrCode.stop().then(function() {
               document.getElementById("qrReader").style.display = "none";
               startQrBtn.style.display = "block";
               stopQrBtn.style.display = "none";
            });
          },
          function(errorMessage) {
            // ignore parsing errors on intermediate frames
          }
        ).catch(function(err) {
          alert("카메라 시작에 실패했습니다. 권한을 확인해주세요.");
          document.getElementById("qrReader").style.display = "none";
          startQrBtn.style.display = "block";
          stopQrBtn.style.display = "none";
        });
      });
      
      stopQrBtn.addEventListener("click", function() {
        if (html5QrCode) {
          html5QrCode.stop().then(function() {
            document.getElementById("qrReader").style.display = "none";
            startQrBtn.style.display = "block";
            stopQrBtn.style.display = "none";
          });
        }
      });
    }

    form.addEventListener("change", function () {
      updateFilterPreview();
    });

    if (unifiedGrid) {
      unifiedGrid.addEventListener("click", function(event) {
        var btn = event.target.closest("button[data-num]");
        if (!btn) return;
        handleNumberPick(btn.getAttribute("data-num"));
      });
    }

    if (ticketsGrid) {
      ticketsGrid.addEventListener("click", handleTicketSelection);
    }

    document.body.addEventListener("click", function (e) {
      if (e.target.closest("#historySyncButton") || e.target.id === "historySyncButton") {
        handleHistorySyncRequest(false);
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      
      var profileEl = document.getElementById("profile");
      if (profileEl && profileEl.value === "pool_mix") {
        var size = appState.poolNumberSet.size;
        var ticketCountEl = document.getElementById("ticketCount");
        var currentTicketCount = ticketCountEl ? parseInt(ticketCountEl.value, 10) : 5;
        var combs = combinations(size, 6);
        if (size < 6 || combs < currentTicketCount) {
           return; 
        }
      }

      appState.activeTicketIndex = -1;
      runApp(collectFormOptions());

      if (ticketsGrid) {
        ticketsGrid.classList.remove("is-refreshing");
        void ticketsGrid.offsetWidth;
        ticketsGrid.classList.add("is-refreshing");
      }

      var resultsPanel = document.getElementById("resultsPanel");
      if (resultsPanel) {
        setTimeout(function() {
          resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    });

  }

  var api = {
    analyzeHistory: analyzeHistory,
    buildFilterState: buildFilterState,
    buildScoreTable: buildScoreTable,
    generateRecommendations: generateRecommendations,
    mergeLatestOverride: mergeLatestOverride,
    normalizeDraw: normalizeDraw,
    parseLottoDrawPayload: parseLottoDrawPayload,
    syncLatestHistory: syncLatestHistory,
    validateTicket: validateTicket,
    runApp: runApp,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  global.LottoApp = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initDom);
    } else {
      initDom();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
