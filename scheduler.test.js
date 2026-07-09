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
        if (t.length < 2) return; // 단식 팀(1명)은 파트너 없음
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

// 단식 자동 배정: 4코트, 14명 → 복식 3 + 단식 1, 휴식 0
(function () {
  var res = analyze("복식+단식(14명/4코트)", {
    players: Array.from({ length: 14 }, function (_, i) { return "P" + (i + 1); }),
    courts: 4,
    rounds: 5,
  });
  assert(res.meta.doublesCourts === 3, "14명/4코트 → 복식 3코트 (실제 " + res.meta.doublesCourts + ")");
  assert(res.meta.singlesCourts === 1, "14명/4코트 → 단식 1코트 (실제 " + res.meta.singlesCourts + ")");
  assert(res.meta.restPerRound === 0, "14명/4코트 → 휴식 0명 (실제 " + res.meta.restPerRound + ")");
  var ok = res.rounds.every(function (rd) {
    var singles = rd.courts.filter(function (c) { return c.type === "singles"; });
    return singles.length === 1 && singles[0].team1.length === 1 && singles[0].team2.length === 1;
  });
  assert(ok, "매 라운드 단식 코트 1개(1:1) 존재");
  var sc = res.summary.map(function (s) { return s.singles; });
  var singlesSpread = Math.max.apply(null, sc) - Math.min.apply(null, sc);
  assert(singlesSpread <= 2, "단식 배정 편차 <= 2 (실제 " + singlesSpread + ")");
})();

// 코트 남아도 인원 딱 맞으면 단식 없음: 16명, 4코트
(function () {
  var res = Scheduler.generate({
    players: Array.from({ length: 16 }, function (_, i) { return "P" + (i + 1); }),
    courts: 4, rounds: 3,
  });
  assert(res.meta.singlesCourts === 0, "16명/4코트 → 단식 없음");
  assert(res.meta.doublesCourts === 4, "16명/4코트 → 복식 4코트");
})();

// 코트 부족하면 단식 없이 휴식: 14명, 3코트
(function () {
  var res = Scheduler.generate({
    players: Array.from({ length: 14 }, function (_, i) { return "P" + (i + 1); }),
    courts: 3, rounds: 3,
  });
  assert(res.meta.singlesCourts === 0, "14명/3코트 → 코트 여유 없어 단식 없음");
  assert(res.meta.restPerRound === 2, "14명/3코트 → 휴식 2명");
})();

// ---- 레벨(A/B 그룹) 기능 ----

// 20명(A10/B10), 3코트, 4라운드 중 앞 2라운드는 그룹별, 뒤 2라운드는 혼합
(function () {
  var players = Array.from({ length: 20 }, function (_, i) { return "P" + (i + 1); });
  var groups = players.map(function (_, i) { return i < 10 ? "A" : "B"; });
  var res = Scheduler.generate({ players: players, courts: 3, rounds: 4, groups: groups, groupRounds: 2 });

  assert(res.meta.groupRounds === 2, "groupRounds 메타 == 2");
  assert(res.meta.mixedRounds === 2, "mixedRounds 메타 == 2");
  assert(res.meta.hasGroups === true, "hasGroups 메타 == true");

  var nameToGroup = {};
  players.forEach(function (p, i) { nameToGroup[p] = groups[i]; });

  // 앞 2라운드: 모든 코트가 같은 그룹끼리만 (팀1+팀2 전원 동일 그룹)
  var groupRoundsOk = res.rounds.slice(0, 2).every(function (rd) {
    return rd.courts.every(function (ct) {
      var all = ct.team1.concat(ct.team2);
      var g = nameToGroup[all[0]];
      return all.every(function (n) { return nameToGroup[n] === g; }) && ct.group === g;
    });
  });
  assert(groupRoundsOk, "그룹별 라운드(1~2)는 모든 코트가 동일 그룹으로만 구성됨");

  // 뒤 2라운드: 그룹 태그 없음(null) — 혼합 라운드
  var mixedRoundsOk = res.rounds.slice(2).every(function (rd) {
    return rd.courts.every(function (ct) { return ct.group === null; });
  });
  assert(mixedRoundsOk, "혼합 라운드(3~4)는 court.group이 null");

  // 전체 경기 수 편차는 여전히 작아야 함 (그룹 간 인원 동일하므로 균등)
  var spread = res.meta.maxGames - res.meta.minGames;
  assert(spread <= 1, "그룹 기능 사용 시에도 경기 수 편차 <= 1 (실제 " + spread + ")");
})();

