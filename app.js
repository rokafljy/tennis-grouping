/* 테니스 대진표 UI 로직 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    players: $("players"),
    nameCount: $("name-count"),
    courts: $("courts"),
    gameMinutes: $("gameMinutes"),
    rounds: $("rounds"),
    customRounds: $("custom-rounds"),
    startTime: $("startTime"),
    endTime: $("endTime"),
    manualRounds: $("manualRounds"),
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

  var STORAGE_KEY = "tennis-grouping-v2";
  var state = {
    customMode: false, // 라운드 직접 지정 여부
    seed: 12345,
    last: null, // 마지막 입력(다시 섞기용)
  };

  // ---- 참석자 파싱 ----
  function parsePlayers() {
    return el.players.value
      .split(/[\n,]/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
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
    var players = parsePlayers();
    el.nameCount.textContent = "(" + players.length + "명)";

    var courts = parseInt(el.courts.value, 10) || 1;
    var gm = parseInt(el.gameMinutes.value, 10) || 30;
    var dur = durationMinutes();
    var rounds = computeRounds();
    var perRound = Math.min(courts, Math.floor(players.length / 4)) * 4;
    var rest = Math.max(0, players.length - perRound);

    if (dur == null) {
      el.planHint.textContent = "시작/종료 시간을 확인해 주세요.";
      persist();
      return;
    }
    if (players.length < 4) {
      el.planHint.textContent =
        "모임 " + (dur / 60).toFixed(dur % 60 ? 1 : 0) + "시간 · 복식 경기는 최소 4명부터 가능해요.";
      persist();
      return;
    }

    var msg = "모임 " + fmtDuration(dur) + " · 총 " + rounds + "라운드 · 라운드당 " + perRound + "명 경기";
    if (rest > 0) msg += " · " + rest + "명 휴식";
    if (perRound < courts * 4) {
      msg += " (인원이 부족해 " + Math.floor(players.length / 4) + "코트만 사용)";
    }
    // 라운드 총 소요시간이 모임 시간을 넘는지 안내
    if (rounds * gm > dur) {
      msg += " ⚠️ 경기 시간이 모임 시간을 초과해요";
    }
    el.planHint.textContent = msg;
    persist();
  }

  function fmtDuration(min) {
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (h && m) return h + "시간 " + m + "분";
    if (h) return h + "시간";
    return m + "분";
  }

  // ---- localStorage ----
  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          players: el.players.value,
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

  // ---- 대진표 생성 ----
  function generate(reshuffle) {
    el.error.hidden = true;
    var players = parsePlayers();

    // 중복 이름 확인 → 번호로 구분 표시
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
    if (!reshuffle) {
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
    el.resultMeta.textContent =
      m.players + "명 · " + m.usableCourts + "코트 · " + m.rounds + "라운드 · 1인당 " +
      balance + (m.restPerRound > 0 ? " · 라운드당 " + m.restPerRound + "명 휴식" : "");

    el.roundsBox.innerHTML = "";
    res.rounds.forEach(function (rd, idx) {
      var start = idx * gameMinutes;
      var end = start + gameMinutes;
      var timeLabel = fmtRange(start, end, startMin);
      var div = document.createElement("div");
      div.className = "round";

      var courtsHtml = rd.courts
        .map(function (ct) {
          return (
            '<div class="court">' +
            '<div class="court-title">코트 ' + ct.court + "</div>" +
            '<div class="match">' +
            '<div class="team t1">' + teamTags(ct.team1) + "</div>" +
            '<div class="vs">VS</div>' +
            '<div class="team t2">' + teamTags(ct.team2) + "</div>" +
            "</div></div>"
          );
        })
        .join("");

      var restHtml = rd.resting.length
        ? '<div class="resting">😴 휴식: <b>' + rd.resting.map(esc).join(", ") + "</b></div>"
        : "";

      div.innerHTML =
        '<div class="round-head">' +
        "<h3>라운드 " + rd.round + "</h3>" +
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
    var lines = ["🎾 테니스 대진표", ""];
    res.rounds.forEach(function (rd, idx) {
      lines.push("■ 라운드 " + rd.round + " (" + fmtRange(idx * gm, idx * gm + gm, base) + ")");
      rd.courts.forEach(function (ct) {
        lines.push(
          "  코트" + ct.court + ": " +
            ct.team1.join(" · ") + "  vs  " + ct.team2.join(" · ")
        );
      });
      if (rd.resting.length) lines.push("  휴식: " + rd.resting.join(", "));
      lines.push("");
    });
    lines.push("· 경기 수: " + res.summary
      .map(function (s) { return s.name + " " + s.games; })
      .join(", "));
    return lines.join("\n");
  }

  function copyResult() {
    var text = toPlainText();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("복사됐어요! 단톡방에 붙여넣으세요 📋"); },
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
    try { document.execCommand("copy"); toast("복사됐어요! 📋"); }
    catch (e) { toast("복사에 실패했어요"); }
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
        updateHints();
      });
    });
  }

  function init() {
    restore();
    syncManualUI();
    document.querySelectorAll(".stepper").forEach(bindStepper);

    el.players.addEventListener("input", updateHints);
    el.courts.addEventListener("input", updateHints);
    el.gameMinutes.addEventListener("input", updateHints);
    el.rounds.addEventListener("input", updateHints);
    el.startTime.addEventListener("input", updateHints);
    el.endTime.addEventListener("input", updateHints);

    el.manualRounds.addEventListener("change", function () {
      state.customMode = el.manualRounds.checked;
      syncManualUI();
      updateHints();
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
