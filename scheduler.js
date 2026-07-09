/*
 * 테니스 복식 대진표 스케줄러
 * ---------------------------------
 * 참석자 이름 목록과 코트 수, 라운드 수를 받아
 * 매 라운드마다 코트당 4명(2:2 복식)으로 배정하고,
 * 남는 인원은 휴식으로 돌리는 대진표를 생성한다.
 *
 * 목표 우선순위
 *   1) 모든 참석자의 경기 수를 최대한 균등하게 (공정성)
 *   2) 같은 파트너가 반복되지 않게 (파트너 다양성)
 *   3) 같은 상대가 반복되지 않게 (상대 다양성)
 *
 * 레벨(A/B 그룹) 지원:
 *   opts.groups와 opts.groupRounds를 주면, 앞의 groupRounds개 라운드는
 *   같은 그룹끼리만(A는 A끼리, B는 B끼리) 코트를 나눠 쓰고, 나머지 라운드는
 *   전체를 섞어 배정한다. 코트는 그룹 인원 비율에 맞춰 나눈다.
 *   경기 수·파트너·상대 반복 통계는 그룹 여부와 상관없이 전원에 대해
 *   계속 누적되므로, 혼합 라운드에서 그룹 간 인원 차이로 인한 경기 수
 *   편차도 자연스럽게 보정된다.
 *
 * 브라우저(전역 window.Scheduler)와 Node(module.exports) 양쪽에서 사용 가능.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.Scheduler = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var COURT_SIZE = 4; // 복식: 코트당 4명
  var SINGLES_SIZE = 2; // 단식: 코트당 2명

  // 결정적(시드 기반) 난수 생성기 — 같은 입력이면 같은 대진표가 나오도록.
  function makeRng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      // mulberry32
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function key(i, j) {
    return i < j ? i + "-" + j : j + "-" + i;
  }

  // 복식 우선 + 남는 코트/인원이 있으면 단식 1코트를 추가하는 코트 구성 계산.
  function planCourts(poolSize, availableCourts) {
    var doublesCourts = Math.min(availableCourts, Math.floor(poolSize / COURT_SIZE));
    var remPlayers = poolSize - COURT_SIZE * doublesCourts;
    var remCourts = availableCourts - doublesCourts;
    var singlesCourts = remPlayers >= SINGLES_SIZE && remCourts >= 1 ? 1 : 0;
    var usableCourts = doublesCourts + singlesCourts;
    var seats = COURT_SIZE * doublesCourts + SINGLES_SIZE * singlesCourts;
    var courtSizes = [];
    for (var dc = 0; dc < doublesCourts; dc++) courtSizes.push(COURT_SIZE);
    for (var sc = 0; sc < singlesCourts; sc++) courtSizes.push(SINGLES_SIZE);
    return {
      doublesCourts: doublesCourts,
      singlesCourts: singlesCourts,
      usableCourts: usableCourts,
      seats: seats,
      rest: poolSize - seats,
      courtSizes: courtSizes,
    };
  }

  // 그룹 라운드에서 총 코트를 A/B 인원 비율로 분배. 코트가 2개 이상이고
  // 양쪽 다 인원이 있으면 각 그룹에 최소 1코트씩은 배정한다.
  function splitCourtsForGroups(nA, nB, totalCourts, roundIndex) {
    if (totalCourts <= 0) return { courtsA: 0, courtsB: 0 };
    if (nA === 0) return { courtsA: 0, courtsB: totalCourts };
    if (nB === 0) return { courtsA: totalCourts, courtsB: 0 };
    if (totalCourts === 1) {
      // 코트가 1개뿐이면 라운드마다 번갈아 배정
      return roundIndex % 2 === 0 ? { courtsA: 1, courtsB: 0 } : { courtsA: 0, courtsB: 1 };
    }
    var total = nA + nB;
    var courtsA = Math.round((totalCourts * nA) / total);
    courtsA = Math.max(1, Math.min(totalCourts - 1, courtsA));
    return { courtsA: courtsA, courtsB: totalCourts - courtsA };
  }

  /**
   * 대진표 생성
   * @param {Object} opts
   * @param {string[]} opts.players  참석자 이름 목록
   * @param {number}   opts.courts   코트 수
   * @param {number}   opts.rounds   라운드(경기 회차) 수
   * @param {number}   [opts.seed]   난수 시드 (같은 값이면 결과 동일)
   * @param {("A"|"B"|null)[]} [opts.groups] 참석자별 그룹 (players와 같은 길이)
   * @param {number}   [opts.groupRounds] 그룹별로만 진행할 앞쪽 라운드 수 (기본 0)
   * @param {{a: number, b: number, count: number}[]} [opts.forcedPairs]
   *   반드시 파트너로 묶어야 하는 인원 쌍(인덱스)과 최소 횟수. 요청 횟수를
   *   채울 때까지 배정 비용에 강한 보너스를 줘서 우선 배정되게 하고,
   *   채운 뒤에는 일반 파트너 다양성 규칙으로 되돌아간다.
   * @param {{team1: [number, number], team2: [number, number]}[]} [opts.fixedMatches]
   *   대진 자체를 그대로 고정할 매치 목록(인덱스). 앞쪽 라운드부터 순서대로
   *   코트를 하나씩 예약해 이 대진 그대로 배정하고, 같은 라운드의 나머지
   *   코트·인원은 자동으로 채운다. 코트가 부족하면 다음 라운드로 넘어간다.
   * @param {number}   [opts.partnerWeight]  파트너 반복 가중치 (기본 3)
   * @param {number}   [opts.opponentWeight] 상대 반복 가중치 (기본 1)
   * @returns {{rounds: Array, summary: Array, meta: Object}}
   */
  function generate(opts) {
    opts = opts || {};
    var names = (opts.players || []).slice();
    var courts = Math.max(1, opts.courts | 0);
    var rounds = Math.max(1, opts.rounds | 0);
    var seed = opts.seed != null ? opts.seed | 0 : 12345;
    var wPartner = opts.partnerWeight != null ? opts.partnerWeight : 3;
    var wOpp = opts.opponentWeight != null ? opts.opponentWeight : 1;
    var wSingles = 2; // 단식 배정 반복 억제 가중치
    var FORCED_BONUS = 300; // 고정 매칭 미달성 시 비용 보너스(음수) 크기
    var REST_PRIORITY_BONUS = 1000; // 고정 매칭 미달성 인원을 휴식에서 제외시키는 가중치

    var N = names.length;
    if (N < COURT_SIZE) {
      throw new Error("복식 경기를 하려면 최소 " + COURT_SIZE + "명이 필요합니다.");
    }

    var groupsIn = opts.groups || null;
    var groupRounds = groupsIn ? Math.max(0, Math.min(rounds, opts.groupRounds | 0)) : 0;

    var rng = makeRng(seed);

    // 전체 인원 기준 코트 구성 (메타 표시 및 혼합 라운드에 사용)
    var fullPlan = planCourts(N, courts);

    // 상태 추적 (인덱스 기반, 그룹 여부와 무관하게 전원 공통 누적)
    var games = new Array(N).fill(0); // 경기 수
    var rests = new Array(N).fill(0); // 휴식 수
    var singlesPlayed = new Array(N).fill(0); // 단식 경기 수
    var partner = {}; // key -> 함께 팀한 횟수
    var opponent = {}; // key -> 상대로 만난 횟수

    function partnerCount(i, j) {
      return partner[key(i, j)] || 0;
    }
    function opponentCount(i, j) {
      return opponent[key(i, j)] || 0;
    }

    // 고정 매칭(반드시 파트너로 묶일 쌍) 설정
    var forcedPairs = (opts.forcedPairs || [])
      .map(function (fp) {
        return { a: fp.a | 0, b: fp.b | 0, count: Math.max(1, fp.count | 0 || 1) };
      })
      .filter(function (fp) {
        return fp.a !== fp.b && fp.a >= 0 && fp.b >= 0 && fp.a < N && fp.b < N;
      });
    var forcedMap = {}; // key(a,b) -> 요구 횟수
    forcedPairs.forEach(function (fp) {
      forcedMap[key(fp.a, fp.b)] = fp.count;
    });

    // 아직 요구 횟수를 못 채운 고정 매칭이면 강한 보너스(음수 비용)를 준다.
    function forcedBonus(i, j) {
      var required = forcedMap[key(i, j)];
      if (!required) return 0;
      return partnerCount(i, j) < required ? -FORCED_BONUS : 0;
    }

    // x가 아직 못 채운 고정 매칭에 걸려 있는지 — 걸려 있으면 쉬는 순번에서 밀어준다.
    function hasUnmetForced(x) {
      for (var i = 0; i < forcedPairs.length; i++) {
        var fp = forcedPairs[i];
        if ((fp.a === x || fp.b === x) && partnerCount(fp.a, fp.b) < fp.count) return true;
      }
      return false;
    }

    // 대진 자체 고정(팀1 vs 팀2를 그대로) — 앞 라운드부터 코트를 예약해 배정한다.
    var fixedMatchQueue = (opts.fixedMatches || [])
      .map(function (fm) {
        return {
          team1: [fm.team1[0] | 0, fm.team1[1] | 0],
          team2: [fm.team2[0] | 0, fm.team2[1] | 0],
        };
      })
      .filter(function (fm) {
        var four = fm.team1.concat(fm.team2);
        if (four.some(function (x) { return x < 0 || x >= N; })) return false;
        var uniq = {};
        return four.every(function (x) {
          if (uniq[x]) return false;
          uniq[x] = true;
          return true;
        });
      });
    var fixedMatchResults = fixedMatchQueue.map(function (fm) {
      return { team1: fm.team1, team2: fm.team2, round: null };
    });
    var fixedQueuePos = 0;

    // 코트 배정: 랜덤 재시작 그리디로 비용이 가장 낮은 배정을 찾는다.
    // sizes: 각 코트 인원 목록 (예: [4,4,4,2] → 복식 3 + 단식 1)
    function assignCourts(playing, sizes) {
      var attempts = 240;
      var bestCourts = null;
      var bestCost = Infinity;
      for (var t = 0; t < attempts; t++) {
        var shuffled = shuffle(playing, rng);
        var courtsArr = [];
        var cost = 0;
        var idx = 0;
        for (var c = 0; c < sizes.length; c++) {
          var sz = sizes[c];
          var group = shuffled.slice(idx, idx + sz);
          idx += sz;
          if (sz === COURT_SIZE) {
            var split = bestSplit(group);
            cost += split.cost;
            courtsArr.push({ type: "doubles", team1: split.team1, team2: split.team2 });
          } else {
            // 단식: 상대 반복 + 단식 편중을 비용에 반영
            cost += wOpp * opponentCount(group[0], group[1]);
            cost += wSingles * (singlesPlayed[group[0]] + singlesPlayed[group[1]]);
            courtsArr.push({ type: "singles", team1: [group[0]], team2: [group[1]] });
          }
        }
        if (cost < bestCost) {
          bestCost = cost;
          bestCourts = courtsArr;
          if (cost === 0) break; // 완벽한 배정이면 조기 종료
        }
      }
      return bestCourts;
    }

    // 4명을 두 팀으로 나누는 3가지 경우 중 비용 최소 선택
    function bestSplit(four) {
      var a = four[0], b = four[1], c = four[2], d = four[3];
      var splits = [
        { team1: [a, b], team2: [c, d] },
        { team1: [a, c], team2: [b, d] },
        { team1: [a, d], team2: [b, c] },
      ];
      var best = null;
      for (var i = 0; i < splits.length; i++) {
        var s = splits[i];
        var cost = splitCost(s.team1, s.team2);
        if (best === null || cost < best.cost) {
          best = { team1: s.team1, team2: s.team2, cost: cost };
        }
      }
      return best;
    }

    function splitCost(t1, t2) {
      var cost = 0;
      cost += wPartner * partnerCount(t1[0], t1[1]) + forcedBonus(t1[0], t1[1]);
      cost += wPartner * partnerCount(t2[0], t2[1]) + forcedBonus(t2[0], t2[1]);
      for (var i = 0; i < 2; i++) {
        for (var j = 0; j < 2; j++) {
          cost += wOpp * opponentCount(t1[i], t2[j]);
        }
      }
      return cost;
    }

    // 주어진 인원 풀(pool)과 사용 가능 코트 수로 한 라운드분을 배정하고
    // 공용 상태(games/rests/partner/opponent/singlesPlayed)를 갱신한다.
    // 반환값의 courts/resting은 아직 이름이 아닌 인덱스 기반이다.
    function runRoundForPool(pool, availableCourts) {
      if (pool.length === 0 || availableCourts <= 0) {
        return { courts: [], resting: pool.slice() };
      }
      var plan = planCourts(pool.length, availableCourts);

      var order = shuffle(pool, rng); // 동점 tie-break용 무작위 섞기
      order.sort(function (a, b) {
        // 고정 매칭을 아직 못 채운 사람은 경기를 적게 뛴 것처럼 취급해
        // 휴식 순번에서 뒤로 밀어(=계속 뛰게 해) 매칭 성사 기회를 높인다.
        var pa = games[a] - (hasUnmetForced(a) ? REST_PRIORITY_BONUS : 0);
        var pb = games[b] - (hasUnmetForced(b) ? REST_PRIORITY_BONUS : 0);
        if (pb !== pa) return pb - pa; // 값이 큰(=많이 뛴) 사람 먼저 휴식
        return rests[a] - rests[b]; // 적게 쉰 사람 먼저 휴식
      });

      var resting = order.slice(0, plan.rest).sort(function (a, b) {
        return a - b;
      });
      var restSet = {};
      resting.forEach(function (x) {
        restSet[x] = true;
      });
      var playing = pool.filter(function (x) {
        return !restSet[x];
      });

      var best = assignCourts(playing, plan.courtSizes) || [];

      best.forEach(function (court) {
        var t1 = court.team1;
        var t2 = court.team2;
        if (t1.length === 2) partner[key(t1[0], t1[1])] = partnerCount(t1[0], t1[1]) + 1;
        if (t2.length === 2) partner[key(t2[0], t2[1])] = partnerCount(t2[0], t2[1]) + 1;
        t1.forEach(function (a) {
          t2.forEach(function (b) {
            opponent[key(a, b)] = opponentCount(a, b) + 1;
          });
        });
        t1.concat(t2).forEach(function (x) {
          games[x] += 1;
          if (court.type === "singles") singlesPlayed[x] += 1;
        });
      });
      resting.forEach(function (x) {
        rests[x] += 1;
      });

      return { courts: best, resting: resting };
    }

    function nameOf(idx) {
      return names[idx];
    }

    // 인덱스 기반 라운드 결과(코트 배열 + 그룹 태그, 휴식 인원)를 이름 기반
    // 최종 라운드 객체로 변환한다.
    function finalizeRound(roundNum, courtsRaw, restingIdx) {
      return {
        round: roundNum,
        courts: courtsRaw.map(function (court, ci) {
          return {
            court: ci + 1,
            type: court.type, // "doubles" | "singles"
            group: court.group || null, // "A" | "B" | null(혼합)
            team1: court.team1.map(nameOf),
            team2: court.team2.map(nameOf),
          };
        }),
        resting: restingIdx
          .slice()
          .sort(function (a, b) { return a - b; })
          .map(nameOf),
      };
    }

    var resultRounds = [];
    var allIndices = [];
    for (var p0 = 0; p0 < N; p0++) allIndices.push(p0);

    for (var r = 0; r < rounds; r++) {
      // ---- 0) 대진 고정: 이번 라운드에 배정할 수 있는 만큼 코트를 예약 ----
      var reservedCourts = [];
      var reservedSet = {};
      while (fixedQueuePos < fixedMatchQueue.length && reservedCourts.length < courts) {
        var fm = fixedMatchQueue[fixedQueuePos];
        var four = fm.team1.concat(fm.team2);
        if (four.some(function (x) { return reservedSet[x]; })) break; // 이번 라운드에 이미 나온 사람과 겹침
        reservedCourts.push({ type: "doubles", team1: fm.team1, team2: fm.team2, group: null });
        four.forEach(function (x) { reservedSet[x] = true; });
        fixedMatchResults[fixedQueuePos].round = r + 1;
        fixedQueuePos++;
      }
      // 예약된 대진의 파트너/상대/경기 수 상태를 먼저 갱신
      reservedCourts.forEach(function (court) {
        var t1 = court.team1, t2 = court.team2;
        partner[key(t1[0], t1[1])] = partnerCount(t1[0], t1[1]) + 1;
        partner[key(t2[0], t2[1])] = partnerCount(t2[0], t2[1]) + 1;
        t1.forEach(function (a) {
          t2.forEach(function (b) { opponent[key(a, b)] = opponentCount(a, b) + 1; });
        });
        t1.concat(t2).forEach(function (x) { games[x] += 1; });
      });
      var availableCourts = courts - reservedCourts.length;

      if (groupsIn && r < groupRounds) {
        // ---- 그룹별 라운드: A는 A끼리, B는 B끼리, 코트는 인원 비율로 분배 ----
        var poolA = [];
        var poolB = [];
        var poolOther = []; // 그룹 미지정 인원(그룹 라운드 동안은 휴식)
        for (var i = 0; i < N; i++) {
          if (reservedSet[i]) continue; // 이미 대진 고정으로 배정됨
          if (groupsIn[i] === "A") poolA.push(i);
          else if (groupsIn[i] === "B") poolB.push(i);
          else poolOther.push(i);
        }
        var split = splitCourtsForGroups(poolA.length, poolB.length, availableCourts, r);
        var rA = runRoundForPool(poolA, split.courtsA);
        var rB = runRoundForPool(poolB, split.courtsB);
        poolOther.forEach(function (x) {
          rests[x] += 1;
        });

        var courtsRaw = reservedCourts
          .concat(rA.courts.map(function (c) { return assign({}, c, { group: "A" }); }))
          .concat(rB.courts.map(function (c) { return assign({}, c, { group: "B" }); }));
        var restingIdx = rA.resting.concat(rB.resting, poolOther);

        resultRounds.push(finalizeRound(r + 1, courtsRaw, restingIdx));
      } else {
        // ---- 혼합 라운드: 그룹 구분 없이 전체 인원 대상 ----
        var pool = allIndices.filter(function (x) { return !reservedSet[x]; });
        var rAll = runRoundForPool(pool, availableCourts);
        resultRounds.push(finalizeRound(r + 1, reservedCourts.concat(rAll.courts), rAll.resting));
      }
    }

    function assign(target) {
      for (var s = 1; s < arguments.length; s++) {
        var src = arguments[s];
        for (var k in src) target[k] = src[k];
      }
      return target;
    }

    // 참석자별 요약
    var summary = names.map(function (name, i) {
      return {
        name: name,
        games: games[i],
        rests: rests[i],
        singles: singlesPlayed[i],
        group: groupsIn ? groupsIn[i] || null : null,
      };
    });

    var gameCounts = summary.map(function (s) {
      return s.games;
    });

    // 고정 매칭 달성 현황 (요청 횟수 대비 실제 파트너로 묶인 횟수)
    var forcedPairResults = forcedPairs.map(function (fp) {
      return {
        a: names[fp.a],
        b: names[fp.b],
        required: fp.count,
        achieved: partnerCount(fp.a, fp.b),
      };
    });

    // 대진 고정 배정 현황 (몇 라운드에 배정됐는지, 못 넣었으면 null)
    var fixedMatchReport = fixedMatchResults.map(function (fm) {
      return {
        team1: fm.team1.map(nameOf),
        team2: fm.team2.map(nameOf),
        round: fm.round,
      };
    });

    return {
      rounds: resultRounds,
      summary: summary,
      meta: {
        players: N,
        courts: courts,
        usableCourts: fullPlan.usableCourts,
        doublesCourts: fullPlan.doublesCourts,
        singlesCourts: fullPlan.singlesCourts,
        rounds: rounds,
        restPerRound: fullPlan.rest,
        groupRounds: groupRounds,
        mixedRounds: rounds - groupRounds,
        hasGroups: !!groupsIn,
        forcedPairs: forcedPairResults,
        fixedMatches: fixedMatchReport,
        minGames: Math.min.apply(null, gameCounts),
        maxGames: Math.max.apply(null, gameCounts),
      },
    };
  }

  // 모임 시간/경기 시간으로부터 라운드 수 계산
  function roundsFromDuration(totalMinutes, gameMinutes) {
    gameMinutes = gameMinutes || 30;
    return Math.max(1, Math.floor(totalMinutes / gameMinutes));
  }

  return {
    generate: generate,
    roundsFromDuration: roundsFromDuration,
    COURT_SIZE: COURT_SIZE,
    SINGLES_SIZE: SINGLES_SIZE,
  };
});
