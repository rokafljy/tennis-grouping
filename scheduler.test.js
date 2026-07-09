/*
 * scheduler.js 간단 검증 스크립트 (node scheduler.test.js)
 * 외부 의존성 없이 콘솔로 결과를 확인한다.
 */
var Scheduler = require("./scheduler.js");

var passed = 0;
var failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ 실패: " + msg);
  }
}

function analyze(label, opts) {
  var res = Scheduler.generate(opts);
  var s = res.summary;
  var spread = res.meta.maxGames - res.meta.minGames;

  // 파트너/상대 반복 통계
  var repeatPartners = 0;
  var repeatOpponents = 0;
  var seenP = {};
  var seenO = {};
  res.rounds.forEach(function (rd) {
    rd.courts.forEach(function (ct) {
      var pairs = [ct.team1, ct.team2];
      pairs.forEach(function (t) {
        var k = [t[0], t[1]].sort().join("|");
        if (seenP[k]) repeatPartners++;
        seenP[k] = (seenP[k] || 0) + 1;
      });
      ct.team1.forEach(function (a) {
        ct.team2.forEach(function (b) {
          var k = [a, b].sort().join("|");
          if (seenO[k]) repeatOpponents++;
          seenO[k] = (seenO[k] || 0) + 1;
        });
      });
    });
  });

  console.log(
    "\n[" + label + "] " +
      opts.players.length + "명 / " + opts.courts + "코트 / " + opts.rounds + "라운드"
  );
  console.log(
    "  경기 수 범위: " + res.meta.minGames + "~" + res.meta.maxGames +
      " (편차 " + spread + "), 라운드당 휴식 " + res.meta.restPerRound + "명"
  );
  console.log("  파트너 반복: " + repeatPartners + "회, 상대 반복: " + repeatOpponents + "회");
  console.log(
    "  참석자별 경기 수: " +
      s.map(function (x) { return x.name + ":" + x.games; }).join(", ")
  );

  // 경기 수 편차는 1 이하여야 공정하다.
  assert(spread <= 1, label + " 경기 수 편차가 1 이하여야 함 (실제 " + spread + ")");

  // 결정성: 같은 시드 → 같은 결과
  var res2 = Scheduler.generate(opts);
  assert(
    JSON.stringify(res) === JSON.stringify(res2),
    label + " 동일 입력은 동일 결과여야 함(결정성)"
  );

  return res;
}

console.log("=== 테니스 대진표 스케줄러 검증 ===");

// 대표 시나리오: 20명, 3코트, 4라운드 (2시간)
analyze("표준(20명/3코트)", {
  players: Array.from({ length: 20 }, function (_, i) { return "P" + (i + 1); }),
  courts: 3,
  rounds: 4,
});

// 20명, 2코트, 4라운드
analyze("2코트(20명/2코트)", {
  players: Array.from({ length: 20 }, function (_, i) { return "P" + (i + 1); }),
  courts: 2,
  rounds: 4,
});

// 딱 떨어지는 경우: 8명, 2코트 (휴식 0)
analyze("휴식없음(8명/2코트)", {
  players: Array.from({ length: 8 }, function (_, i) { return "P" + (i + 1); }),
  courts: 2,
  rounds: 5,
});

// 홀수/불균형: 13명, 3코트
analyze("불균형(13명/3코트)", {
  players: Array.from({ length: 13 }, function (_, i) { return "P" + (i + 1); }),
  courts: 3,
  rounds: 6,
});

// 1시간(2라운드) 소규모: 6명, 1코트
analyze("소규모(6명/1코트)", {
  players: Array.from({ length: 6 }, function (_, i) { return "P" + (i + 1); }),
  courts: 1,
  rounds: 2,
});

// 최소 인원 미달 시 에러
try {
  Scheduler.generate({ players: ["A", "B", "C"], courts: 1, rounds: 2 });
  assert(false, "3명일 때 에러가 발생해야 함");
} catch (e) {
  assert(true, "");
}

// roundsFromDuration
assert(Scheduler.roundsFromDuration(120, 30) === 4, "2시간/30분 = 4라운드");
assert(Scheduler.roundsFromDuration(60, 30) === 2, "1시간/30분 = 2라운드");

console.log("\n=== 결과: " + passed + " 통과, " + failed + " 실패 ===");
process.exit(failed > 0 ? 1 : 0);
