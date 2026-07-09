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

  /**
   * 대진표 생성
   * @param {Object} opts
   * @param {string[]} opts.players  참석자 이름 목록
   * @param {number}   opts.courts   코트 수
   * @param {number}   opts.rounds   라운드(경기 회차) 수
   * @param {number}   [opts.seed]   난수 시드 (같은 값이면 결과 동일)
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

    var N = names.length;
    if (N < COURT_SIZE) {
      throw new Error("복식 경기를 하려면 최소 " + COURT_SIZE + "명이 필요합니다.");
    }

    var rng = makeRng(seed);

    // 한 라운드에 실제 사용할 코트 수 (인원이 부족하면 줄인다)
    var usableCourts = Math.min(courts, Math.floor(N / COURT_SIZE));
    var slots = usableCourts * COURT_SIZE; // 매 라운드 뛰는 인원
    var restPerRound = N - slots;

    // 상태 추적 (인덱스 기반)
    var games = new Array(N).fill(0); // 경기 수
    var rests = new Array(N).fill(0); // 휴식 수
    var partner = {}; // key -> 함께 팀한 횟수
    var opponent = {}; // key -> 상대로 만난 횟수

    function partnerCount(i, j) {
      return partner[key(i, j)] || 0;
    }
    function opponentCount(i, j) {
      return opponent[key(i, j)] || 0;
    }

    var resultRounds = [];

    for (var r = 0; r < rounds; r++) {
      // 1) 이번 라운드 휴식 인원 선정
      //    경기를 많이 뛴 사람 > 적게 쉰 사람 순으로 쉬게 해서 균형을 맞춘다.
      var order = [];
      for (var p = 0; p < N; p++) order.push(p);
      order = shuffle(order, rng); // 동점 tie-break용 무작위 섞기
      order.sort(function (a, b) {
        if (games[b] !== games[a]) return games[b] - games[a]; // 많이 뛴 사람 먼저 휴식
        return rests[a] - rests[b]; // 적게 쉰 사람 먼저 휴식
      });

      var resting = order.slice(0, restPerRound).sort(function (a, b) {
        return a - b;
      });
      var restSet = {};
      resting.forEach(function (x) {
        restSet[x] = true;
      });

      var playing = [];
      for (var q = 0; q < N; q++) {
        if (!restSet[q]) playing.push(q);
      }

      // 2) 뛰는 인원을 코트에 배정 (파트너/상대 반복 최소화)
      var best = assignCourts(playing, usableCourts);

      // 3) 상태 갱신
      best.forEach(function (court) {
        var t1 = court.team1;
        var t2 = court.team2;
        // 파트너
        partner[key(t1[0], t1[1])] = partnerCount(t1[0], t1[1]) + 1;
        partner[key(t2[0], t2[1])] = partnerCount(t2[0], t2[1]) + 1;
        // 상대 (팀1 x 팀2 전부)
        t1.forEach(function (a) {
          t2.forEach(function (b) {
            opponent[key(a, b)] = opponentCount(a, b) + 1;
          });
        });
        // 경기 수
        t1.concat(t2).forEach(function (x) {
          games[x] += 1;
        });
      });
      resting.forEach(function (x) {
        rests[x] += 1;
      });

      resultRounds.push({
        round: r + 1,
        courts: best.map(function (court, ci) {
          return {
            court: ci + 1,
            team1: court.team1.map(nameOf),
            team2: court.team2.map(nameOf),
          };
        }),
        resting: resting.map(nameOf),
      });
    }

    // 코트 배정: 랜덤 재시작 그리디로 비용이 가장 낮은 배정을 찾는다.
    function assignCourts(playing, nCourts) {
      var attempts = 240;
      var bestCourts = null;
      var bestCost = Infinity;
      for (var t = 0; t < attempts; t++) {
        var shuffled = shuffle(playing, rng);
        var courtsArr = [];
        var cost = 0;
        for (var c = 0; c < nCourts; c++) {
          var four = shuffled.slice(c * COURT_SIZE, c * COURT_SIZE + COURT_SIZE);
          var split = bestSplit(four);
          cost += split.cost;
          courtsArr.push({ team1: split.team1, team2: split.team2 });
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
      cost += wPartner * partnerCount(t1[0], t1[1]);
      cost += wPartner * partnerCount(t2[0], t2[1]);
      for (var i = 0; i < 2; i++) {
        for (var j = 0; j < 2; j++) {
          cost += wOpp * opponentCount(t1[i], t2[j]);
        }
      }
      return cost;
    }

    function nameOf(idx) {
      return names[idx];
    }

    // 참석자별 요약
    var summary = names.map(function (name, i) {
      return { name: name, games: games[i], rests: rests[i] };
    });

    var gameCounts = summary.map(function (s) {
      return s.games;
    });

    return {
      rounds: resultRounds,
      summary: summary,
      meta: {
        players: N,
        courts: courts,
        usableCourts: usableCourts,
        rounds: rounds,
        restPerRound: restPerRound,
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
  };
});