// 그룹 인원 비율에 맞춰 코트가 나뉘는지: A 4명, B 16명, 4코트, 1라운드(그룹별)
(function () {
  var players = Array.from({ length: 20 }, function (_, i) { return "P" + (i + 1); });
  var groups = players.map(function (_, i) { return i < 4 ? "A" : "B"; });
  var res = Scheduler.generate({ players: players, courts: 4, rounds: 1, groups: groups, groupRounds: 1 });
  var rd = res.rounds[0];
  var aCourts = rd.courts.filter(function (c) { return c.group === "A"; });
  var bCourts = rd.courts.filter(function (c) { return c.group === "B"; });
  assert(aCourts.length === 1, "A(4명)는 1코트 배정 (실제 " + aCourts.length + ")");
  assert(bCourts.length === 3, "B(16명)는 3코트 배정 (실제 " + bCourts.length + ")");
  var aPlayed = aCourts.reduce(function (sum, c) { return sum + c.team1.length + c.team2.length; }, 0);
  assert(aPlayed === 4, "A그룹 4명 전원 코트 배정 (실제 " + aPlayed + "명)");
})();

// 코트가 1개뿐이면 그룹별 라운드에서 매 라운드 번갈아 배정
(function () {
  var players = Array.from({ length: 8 }, function (_, i) { return "P" + (i + 1); });
  var groups = players.map(function (_, i) { return i < 4 ? "A" : "B"; });
  var res = Scheduler.generate({ players: players, courts: 1, rounds: 4, groups: groups, groupRounds: 4 });
  var seq = res.rounds.map(function (rd) { return rd.courts[0] && rd.courts[0].group; });
  assert(seq[0] === "A" && seq[1] === "B" && seq[2] === "A" && seq[3] === "B",
    "1코트일 때 그룹별 라운드가 A/B 번갈아 배정됨 (실제 " + seq.join(",") + ")");
})();

// 그룹 없이 호출하면 기존과 동일하게 동작 (하위호환)
(function () {
  var res = Scheduler.generate({
    players: Array.from({ length: 12 }, function (_, i) { return "P" + (i + 1); }),
    courts: 3, rounds: 3,
  });
  assert(res.meta.hasGroups === false, "그룹 미지정 시 hasGroups == false");
  assert(res.meta.groupRounds === 0, "그룹 미지정 시 groupRounds == 0");
  var allNullGroup = res.rounds.every(function (rd) {
    return rd.courts.every(function (c) { return c.group === null; });
  });
  assert(allNullGroup, "그룹 미지정 시 모든 court.group이 null");
})();

// ---- 고정 매칭(특정 인원 파트너 강제) 기능 ----

// 20명/3코트/6라운드, P1-P2를 3번은 반드시 파트너로 묶이게 요청
(function () {
  var players = Array.from({ length: 20 }, function (_, i) { return "P" + (i + 1); });
  var res = Scheduler.generate({
    players: players, courts: 3, rounds: 6,
    forcedPairs: [{ a: 0, b: 1, count: 3 }],
  });
  var fp = res.meta.forcedPairs[0];
  assert(fp.a === "P1" && fp.b === "P2", "forcedPairs 메타에 이름이 담김");
  assert(fp.required === 3, "요청 횟수 3이 메타에 반영됨");
  assert(fp.achieved >= 3, "P1-P2가 최소 3번 파트너로 묶임 (실제 " + fp.achieved + ")");

  // 실제 라운드 데이터에서도 직접 세어 교차 검증
  var actualPairings = 0;
  res.rounds.forEach(function (rd) {
    rd.courts.forEach(function (ct) {
      [ct.team1, ct.team2].forEach(function (t) {
        if (t.indexOf("P1") !== -1 && t.indexOf("P2") !== -1) actualPairings++;
      });
    });
  });
  assert(actualPairings >= 3, "라운드 데이터 상에서도 P1-P2가 3번 이상 같은 팀 (실제 " + actualPairings + ")");

  // 전체 공정성(경기 수 편차)이 크게 깨지지 않는지 확인
  var spread = res.meta.maxGames - res.meta.minGames;
  assert(spread <= 2, "고정 매칭 사용 시에도 경기 수 편차가 과도하지 않음 (실제 " + spread + ")");
})();

// 여러 개의 고정 매칭을 동시에 요청해도 각각 달성되는지
(function () {
  var players = Array.from({ length: 16 }, function (_, i) { return "P" + (i + 1); });
  var res = Scheduler.generate({
    players: players, courts: 4, rounds: 5,
    forcedPairs: [
      { a: 0, b: 1, count: 2 },
      { a: 2, b: 3, count: 2 },
    ],
  });
  res.meta.forcedPairs.forEach(function (fp) {
    assert(fp.achieved >= fp.required,
      fp.a + "-" + fp.b + " 요청 " + fp.required + "회 달성 (실제 " + fp.achieved + ")");
  });
})();

// forcedPairs 미지정 시 하위호환 (meta.forcedPairs는 빈 배열)
(function () {
  var res = Scheduler.generate({
    players: Array.from({ length: 8 }, function (_, i) { return "P" + (i + 1); }),
    courts: 2, rounds: 3,
  });
  assert(Array.isArray(res.meta.forcedPairs) && res.meta.forcedPairs.length === 0,
    "forcedPairs 미지정 시 meta.forcedPairs가 빈 배열");
})();

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
