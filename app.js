/* 테니스 대진표 UI 로직 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    players: $("players"),
    nameCount: $("name-count"),
    useGroups: $("useGroups"),
    singlePlayersWrap: $("single-players-wrap"),
    groupPlayersWrap: $("group-players-wrap"),
    playersA: $("playersA"),
    playersB: $("playersB"),
    nameCountA: $("name-count-a"),
    nameCountB: $("name-count-b"),
    courts: $("courts"),
    gameMinutes: $("gameMinutes"),
    rounds: $("rounds"),
    customRounds: $("custom-rounds"),
    startTime: $("startTime"),
    endTime: $("endTime"),
    manualRounds: $("manualRounds"),
    groupRoundsField: $("group-rounds-field"),
    groupRounds: $("groupRounds"),
    useForcedPairs: $("useForcedPairs"),
    forcedPairsField: $("forced-pairs-field"),
    forcedPairsRows: $("forced-pairs-rows"),
    addForcedPairBtn: $("add-forced-pair"),
    forcedPairsHint: $("forced-pairs-hint"),
    forcedPairsResult: $("forced-pairs-result"),
    useFixedMatches: $("useFixedMatches"),
    fixedMatchesField: $("fixed-matches-field"),
    fixedMatchesRows: $("fixed-matches-rows"),
    addFixedMatchBtn: $("add-fixed-match"),
    fixedMatchesHint: $("fixed-matches-hint"),
    fixedMatchesResult: $("fixed-matches-result"),
    planHint: $("plan-hint"),
    generate: $("generate"),
    reshuffle: $("reshuffle"),
    error: $("error"),
    result: $("result"),
    resultMeta: $("result-meta"),
    roundsBox: $("rounds-list"),
    playerSummary: $("player-summary"),
    copy: $("copy"),
    print: $("print"),
    toast: $("toast"),
  };

  // 휴식 표시용 인라인 SVG (이모지 대신 아이콘 사용)
  var MOON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg> ';

  var STORAGE_KEY = "tennis-grouping-v2";
  var state = {
    customMode: false, // 라운드 직접 지정 여부
    seed: 12345,
    last: null, // 마지막 입력(다시 섞기용)
  };

  // ---- 참석자 파싱 ----
  function parsePlayersRaw(text) {
    return (text || "")
      .split(/[\n,]/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  // 현재 입력 모드(단일 목록 / A·B 그룹)에 따라 이름 목록과 그룹 태그를 함께 반환한다.
  // groups는 useGroups가 꺼져 있으면 null.
  function getRoster() {
    if (el.useGroups.checked) {
      var a = parsePlayersRaw(el.playersA.value);
      var b = parsePlayersRaw(el.playersB.value);
      return {
        names: a.concat(b),
        groups: a.map(function () { return "A"; }).concat(b.map(function () { return "B"; })),
        countA: a.length,
        countB: b.length,
      };
    }
    return { names: parsePlayersRaw(el.players.value), groups: null };
  }

  // ---- 동적 행 입력 (고정 매칭 / 대진 고정) ----
  // fields: [{name, placeholder, inputType}] 또는 {type:'label', text} 혼합 배열
  function addDynRow(container, fields, onChange) {
    var row = document.createElement("div");
    row.className = "dyn-row";
    fields.forEach(function (f) {
      if (f.type === "label") {
        var span = document.createElement("span");
        span.className = "vs-label";
        span.textContent = f.text;
        row.appendChild(span);
        return;
      }
      var inp = document.createElement("input");
      inp.type = f.inputType || "text";
      inp.className = "row-input " + f.name;
      inp.placeholder = f.placeholder || "";
      inp.autocomplete = "off";
      if (f.inputType === "number") inp.min = "1";
      inp.addEventListener("input", onChange);
      row.appendChild(inp);
    });
    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "row-remove";
    rm.setAttribute("aria-label", "삭제");
    rm.textContent = "×";
    rm.addEventListener("click", function () {
      row.remove();
      onChange();
    });
    row.appendChild(rm);
    container.appendChild(row);
    return row;
  }

  function addForcedPairRow(prefill) {
    var row = addDynRow(
      el.forcedPairsRows,
      [
        { name: "name1", placeholder: "이름1" },
        { name: "name2", placeholder: "이름2" },
        { name: "count", placeholder: "횟수", inputType: "number" },
      ],
      updateHints
    );
    row.querySelector(".name1").value = (prefill && prefill.name1) || "";
    row.querySelector(".name2").value = (prefill && prefill.name2) || "";
    row.querySelector(".count").value = (prefill && prefill.count) || 1;
    return row;
  }

  function addFixedMatchRow(prefill) {
    var row = addDynRow(
      el.fixedMatchesRows,
      [
        { name: "name1", placeholder: "이름1" },
        { name: "name2", placeholder: "이름2" },
        { type: "label", text: "VS" },
        { name: "name3", placeholder: "이름3" },
        { name: "name4", placeholder: "이름4" },
      ],
      updateHints
    );
    row.querySelector(".name1").value = (prefill && prefill.name1) || "";
    row.querySelector(".name2").value = (prefill && prefill.name2) || "";
    row.querySelector(".name3").value = (prefill && prefill.name3) || "";
    row.querySelector(".name4").value = (prefill && prefill.name4) || "";
    return row;
  }

  function readForcedPairRows() {
    return Array.from(el.forcedPairsRows.querySelectorAll(".dyn-row"))
      .map(function (row) {
        return {
          name1: row.querySelector(".name1").value.trim(),
          name2: row.querySelector(".name2").value.trim(),
          count: parseInt(row.querySelector(".count").value, 10) || 1,
        };
      })
      .filter(function (r) { return r.name1 && r.name2; });
  }

  function readFixedMatchRows() {
    return Array.from(el.fixedMatchesRows.querySelectorAll(".dyn-row"))
      .map(function (row) {
        return {
          name1: row.querySelector(".name1").value.trim(),
          name2: row.querySelector(".name2").value.trim(),
          name3: row.querySelector(".name3").value.trim(),
          name4: row.querySelector(".name4").value.trim(),
        };
      })
      .filter(function (r) { return r.name1 && r.name2 && r.name3 && r.name4; });
  }

  // 입력 행들을 참석자 목록(names) 기준 인덱스로 변환. 이름을 찾지 못하거나
  // 같은 사람이 중복된 행은 errors에 담고 건너뛴다.
  function resolveForcedPairs(rows, names) {
    var pairs = [];
    var errors = [];
    rows.forEach(function (r) {
      var idxA = names.indexOf(r.name1);
      var idxB = names.indexOf(r.name2);
      if (idxA === -1) { errors.push(r.name1 + "님을 참석자 명단에서 찾을 수 없어요"); return; }
      if (idxB === -1) { errors.push(r.name2 + "님을 참석자 명단에서 찾을 수 없어요"); return; }
      if (idxA === idxB) { errors.push(r.name1 + "는 같은 사람과 매칭할 수 없어요"); return; }
      pairs.push({ a: idxA, b: idxB, count: Math.max(1, r.count || 1) });
    });
    return { pairs: pairs, errors: errors };
  }

  function resolveFixedMatches(rows, names) {
    var matches = [];
    var errors = [];
    rows.forEach(function (r) {
      var labels = [r.name1, r.name2, r.name3, r.name4];
      var idxs = labels.map(function (n) { return names.indexOf(n); });
      var bad = false;
      idxs.forEach(function (idx, i) {
        if (idx === -1) { errors.push(labels[i] + "님을 참석자 명단에서 찾을 수 없어요"); bad = true; }
      });
      if (bad) return;
      var uniq = {};
      var dup = idxs.some(function (idx) {
        if (uniq[idx]) return true;
        uniq[idx] = true;
        return false;
      });
      if (dup) { errors.push(labels.join(", ") + " 안에 같은 사람이 중복돼요"); return; }
      matches.push({ team1: [idxs[0], idxs[1]], team2: [idxs[2], idxs[3]] });
    });
    return { matches: matches, errors: errors };
  }

  // "HH:MM" → 분(0~1439). 파싱 실패 시 null
  function timeToMinutes(str) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(str || "");
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  // 분 → "HH:MM" (24시간 넘어가면 그대로 표기, 예: 25:30)
  function minutesToTime(total) {
    var h = Math.floor(total / 60);
    var m = total % 60;
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m);
  }

  // 모임 지속 시간(분). 종료가 시작보다 빠르면 다음날로 간주.
  function durationMinutes() {
    var s = timeToMinutes(el.startTime.value);
    var e = timeToMinutes(el.endTime.value);
    if (s == null || e == null) return null;
    var d = e - s;
    if (d <= 0) d += 24 * 60; // 자정 넘김
    return d;
  }

  function computeRounds() {
    if (state.customMode) {
      return Math.max(1, parseInt(el.rounds.value, 10) || 1);
    }
    var gm = parseInt(el.gameMinutes.value, 10) || 30;
    var dur = durationMinutes();
    if (dur == null) return 1;
    return Scheduler.roundsFromDuration(dur, gm);
  }

  // ---- 안내 문구 갱신 ----
  function updateHints() {
    var roster = getRoster();
    var players = roster.names;

    if (el.useGroups.checked) {
      el.nameCountA.textContent = "(" + roster.countA + "명)";
      el.nameCountB.textContent = "(" + roster.countB + "명)";
    } else {
      el.nameCount.textContent = "(" + players.length + "명)";
    }

    var courts = parseInt(el.courts.value, 10) || 1;
    var gm = parseInt(el.gameMinutes.value, 10) || 30;
    var dur = durationMinutes();
    var rounds = computeRounds();

    // 그룹별 라운드 수는 총 라운드 수를 넘을 수 없다
    if (el.useGroups.checked) {
      el.groupRounds.setAttribute("max", rounds);
      if ((parseInt(el.groupRounds.value, 10) || 0) > rounds) {
        el.groupRounds.value = rounds;
      }
    }

    if (dur == null) {
      el.planHint.textContent = "시작/종료 시간을 확인해 주세요.";
      persist();
      return;
    }
    if (players.length < 4) {
      el.planHint.textContent = "복식 경기는 최소 4명부터 가능해요.";
      persist();
      return;
    }

    var plan = planLayout(players.length, courts);
    var msg =
      "모임 " + fmtDuration(dur) + " · 총 " + rounds + "라운드";

    if (el.useGroups.checked) {
      var gr = Math.min(rounds, parseInt(el.groupRounds.value, 10) || 0);
      msg += gr > 0 ? "(그룹별 " + gr + " · 혼합 " + (rounds - gr) + ")" : "(전부 혼합)";
      if (roster.countA > 0 && roster.countA < 4 && gr > 0) {
        msg += " · A그룹 인원이 적어 그룹전에서 자주 쉴 수 있어요";
      }
      if (roster.countB > 0 && roster.countB < 4 && gr > 0) {
        msg += " · B그룹 인원이 적어 그룹전에서 자주 쉴 수 있어요";
      }
    }

    msg += " · " + courtLayoutText(plan) + " · 라운드당 " + plan.seated + "명 경기";
    if (plan.rest > 0) msg += " · " + plan.rest + "명 휴식";
    // 라운드 총 소요시간이 모임 시간을 넘는지 안내
    if (rounds * gm > dur) {
      msg += " · 경기 시간이 모임 시간을 초과해요";
    }
    el.planHint.textContent = msg;

    if (el.useForcedPairs.checked) {
      var resolved = resolveForcedPairs(readForcedPairRows(), players);
      if (resolved.errors.length) {
        el.forcedPairsHint.textContent = resolved.errors[0] +
          (resolved.errors.length > 1 ? " 외 " + (resolved.errors.length - 1) + "건" : "");
      } else if (resolved.pairs.length) {
        el.forcedPairsHint.textContent =
          resolved.pairs.length + "쌍 지정됨 · 요청한 횟수만큼 반드시 같은 팀으로 배정돼요.";
      } else {
        el.forcedPairsHint.textContent = "지정한 쌍은 요청한 횟수만큼 반드시 같은 팀(파트너)으로 배정돼요.";
      }
    }

    if (el.useFixedMatches.checked) {
      var resolvedFm = resolveFixedMatches(readFixedMatchRows(), players);
      if (resolvedFm.errors.length) {
        el.fixedMatchesHint.textContent = resolvedFm.errors[0] +
          (resolvedFm.errors.length > 1 ? " 외 " + (resolvedFm.errors.length - 1) + "건" : "");
      } else if (resolvedFm.matches.length) {
        el.fixedMatchesHint.textContent =
          resolvedFm.matches.length + "개 대진 지정됨 · 앞쪽 라운드부터 그대로 배정돼요.";
      } else {
        el.fixedMatchesHint.textContent = "지정한 대진은 그대로 배정되고, 나머지 인원은 자동으로 매칭돼요.";
      }
    }

    persist();
  }

  function fmtDuration(min) {
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (h && m) return h + "시간 " + m + "분";
    if (h) return h + "시간";
    return m + "분";
  }

  // 복식/단식 코트 구성 텍스트 (예: "복식 3코트+단식 1코트")
  function courtLayoutText(layout) {
    var parts = [];
    if (layout.doublesCourts) parts.push("복식 " + layout.doublesCourts + "코트");
    if (layout.singlesCourts) parts.push("단식 " + layout.singlesCourts + "코트");
    return parts.length ? parts.join("+") : layout.usableCourts + "코트";
  }

  // 참석자 수·코트 수로부터 복식/단식 구성을 미리 계산 (스케줄러와 동일 규칙)
  function planLayout(players, courts) {
    var d = Math.min(courts, Math.floor(players / 4));
    var rem = players - 4 * d;
    var remC = courts - d;
    var s = rem >= 2 && remC >= 1 ? 1 : 0;
    var seated = 4 * d + 2 * s;
    return {
      doublesCourts: d,
      singlesCourts: s,
      usableCourts: d + s,
      seated: seated,
      rest: players - seated,
    };
  }

  // ---- localStorage ----
  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          players: el.players.value,
          playersA: el.playersA.value,
          playersB: el.playersB.value,
          useGroups: el.useGroups.checked,
          groupRounds: el.groupRounds.value,
          useForcedPairs: el.useForcedPairs.checked,
          forcedPairRows: readForcedPairRows(),
          useFixedMatches: el.useFixedMatches.checked,
          fixedMatchRows: readFixedMatchRows(),
          courts: el.courts.value,
          gameMinutes: el.gameMinutes.value,
          rounds: el.rounds.value,
          startTime: el.startTime.value,
          endTime: el.endTime.value,
          customMode: state.customMode,
        })
      );
    } catch (e) { /* ignore */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.players != null) el.players.value = d.players;
      if (d.playersA != null) el.playersA.value = d.playersA;
      if (d.playersB != null) el.playersB.value = d.playersB;
      if (d.useGroups != null) el.useGroups.checked = d.useGroups;
      if (d.groupRounds != null) el.groupRounds.value = d.groupRounds;
      if (d.useForcedPairs != null) el.useForcedPairs.checked = d.useForcedPairs;
      if (Array.isArray(d.forcedPairRows)) {
        d.forcedPairRows.forEach(function (r) { addForcedPairRow(r); });
      }
      if (d.useFixedMatches != null) el.useFixedMatches.checked = d.useFixedMatches;
      if (Array.isArray(d.fixedMatchRows)) {
        d.fixedMatchRows.forEach(function (r) { addFixedMatchRow(r); });
      }
      if (d.courts != null) el.courts.value = d.courts;
      if (d.gameMinutes != null) el.gameMinutes.value = d.gameMinutes;
      if (d.rounds != null) el.rounds.value = d.rounds;
      if (d.startTime != null) el.startTime.value = d.startTime;
      if (d.endTime != null) el.endTime.value = d.endTime;
      if (d.customMode != null) state.customMode = d.customMode;
    } catch (e) { /* ignore */ }
  }

  function syncManualUI() {
    el.manualRounds.checked = state.customMode;
    el.customRounds.hidden = !state.customMode;
  }

  function syncGroupsUI() {
    var on = el.useGroups.checked;
    el.singlePlayersWrap.hidden = on;
    el.groupPlayersWrap.hidden = !on;
    el.groupRoundsField.hidden = !on;
  }

  function syncForcedPairsUI() {
    var on = el.useForcedPairs.checked;
    el.forcedPairsField.hidden = !on;
    if (on && el.forcedPairsRows.children.length === 0) addForcedPairRow();
  }

  function syncFixedMatchesUI() {
    var on = el.useFixedMatches.checked;
    el.fixedMatchesField.hidden = !on;
    if (on && el.fixedMatchesRows.children.length === 0) addFixedMatchRow();
  }

  // ---- 대진표 생성 ----
  // reshuffle: 새 시드로 다시 섞기 / silent: 스크롤 이동 없이 조용히 갱신
  function generate(reshuffle, silent) {
    el.error.hidden = true;
    var roster = getRoster();
    var players = roster.names;
    var groups = roster.groups;

    // 중복 이름 확인 → 번호로 구분 표시 (groups는 인덱스가 같이 유지되므로 그대로 둠)
    var seen = {};
    var dup = false;
    players = players.map(function (name) {
      if (seen[name]) {
        dup = true;
        seen[name] += 1;
        return name + "(" + seen[name] + ")";
      }
      seen[name] = 1;
      return name;
    });

    if (players.length < 4) {
      showError("복식 경기를 하려면 최소 4명이 필요해요. (현재 " + players.length + "명)");
      return;
    }

    var courts = parseInt(el.courts.value, 10) || 1;
    var rounds = computeRounds();
    var gameMinutes = parseInt(el.gameMinutes.value, 10) || 30;
    var startMin = timeToMinutes(el.startTime.value);

    if (reshuffle) {
      state.seed = (state.seed * 1103515245 + 12345) & 0x7fffffff;
    }

    var opts = {
      players: players,
      courts: courts,
      rounds: rounds,
      seed: state.seed,
    };
    if (groups) {
      opts.groups = groups;
      opts.groupRounds = Math.min(rounds, parseInt(el.groupRounds.value, 10) || 0);
    }
    if (el.useForcedPairs.checked) {
      // 고정 매칭 이름은 중복 접미사(예: "(2)") 붙기 전 원본 명단 기준으로 지정하므로,
      // dedup 전 이름 목록(roster.names)을 기준으로 인덱스를 찾는다.
      opts.forcedPairs = resolveForcedPairs(readForcedPairRows(), roster.names).pairs;
    }
    if (el.useFixedMatches.checked) {
      opts.fixedMatches = resolveFixedMatches(readFixedMatchRows(), roster.names).matches;
    }

    var res;
    try {
      res = Scheduler.generate(opts);
    } catch (e) {
      showError(e.message || "대진표 생성 중 오류가 발생했어요.");
      return;
    }

    state.last = { gameMinutes: gameMinutes, startMin: startMin, res: res, hadDup: dup };
    render(res, gameMinutes, startMin);
    el.reshuffle.hidden = false;
    el.result.hidden = false;
    if (!reshuffle && !silent) {
      el.result.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function showError(msg) {
    el.error.textContent = msg;
    el.error.hidden = false;
  }

  // ---- 렌더링 ----
  function render(res, gameMinutes, startMin) {
    var m = res.meta;
    var balance =
      m.minGames === m.maxGames
        ? "모두 " + m.minGames + "경기씩"
        : m.minGames + "~" + m.maxGames + "경기";
    var roundsText =
      m.rounds + "라운드" +
      (m.hasGroups ? "(그룹별 " + m.groupRounds + " · 혼합 " + m.mixedRounds + ")" : "");
    el.resultMeta.textContent =
      m.players + "명 · " + courtLayoutText(m) + " · " + roundsText + " · 1인당 " +
      balance + (m.restPerRound > 0 ? " · 라운드당 " + m.restPerRound + "명 휴식" : "");

    if (m.forcedPairs && m.forcedPairs.length) {
      el.forcedPairsResult.hidden = false;
      el.forcedPairsResult.innerHTML = m.forcedPairs
        .map(function (fp) {
          var ok = fp.achieved >= fp.required;
          return (
            '<div class="psum ' + (ok ? "ok" : "warn") + '">' +
            esc(fp.a) + " + " + esc(fp.b) + " " +
            '<span class="status">' + fp.achieved + "/" + fp.required + "</span>" +
            (ok ? "" : " (부족)") +
            "</div>"
          );
        })
        .join("");
    } else {
      el.forcedPairsResult.hidden = true;
      el.forcedPairsResult.innerHTML = "";
    }

    if (m.fixedMatches && m.fixedMatches.length) {
      el.fixedMatchesResult.hidden = false;
      el.fixedMatchesResult.innerHTML = m.fixedMatches
        .map(function (fm) {
          var ok = fm.round != null;
          return (
            '<div class="psum ' + (ok ? "ok" : "warn") + '">' +
            esc(fm.team1.join(" · ")) + " vs " + esc(fm.team2.join(" · ")) + " " +
            '<span class="status">' + (ok ? fm.round + "라운드" : "배정 못 함") + "</span>" +
            "</div>"
          );
        })
        .join("");
    } else {
      el.fixedMatchesResult.hidden = true;
      el.fixedMatchesResult.innerHTML = "";
    }

    el.roundsBox.innerHTML = "";
    res.rounds.forEach(function (rd, idx) {
      var start = idx * gameMinutes;
      var end = start + gameMinutes;
      var timeLabel = fmtRange(start, end, startMin);
      var div = document.createElement("div");
      div.className = "round";

      var courtsHtml = rd.courts
        .map(function (ct) {
          var isSingles = ct.type === "singles";
          var badge = isSingles
            ? '<span class="ctype singles">단식</span>'
            : '<span class="ctype doubles">복식</span>';
          var gbadge = ct.group
            ? ' <span class="gtag ' + (ct.group === "A" ? "a" : "b") + '">' + esc(ct.group) + "조</span>"
            : "";
          return (
            '<div class="court' + (isSingles ? " is-singles" : "") + '">' +
            '<div class="court-title">코트 ' + ct.court + " " + badge + gbadge + "</div>" +
            '<div class="match">' +
            '<div class="team t1">' + teamTags(ct.team1) + "</div>" +
            '<div class="vs">VS</div>' +
            '<div class="team t2">' + teamTags(ct.team2) + "</div>" +
            "</div></div>"
          );
        })
        .join("");

      var restHtml = rd.resting.length
        ? '<div class="resting">' + MOON_SVG + "휴식: <b>" + rd.resting.map(esc).join(", ") + "</b></div>"
        : "";

      // 이 라운드가 그룹별(레벨전)인지 여부 — 코트가 하나라도 group 태그를 갖고 있으면 그룹별 라운드
      var isGroupRound = rd.courts.some(function (ct) { return !!ct.group; });
      var phaseTag = isGroupRound ? '<span class="phase-tag">그룹전</span>' : "";

      div.innerHTML =
        '<div class="round-head">' +
        "<h3>" + phaseTag + "라운드 " + rd.round + "</h3>" +
        '<span class="time-tag">' + timeLabel + "</span>" +
        "</div>" +
        '<div class="courts">' + courtsHtml + "</div>" +
        restHtml;
      el.roundsBox.appendChild(div);
    });

    // 참석자별 요약
    el.playerSummary.innerHTML = res.summary
      .slice()
      .sort(function (a, b) { return b.games - a.games; })
      .map(function (s) {
        return (
          '<div class="psum">' +
          esc(s.name) +
          ' <span class="g">' + s.games + "경기</span>" +
          (s.rests ? ' <span class="r">(휴식 ' + s.rests + ")</span>" : "") +
          "</div>"
        );
      })
      .join("");
  }

  function teamTags(team) {
    return team
      .map(function (n) { return '<div class="player-tag">' + esc(n) + "</div>"; })
      .join("");
  }

  // 라운드 시간 표기. 시작 시각을 알면 실제 시각(18:00~18:30), 모르면 상대 분(+0~30분)
  function fmtRange(offsetStart, offsetEnd, baseMin) {
    if (baseMin == null) return "+" + offsetStart + "~" + offsetEnd + "분";
    return minutesToTime(baseMin + offsetStart) + " ~ " + minutesToTime(baseMin + offsetEnd);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---- 텍스트로 복사 ----
  function toPlainText() {
    if (!state.last) return "";
    var res = state.last.res;
    var gm = state.last.gameMinutes;
    var base = state.last.startMin;
    var lines = ["테니스 대진표", ""];
    res.rounds.forEach(function (rd, idx) {
      var isGroupRound = rd.courts.some(function (ct) { return !!ct.group; });
      var phase = isGroupRound ? " [그룹전]" : "";
      lines.push("■ 라운드 " + rd.round + phase + " (" + fmtRange(idx * gm, idx * gm + gm, base) + ")");
      rd.courts.forEach(function (ct) {
        var tags = [];
        if (ct.type === "singles") tags.push("단식");
        if (ct.group) tags.push(ct.group + "조");
        var tag = tags.length ? "(" + tags.join(", ") + ")" : "";
        lines.push(
          "  코트" + ct.court + tag + ": " +
            ct.team1.join(" · ") + "  vs  " + ct.team2.join(" · ")
        );
      });
      if (rd.resting.length) lines.push("  휴식: " + rd.resting.join(", "));
      lines.push("");
    });
    lines.push("· 경기 수: " + res.summary
      .map(function (s) { return s.name + " " + s.games; })
      .join(", "));
    if (res.meta.forcedPairs && res.meta.forcedPairs.length) {
      lines.push("· 고정 매칭: " + res.meta.forcedPairs
        .map(function (fp) { return fp.a + "+" + fp.b + " " + fp.achieved + "/" + fp.required; })
        .join(", "));
    }
    if (res.meta.fixedMatches && res.meta.fixedMatches.length) {
      lines.push("· 대진 고정: " + res.meta.fixedMatches
        .map(function (fm) {
          return fm.team1.join("·") + " vs " + fm.team2.join("·") +
            (fm.round != null ? " (" + fm.round + "라운드)" : " (배정 못 함)");
        })
        .join(", "));
    }
    return lines.join("\n");
  }

  function copyResult() {
    var text = toPlainText();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("복사됐어요. 단톡방에 붙여넣으세요."); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("복사됐어요."); }
    catch (e) { toast("복사에 실패했어요."); }
    document.body.removeChild(ta);
  }

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    requestAnimationFrame(function () { el.toast.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove("show");
      setTimeout(function () { el.toast.hidden = true; }, 220);
    }, 2200);
  }

  // ---- 이벤트 바인딩 ----
  function bindStepper(container) {
    container.querySelectorAll(".step").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var input = $(container.getAttribute("data-target"));
        var delta = parseInt(btn.getAttribute("data-delta"), 10);
        var min = parseInt(input.getAttribute("min"), 10);
        var max = parseInt(input.getAttribute("max"), 10);
        var val = (parseInt(input.value, 10) || 0) + delta;
        if (!isNaN(min)) val = Math.max(min, val);
        if (!isNaN(max)) val = Math.min(max, val);
        input.value = val;
        onSettingChange();
      });
    });
  }

  // 결과가 이미 떠 있으면 설정 변경 시 같은 시드로 즉시 재적용
  function onSettingChange() {
    updateHints();
    if (!el.result.hidden && state.last) {
      generate(false, true); // keepSeed=true: 무작위로 다시 섞지 않고 그대로 반영
    }
  }

  function init() {
    restore();
    syncManualUI();
    syncGroupsUI();
    syncForcedPairsUI();
    syncFixedMatchesUI();
    document.querySelectorAll(".stepper").forEach(bindStepper);

    // 참석자 이름은 타이핑 중 잦은 갱신이므로 힌트만
    el.players.addEventListener("input", updateHints);
    el.playersA.addEventListener("input", updateHints);
    el.playersB.addEventListener("input", updateHints);

    el.useGroups.addEventListener("change", function () {
      syncGroupsUI();
      onSettingChange();
    });

    el.useForcedPairs.addEventListener("change", function () {
      syncForcedPairsUI();
      onSettingChange();
    });
    el.addForcedPairBtn.addEventListener("click", function () {
      addForcedPairRow();
      updateHints();
    });

    el.useFixedMatches.addEventListener("change", function () {
      syncFixedMatchesUI();
      onSettingChange();
    });
    el.addFixedMatchBtn.addEventListener("click", function () {
      addFixedMatchRow();
      updateHints();
    });

    // 경기 세팅 변경은 결과가 있으면 즉시 재적용
    el.courts.addEventListener("input", onSettingChange);
    el.gameMinutes.addEventListener("input", onSettingChange);
    el.rounds.addEventListener("input", onSettingChange);
    el.groupRounds.addEventListener("input", onSettingChange);
    el.startTime.addEventListener("input", onSettingChange);
    el.endTime.addEventListener("input", onSettingChange);

    el.manualRounds.addEventListener("change", function () {
      state.customMode = el.manualRounds.checked;
      syncManualUI();
      onSettingChange();
    });

    el.generate.addEventListener("click", function () { generate(false); });
    el.reshuffle.addEventListener("click", function () { generate(true); });
    el.copy.addEventListener("click", copyResult);
    el.print.addEventListener("click", function () { window.print(); });

    updateHints();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
