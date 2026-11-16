/* Diário Miccional — registro de sondagens (cateterismo intermitente).
   Tudo fica no aparelho (localStorage). Sem servidor, sem conta. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ storage
  var KEY_ENTRIES = "dm.entries.v1";
  var KEY_SETTINGS = "dm.settings.v1";
  var KEY_ALARM = "dm.alarm.v1";

  var DEFAULT_SETTINGS = {
    maxMl: null,
    bigText: false,
    lastMl: 300,
    rem: { on: false, mode: "interval", every: 4, start: "07:00", end: "23:00", times: ["07:00", "11:00", "15:00", "19:00", "23:00"] }
  };

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast("Não foi possível salvar no aparelho. Verifique o espaço livre."); return false; }
  }

  var entries = load(KEY_ENTRIES, []);
  var settings = merge(DEFAULT_SETTINGS, load(KEY_SETTINGS, {}));
  var alarmState = load(KEY_ALARM, { acked: 0, snoozeUntil: 0 });

  function merge(base, over) {
    var out = JSON.parse(JSON.stringify(base));
    Object.keys(over || {}).forEach(function (k) {
      if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) && out[k] && typeof out[k] === "object") {
        out[k] = merge(out[k], over[k]);
      } else { out[k] = over[k]; }
    });
    return out;
  }
  function sortEntries() { entries.sort(function (a, b) { return a.t - b.t; }); }
  function persistEntries() { sortEntries(); return save(KEY_ENTRIES, entries); }
  function persistSettings() { save(KEY_SETTINGS, settings); }
  function persistAlarm() { save(KEY_ALARM, alarmState); }

  // Pede ao navegador para não apagar os dados quando faltar espaço.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (p) { return p || navigator.storage.persist(); })
      .then(function (ok) { storageNote(ok); }).catch(function () { storageNote(false); });
  } else { storageNote(false); }
  function storageNote(ok) {
    var el = $("#storageNote");
    if (el) el.textContent = ok ? "Armazenamento protegido: o navegador não apaga estes dados sozinho." : "";
  }

  // ------------------------------------------------------------------ helpers
  function $(s, root) { return (root || document).querySelector(s); }
  function $all(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  var HOUR = 3600e3, DAY = 24 * HOUR, MIN = 60e3;

  function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function toLocalInput(t) { var d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + hhmm(t); }
  function fromLocalInput(v) { var t = new Date(v).getTime(); return isNaN(t) ? null : t; }
  function fmtNum(n) { return Math.round(n).toLocaleString("pt-BR"); }
  function fmtDur(ms) {
    var neg = ms < 0; ms = Math.abs(ms);
    var m = Math.round(ms / MIN), h = Math.floor(m / 60); m = m % 60;
    var s = h ? h + "h" + (m ? " " + pad(m) + "min" : "") : m + " min";
    return neg ? "-" + s : s;
  }
  function dayLabel(t) {
    var today = dayStart(Date.now());
    var ds = dayStart(t);
    if (ds === today) return "Hoje";
    if (ds === today - DAY) return "Ontem";
    return new Date(t).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });
  }
  function timeToMin(s) { var p = (s || "00:00").split(":"); return (+p[0]) * 60 + (+p[1]); }
  function atMinutes(base, mins) { var d = new Date(dayStart(base)); d.setMinutes(mins); return d.getTime(); }
  var LOOK = { clara: "Clara", concentrada: "Concentrada", turva: "Turva", sangue: "Com sangue" };

  // ------------------------------------------------------------------ toast
  var toastTimer = null, toastFn = null;
  function toast(msg, actionLabel, fn) {
    $("#toastMsg").textContent = msg;
    var btn = $("#toastAction");
    toastFn = fn || null;
    btn.hidden = !fn;
    if (fn) btn.textContent = actionLabel || "Desfazer";
    $("#toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $("#toast").hidden = true; toastFn = null; }, fn ? 6000 : 3500);
  }
  $("#toastAction").addEventListener("click", function () {
    var f = toastFn; $("#toast").hidden = true; toastFn = null; if (f) f();
  });

  // ------------------------------------------------------------------ navegação
  var current = "registrar";
  function show(view) {
    current = view;
    $all(".view").forEach(function (v) { v.hidden = v.id !== "view-" + view; });
    $all(".tab").forEach(function (b) {
      if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (view === "historico") renderHistory();
    if (view === "graficos") renderStats();
    if (view === "lembretes") renderReminders();
    try { history.replaceState(null, "", "#" + view); } catch (e) {}
    window.scrollTo(0, 0);
  }
  $all(".tab").forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.view); }); });

  // ------------------------------------------------------------------ formulário
  var editingId = null;
  var mlInput = $("#ml");
  var look = "";
  var leak = false;

  function setMl(v) {
    v = Math.max(0, Math.min(2000, Math.round(v / 10) * 10 || 0));
    mlInput.value = v;
    $all(".presets .chip").forEach(function (c) { c.setAttribute("aria-pressed", String(+c.dataset.ml === v)); });
    var hint = $("#mlHint");
    if (settings.maxMl && v > settings.maxMl) {
      hint.textContent = "Acima do máximo que você definiu (" + settings.maxMl + " ml).";
      hint.className = "hint warn";
    } else {
      hint.textContent = "Use + e − (50 ml) ou toque num valor. Também dá pra digitar.";
      hint.className = "hint";
    }
  }
  $("#minus").addEventListener("click", function () { setMl((+mlInput.value || 0) - 50); });
  $("#plus").addEventListener("click", function () { setMl((+mlInput.value || 0) + 50); });
  $all(".presets .chip").forEach(function (c) { c.addEventListener("click", function () { setMl(+c.dataset.ml); }); });
  mlInput.addEventListener("change", function () { setMl(+mlInput.value || 0); });
  mlInput.addEventListener("focus", function () { mlInput.select(); });

  $("#nowBtn").addEventListener("click", function () { $("#when").value = toLocalInput(Date.now()); });

  function setSwitch(el, on) { el.setAttribute("aria-checked", String(!!on)); }
  $("#leak").addEventListener("click", function () { leak = !leak; setSwitch(this, leak); });

  function setSeg(group, value) {
    $all("button", group).forEach(function (b) { b.setAttribute("aria-checked", String(b.dataset.v === value)); });
  }
  $all("#look button").forEach(function (b) {
    b.addEventListener("click", function () { look = look === b.dataset.v ? "" : b.dataset.v; setSeg($("#look"), look); });
  });

  function resetForm() {
    editingId = null;
    setMl(settings.lastMl || 300);
    $("#when").value = toLocalInput(Date.now());
    leak = false; setSwitch($("#leak"), false);
    look = ""; setSeg($("#look"), "");
    $("#note").value = "";
    $("#moreBox").open = false;
    $("#formTitle").textContent = "Nova sondagem";
    $("#saveBtn").textContent = "Salvar registro";
    $("#cancelEdit").hidden = true;
  }

  function startEdit(id) {
    var e = entries.find(function (x) { return x.id === id; });
    if (!e) return;
    show("registrar");
    editingId = id;
    setMl(e.ml);
    $("#when").value = toLocalInput(e.t);
    leak = !!e.leak; setSwitch($("#leak"), leak);
    look = e.look || ""; setSeg($("#look"), look);
    $("#note").value = e.note || "";
    $("#moreBox").open = !!(e.leak || e.look || e.note);
    $("#formTitle").textContent = "Editar registro";
    $("#saveBtn").textContent = "Salvar alterações";
    $("#cancelEdit").hidden = false;
  }
  $("#cancelEdit").addEventListener("click", function () { resetForm(); });

  $("#entryForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var ml = +mlInput.value;
    if (!ml || ml <= 0) { toast("Informe o volume em ml."); mlInput.focus(); return; }
    var t = fromLocalInput($("#when").value) || Date.now();
    if (t > Date.now() + 5 * MIN) { toast("A data/hora está no futuro. Confira."); return; }
    var data = { t: t, ml: ml, leak: leak, look: look, note: $("#note").value.trim() };

    if (editingId) {
      var idx = entries.findIndex(function (x) { return x.id === editingId; });
      if (idx >= 0) entries[idx] = Object.assign({ id: editingId }, data);
      persistEntries();
      toast("Registro atualizado.");
    } else {
      var entry = Object.assign({ id: uid() }, data);
      entries.push(entry);
      persistEntries();
      settings.lastMl = ml; persistSettings();
      toast("Salvo: " + ml + " ml às " + hhmm(t) + ".", "Desfazer", function () {
        entries = entries.filter(function (x) { return x.id !== entry.id; });
        persistEntries(); refreshAll(); toast("Registro removido.");
      });
      // registrar conta como "fiz a sondagem": limpa adiamento
      alarmState.snoozeUntil = 0; persistAlarm();
    }
    resetForm();
    refreshAll();
  });

  // ------------------------------------------------------------------ resumo do topo
  function todayEntries() {
    var s = dayStart(Date.now());
    return entries.filter(function (e) { return e.t >= s && e.t < s + DAY; });
  }
  function lastEntry() { return entries.length ? entries[entries.length - 1] : null; }

  function renderTop() {
    var td = todayEntries();
    var total = td.reduce(function (a, e) { return a + e.ml; }, 0);
    $("#todaySummary").textContent = td.length
      ? "Hoje: " + td.length + (td.length === 1 ? " sondagem" : " sondagens") + " · " + fmtNum(total) + " ml"
      : "Hoje: nenhum registro";

    var last = lastEntry();
    var line = $("#lastLine");
    if (last) {
      line.innerHTML = "";
      line.append("Última: ");
      var b = document.createElement("strong");
      b.textContent = last.ml + " ml";
      line.append(b, " às " + hhmm(last.t) + (dayStart(last.t) === dayStart(Date.now()) ? "" : " (" + dayLabel(last.t).toLowerCase() + ")") +
        " · há " + fmtDur(Date.now() - last.t));
    } else {
      line.textContent = "Nenhuma sondagem registrada ainda.";
    }

    var pill = $("#nextPill");
    var nx = settings.rem.on ? nextDue(Date.now()) : null;
    if (nx) {
      var diff = nx - Date.now();
      pill.hidden = false;
      pill.classList.toggle("late", diff < 0);
      pill.innerHTML = "";
      pill.append(diff < 0 ? "Atrasada" : "Próxima");
      var s = document.createElement("strong");
      s.textContent = diff < 0 ? fmtDur(-diff) : hhmm(nx);
      pill.append(s);
    } else { pill.hidden = true; }
  }

  // ------------------------------------------------------------------ histórico
  var historyDays = 14;
  function renderHistory() {
    var box = $("#historyList");
    box.innerHTML = "";
    if (!entries.length) {
      box.innerHTML = '<div class="empty"><p>Nenhum registro ainda. Use a aba <strong>Registrar</strong> depois de cada sondagem.</p></div>';
      $("#moreHistory").hidden = true;
      return;
    }
    var groups = {};
    var order = [];
    entries.slice().reverse().forEach(function (e) {
      var k = dayKey(e.t);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(e);
    });
    order.slice(0, historyDays).forEach(function (k) {
      var list = groups[k];
      var total = list.reduce(function (a, e) { return a + e.ml; }, 0);
      var day = document.createElement("section");
      day.className = "day";
      var head = document.createElement("div");
      head.className = "day-head";
      var h = document.createElement("h3"); h.textContent = dayLabel(list[0].t);
      var s = document.createElement("span"); s.textContent = list.length + (list.length === 1 ? " sondagem" : " sondagens") + " · " + fmtNum(total) + " ml";
      head.append(h, s);
      day.append(head);
      list.forEach(function (e) { day.append(entryRow(e)); });
      box.append(day);
    });
    $("#moreHistory").hidden = order.length <= historyDays;
  }
  $("#moreHistory").addEventListener("click", function () { historyDays += 14; renderHistory(); });

  var ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>';
  var ICON_DEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/></svg>';

  function entryRow(e) {
    var row = document.createElement("div");
    row.className = "entry";
    var time = document.createElement("span"); time.className = "e-time"; time.textContent = hhmm(e.t);
    var main = document.createElement("div"); main.className = "e-main";
    var ml = document.createElement("span"); ml.className = "e-ml"; ml.textContent = e.ml + " ml";
    main.append(ml);
    if (settings.maxMl && e.ml > settings.maxMl) main.append(tag("acima do máx.", "warn"));
    if (e.leak) main.append(tag("perda", "warn"));
    if (e.look) main.append(tag(LOOK[e.look] || e.look, (e.look === "turva" || e.look === "sangue") ? "danger" : ""));
    if (e.note) { var n = document.createElement("span"); n.className = "e-note"; n.textContent = e.note; main.append(n); }

    var acts = document.createElement("div"); acts.className = "e-acts";
    var ed = document.createElement("button"); ed.type = "button"; ed.className = "icon-btn"; ed.innerHTML = ICON_EDIT;
    ed.setAttribute("aria-label", "Editar registro de " + e.ml + " ml às " + hhmm(e.t));
    ed.addEventListener("click", function () { startEdit(e.id); });
    var del = document.createElement("button"); del.type = "button"; del.className = "icon-btn"; del.innerHTML = ICON_DEL;
    del.setAttribute("aria-label", "Apagar registro de " + e.ml + " ml às " + hhmm(e.t));
    var armed = false, armTimer;
    del.addEventListener("click", function () {
      if (!armed) {
        armed = true; del.classList.add("confirm"); del.textContent = "Apagar?";
        armTimer = setTimeout(function () { armed = false; del.classList.remove("confirm"); del.innerHTML = ICON_DEL; }, 3500);
        return;
      }
      clearTimeout(armTimer);
      var removed = e;
      entries = entries.filter(function (x) { return x.id !== e.id; });
      persistEntries(); refreshAll();
      toast("Registro apagado.", "Desfazer", function () { entries.push(removed); persistEntries(); refreshAll(); });
    });
    acts.append(ed, del);
    row.append(time, main, acts);
    return row;
  }
  function tag(text, kind) { var s = document.createElement("span"); s.className = "tag" + (kind ? " " + kind : ""); s.textContent = text; return s; }

  // ------------------------------------------------------------------ estatísticas
  var period = 7;
  $all("#period button").forEach(function (b) {
    b.addEventListener("click", function () { period = +b.dataset.v; setSeg($("#period"), b.dataset.v); renderStats(); });
  });

  function renderStats() {
    var now = Date.now();
    var from = dayStart(now) - (period - 1) * DAY;
    var list = entries.filter(function (e) { return e.t >= from; });
    var hasAny = list.length > 0;
    $("#statsEmpty").hidden = hasAny;
    $("#statsBody").hidden = !hasAny;
    if (!hasAny) {
      $("#statsEmpty").innerHTML = entries.length
        ? "<p>Nenhum registro nos últimos " + period + " dias.</p>"
        : "<p>Os gráficos aparecem depois dos primeiros registros.</p>";
      return;
    }

    // dias com registro (para médias justas, só conta dias que têm dado)
    var byDay = {};
    for (var i = 0; i < period; i++) byDay[dayKey(from + i * DAY + 2 * HOUR)] = { t: from + i * DAY, n: 0, ml: 0 };
    list.forEach(function (e) { var d = byDay[dayKey(e.t)]; if (d) { d.n++; d.ml += e.ml; } });
    var days = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
    var activeDays = days.filter(function (d) { return d.n > 0; });

    var total = list.reduce(function (a, e) { return a + e.ml; }, 0);
    var avg = total / list.length;
    var max = Math.max.apply(null, list.map(function (e) { return e.ml; }));
    var perDay = list.length / activeDays.length;
    var totalPerDay = total / activeDays.length;

    // intervalo médio entre sondagens consecutivas, ignorando lacunas > 12h (noite/esquecimento)
    var gaps = [];
    for (var j = 1; j < list.length; j++) {
      var g = list[j].t - list[j - 1].t;
      if (g > 0 && g <= 12 * HOUR) gaps.push(g);
    }
    var avgGap = gaps.length ? gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length : null;
    var over = settings.maxMl ? list.filter(function (e) { return e.ml > settings.maxMl; }).length : 0;
    var leaks = list.filter(function (e) { return e.leak; }).length;

    var k = [
      { v: fmtNum(avg) + " ml", l: "média por sondagem" },
      { v: perDay.toFixed(1).replace(".", ","), l: "sondagens por dia" },
      { v: avgGap ? fmtDur(avgGap) : "—", l: "intervalo médio" },
      { v: fmtNum(totalPerDay) + " ml", l: "total médio por dia" },
      { v: fmtNum(max) + " ml", l: "maior volume", warn: settings.maxMl && max > settings.maxMl },
      { v: String(leaks), l: leaks === 1 ? "registro com perda" : "registros com perda", warn: leaks > 0 }
    ];
    var kb = $("#kpis"); kb.innerHTML = "";
    k.forEach(function (x) {
      var d = document.createElement("div"); d.className = "kpi" + (x.warn ? " warn" : "");
      var b = document.createElement("b"); b.textContent = x.v;
      var s = document.createElement("small"); s.textContent = x.l;
      d.append(b, s); kb.append(d);
    });

    $("#chartDaily").innerHTML = chartDaily(days);
    $("#chartEach").innerHTML = chartEach(list, from, now);
    $("#chartHours").innerHTML = chartHours(list);
    $("#limitCaption").textContent = settings.maxMl
      ? "linha tracejada = seu máximo (" + settings.maxMl + " ml)"
      : "defina um máximo em Lembretes › Ajustes para ver a linha de referência";

    var fl = $("#flags"); fl.innerHTML = "";
    var looks = list.filter(function (e) { return e.look === "turva" || e.look === "sangue"; }).length;
    if (over) addFlag(fl, over + (over === 1 ? " sondagem passou" : " sondagens passaram") + " do máximo definido.");
    if (looks) addFlag(fl, looks + (looks === 1 ? " registro" : " registros") + " com urina turva ou com sangue no período. Vale comentar com seu médico.");
  }
  function addFlag(box, text) {
    var d = document.createElement("div"); d.className = "flag";
    var s = document.createElement("strong"); s.textContent = "Atenção: ";
    d.append(s, text); box.append(d);
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    var steps = [100, 200, 250, 500, 1000, 2000, 2500, 5000];
    var target = v / 4;
    for (var i = 0; i < steps.length; i++) if (steps[i] >= target) return Math.ceil(v / steps[i]) * steps[i];
    return Math.ceil(v / 5000) * 5000;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function chartDaily(days) {
    var W = 520, H = 220, L = 44, R = 10, T = 22, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var top = niceMax(Math.max.apply(null, days.map(function (d) { return d.ml; })));
    var y = function (v) { return T + ph - (v / top) * ph; };
    var bw = pw / days.length;
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Volume total por dia">';
    for (var i = 0; i <= 4; i++) {
      var v = top * i / 4, yy = y(v);
      out += '<line class="c-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>';
      out += '<text class="c-axis" x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmtNum(v) + "</text>";
    }
    var today = dayStart(Date.now());
    var every = days.length > 14 ? 5 : days.length > 7 ? 2 : 1;
    days.forEach(function (d, i) {
      var x = L + i * bw, w = Math.max(2, bw * 0.62), cx = x + bw / 2;
      if (d.ml > 0) {
        out += '<rect class="c-bar' + (d.t === today ? " today" : "") + '" x="' + (cx - w / 2) + '" y="' + y(d.ml) + '" width="' + w + '" height="' + (T + ph - y(d.ml)) + '" rx="3"><title>' +
          esc(new Date(d.t).toLocaleDateString("pt-BR") + ": " + fmtNum(d.ml) + " ml em " + d.n + " sondagens") + "</title></rect>";
        if (bw > 14) out += '<text class="c-val" x="' + cx + '" y="' + (y(d.ml) - 5) + '" text-anchor="middle">' + d.n + "</text>";
      }
      if ((days.length - 1 - i) % every === 0) {
        var dt = new Date(d.t);
        out += '<text class="c-axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + pad(dt.getDate()) + "/" + pad(dt.getMonth() + 1) + "</text>";
      }
    });
    return out + "</svg>";
  }

  function chartEach(list, from, now) {
    var W = 520, H = 220, L = 44, R = 10, T = 14, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var maxV = Math.max.apply(null, list.map(function (e) { return e.ml; }).concat(settings.maxMl || 0));
    var top = niceMax(maxV * 1.05);
    var end = dayStart(now) + DAY;
    var x = function (t) { return L + ((t - from) / (end - from)) * pw; };
    var y = function (v) { return T + ph - (v / top) * ph; };
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Volume de cada sondagem ao longo do tempo">';
    for (var i = 0; i <= 4; i++) {
      var v = top * i / 4, yy = y(v);
      out += '<line class="c-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>';
      out += '<text class="c-axis" x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmtNum(v) + "</text>";
    }
    var nDays = Math.round((end - from) / DAY);
    var every = nDays > 14 ? 5 : nDays > 7 ? 2 : 1;
    for (var d = 0; d < nDays; d++) {
      if ((nDays - 1 - d) % every) continue;
      var t = from + d * DAY + DAY / 2, dt = new Date(t);
      out += '<text class="c-axis" x="' + x(t) + '" y="' + (H - 8) + '" text-anchor="middle">' + pad(dt.getDate()) + "/" + pad(dt.getMonth() + 1) + "</text>";
    }
    if (settings.maxMl) {
      var ly = y(settings.maxMl);
      out += '<line class="c-limit" x1="' + L + '" x2="' + (W - R) + '" y1="' + ly + '" y2="' + ly + '"/>';
      out += '<text class="c-limit-t" x="' + (W - R) + '" y="' + (ly - 5) + '" text-anchor="end">máx. ' + settings.maxMl + "</text>";
    }
    if (list.length > 1) {
      out += '<polyline class="c-line" points="' + list.map(function (e) { return x(e.t).toFixed(1) + "," + y(e.ml).toFixed(1); }).join(" ") + '"/>';
    }
    list.forEach(function (e) {
      var o = settings.maxMl && e.ml > settings.maxMl;
      out += '<circle class="c-dot' + (o ? " over" : "") + '" cx="' + x(e.t).toFixed(1) + '" cy="' + y(e.ml).toFixed(1) + '" r="' + (o ? 5 : 4) + '"><title>' +
        esc(new Date(e.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " · " + e.ml + " ml") + "</title></circle>";
    });
    return out + "</svg>";
  }

  function chartHours(list) {
    var W = 520, H = 170, L = 28, R = 8, T = 16, B = 26;
    var pw = W - L - R, ph = H - T - B;
    var counts = new Array(24).fill(0);
    list.forEach(function (e) { counts[new Date(e.t).getHours()]++; });
    var top = Math.max(1, Math.max.apply(null, counts));
    var bw = pw / 24;
    var y = function (v) { return T + ph - (v / top) * ph; };
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Quantidade de sondagens por hora do dia">';
    out += '<line class="c-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ph) + '" y2="' + (T + ph) + '"/>';
    out += '<text class="c-axis" x="' + (L - 6) + '" y="' + (T + 4) + '" text-anchor="end">' + top + "</text>";
    counts.forEach(function (c, h) {
      var x = L + h * bw, w = bw * 0.7;
      if (c) out += '<rect class="c-bar" x="' + (x + (bw - w) / 2) + '" y="' + y(c) + '" width="' + w + '" height="' + (T + ph - y(c)) + '" rx="2"><title>' + pad(h) + "h: " + c + "</title></rect>";
      if (h % 3 === 0) out += '<text class="c-axis" x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + pad(h) + "h</text>";
    });
    return out + "</svg>";
  }

  // ------------------------------------------------------------------ lembretes
  // Retorna o horário da próxima sondagem prevista (pode estar no passado = atrasada).
  function nextDue(now) {
    var r = settings.rem;
    var last = lastEntry();
    var s = timeToMin(r.start), e = timeToMin(r.end);
    var inWindow = function (t) {
      var m = new Date(t).getHours() * 60 + new Date(t).getMinutes();
      return s <= e ? (m >= s && m <= e) : (m >= s || m <= e);
    };
    var nextWindowStart = function (t) {
      var c = atMinutes(t, s);
      return c > t ? c : atMinutes(t + DAY, s);
    };
    if (r.mode === "interval") {
      var every = (+r.every || 4) * HOUR;
      var base = last ? last.t + every : null;
      if (base === null) return inWindow(now) ? null : nextWindowStart(now);
      // depois de muito tempo sem registro, não acumula atraso infinito
      if (now - base > 12 * HOUR) base = inWindow(now) ? now : nextWindowStart(now);
      if (!inWindow(base)) base = nextWindowStart(base);
      return base;
    }
    // horários fixos: horário mais recente ainda não cumprido, senão o próximo
    var times = (r.times || []).map(timeToMin).sort(function (a, b) { return a - b; });
    if (!times.length) return null;
    var slots = [];
    [-1, 0, 1].forEach(function (d) { times.forEach(function (m) { slots.push(atMinutes(now + d * DAY, m)); }); });
    slots.sort(function (a, b) { return a - b; });
    var pastSlot = null;
    slots.forEach(function (t) { if (t <= now && now - t < 3 * HOUR) pastSlot = t; });
    if (pastSlot !== null) {
      var done = entries.some(function (x) { return x.t >= pastSlot - 45 * MIN; });
      if (!done) return pastSlot;
    }
    for (var i = 0; i < slots.length; i++) if (slots[i] > now) return slots[i];
    return null;
  }

  function renderReminders() {
    var r = settings.rem;
    setSwitch($("#remOn"), r.on);
    $("#remBody").classList.toggle("off", !r.on);
    setSeg($("#remMode"), r.mode);
    $("#modeInterval").hidden = r.mode !== "interval";
    $("#modeTimes").hidden = r.mode !== "times";
    $("#everyOut").textContent = String(r.every).replace(".", ",") + " h";
    $("#winStart").value = r.start; $("#winEnd").value = r.end;
    var ul = $("#timesList"); ul.innerHTML = "";
    r.times.slice().sort().forEach(function (t) {
      var li = document.createElement("li"); li.textContent = t;
      var b = document.createElement("button"); b.type = "button"; b.textContent = "×"; b.setAttribute("aria-label", "Remover " + t);
      b.addEventListener("click", function () { r.times = r.times.filter(function (x) { return x !== t; }); persistSettings(); renderReminders(); renderTop(); });
      li.append(b); ul.append(li);
    });
    $("#maxMl").value = settings.maxMl || "";
    setSwitch($("#bigText"), settings.bigText);
    updateNotifBtn();
  }

  $("#remOn").addEventListener("click", function () {
    settings.rem.on = !settings.rem.on; persistSettings(); renderReminders(); renderTop();
    if (settings.rem.on) { unlockAudio(); toast("Lembretes ligados."); }
  });
  $all("#remMode button").forEach(function (b) {
    b.addEventListener("click", function () { settings.rem.mode = b.dataset.v; persistSettings(); renderReminders(); renderTop(); });
  });
  function stepEvery(d) {
    var v = Math.max(1, Math.min(12, (+settings.rem.every || 4) + d));
    settings.rem.every = v; persistSettings(); renderReminders(); renderTop();
  }
  $("#everyMinus").addEventListener("click", function () { stepEvery(-0.5); });
  $("#everyPlus").addEventListener("click", function () { stepEvery(0.5); });
  $("#winStart").addEventListener("change", function () { settings.rem.start = this.value || "07:00"; persistSettings(); renderTop(); });
  $("#winEnd").addEventListener("change", function () { settings.rem.end = this.value || "23:00"; persistSettings(); renderTop(); });
  $("#addTime").addEventListener("click", function () {
    var v = $("#newTime").value;
    if (!v) return;
    if (settings.rem.times.indexOf(v) === -1) settings.rem.times.push(v);
    persistSettings(); renderReminders(); renderTop();
  });
  $("#maxMl").addEventListener("change", function () {
    var v = +this.value; settings.maxMl = v > 0 ? v : null; persistSettings(); setMl(+mlInput.value);
    toast(settings.maxMl ? "Máximo salvo: " + settings.maxMl + " ml." : "Máximo removido.");
  });
  $("#bigText").addEventListener("click", function () {
    settings.bigText = !settings.bigText; persistSettings(); applyBig(); setSwitch(this, settings.bigText);
  });
  function applyBig() { document.documentElement.classList.toggle("big", !!settings.bigText); }

  // notificações
  function updateNotifBtn() {
    var b = $("#notifBtn");
    if (!("Notification" in window)) { b.textContent = "Notificações não disponíveis neste navegador"; b.disabled = true; return; }
    if (Notification.permission === "granted") { b.textContent = "Notificações permitidas ✓"; b.disabled = true; }
    else if (Notification.permission === "denied") { b.textContent = "Notificações bloqueadas (libere nas configurações)"; b.disabled = true; }
    else { b.textContent = "Permitir notificações"; b.disabled = false; }
  }
  $("#notifBtn").addEventListener("click", function () {
    unlockAudio();
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(updateNotifBtn);
  });
  $("#testAlarm").addEventListener("click", function () { unlockAudio(); fireAlarm(Date.now(), true); });

  // som
  var audioCtx = null;
  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {}
  }
  document.addEventListener("pointerdown", unlockAudio, { once: true });
  var beepTimer = null;
  function beep() {
    if (!audioCtx) return;
    try {
      var t0 = audioCtx.currentTime;
      [0, 0.25, 0.5].forEach(function (d) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0 + d);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + d); o.stop(t0 + d + 0.2);
      });
    } catch (e) {}
  }

  var alarmFor = 0;
  function fireAlarm(due, test) {
    alarmFor = test ? 0 : due;
    var late = Date.now() - due;
    $("#alarmText").textContent = test ? "Este é um teste do alarme." :
      (late > 2 * MIN ? "Prevista para " + hhmm(due) + " (há " + fmtDur(late) + ")." : "Prevista para " + hhmm(due) + ".");
    $("#alarm").hidden = false;
    $("#alarmGo").focus();
    beep(); clearInterval(beepTimer);
    beepTimer = setInterval(beep, 4000);
    try { if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) {}
    if (document.hidden || test) notify(test ? "Teste do alarme" : "Hora da sondagem", "Prevista para " + hhmm(due) + ". Toque para registrar.");
  }
  function closeAlarm() {
    $("#alarm").hidden = true; clearInterval(beepTimer); beepTimer = null;
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {}
  }
  function notify(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var opts = { body: body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "sondagem", renotify: true, requireInteraction: true, vibrate: [400, 200, 400] };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) { return reg.showNotification(title, opts); })
        .catch(function () { try { new Notification(title, opts); } catch (e) {} });
    } else { try { new Notification(title, opts); } catch (e) {} }
  }
  $("#alarmGo").addEventListener("click", function () {
    if (alarmFor) { alarmState.acked = alarmFor; persistAlarm(); }
    closeAlarm(); resetForm(); show("registrar"); mlInput.focus();
  });
  $("#alarmSnooze").addEventListener("click", function () {
    alarmState.snoozeUntil = Date.now() + 15 * MIN; persistAlarm(); closeAlarm(); toast("Vou lembrar de novo às " + hhmm(alarmState.snoozeUntil) + ".");
  });
  $("#alarmDismiss").addEventListener("click", function () {
    if (alarmFor) { alarmState.acked = alarmFor; persistAlarm(); }
    closeAlarm();
  });

  function tick() {
    renderTop();
    if (!settings.rem.on || !$("#alarm").hidden) return;
    var now = Date.now();
    var due = nextDue(now);
    if (!due || due > now) return;
    if (alarmState.acked === due) return;
    if (alarmState.snoozeUntil && now < alarmState.snoozeUntil) return;
    if (now - due > 3 * HOUR) return;
    fireAlarm(due, false);
  }
  setInterval(tick, 20000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });

  // ------------------------------------------------------------------ agenda (.ics)
  function icsTimes() {
    var r = settings.rem;
    if (r.mode === "times") return r.times.slice().sort();
    var s = timeToMin(r.start), e = timeToMin(r.end), step = Math.round((+r.every || 4) * 60), out = [];
    if (e < s) e += 24 * 60;
    for (var m = s; m <= e; m += step) out.push(pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60));
    return out;
  }
  function buildIcs(times) {
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + "T" + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + "00Z";
    var date = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Diario Miccional//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    times.forEach(function (t, i) {
      var hm = t.replace(":", "");
      var endMin = timeToMin(t) + 10;
      var endHm = pad(Math.floor(endMin / 60) % 24) + pad(endMin % 60);
      lines.push("BEGIN:VEVENT", "UID:sondagem-" + hm + "-" + i + "-" + date + "@diario-miccional",
        "DTSTAMP:" + stamp, "DTSTART:" + date + "T" + hm + "00", "DTEND:" + date + "T" + (endMin >= 1440 ? "2359" : endHm) + "00",
        "RRULE:FREQ=DAILY", "SUMMARY:Sondagem", "DESCRIPTION:Hora da sondagem. Depois registre o volume no Diário Miccional.",
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Hora da sondagem", "TRIGGER:PT0M", "END:VALARM",
        "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }
  $("#icsBtn").addEventListener("click", function () {
    var times = icsTimes();
    if (!times.length) { toast("Adicione pelo menos um horário."); return; }
    deliverFile("lembretes-sondagem.ics", "text/calendar", buildIcs(times),
      times.length + " alarmes diários: " + times.join(", ") + ". Abra o arquivo para adicionar à agenda.");
  });

  // ------------------------------------------------------------------ exportar / backup
  function deliverFile(name, type, content, msg) {
    var blob = new Blob([content], { type: type });
    var file = null;
    try { file = new File([blob], name, { type: type }); } catch (e) {}
    // No celular, o menu Compartilhar é o caminho mais confiável (WhatsApp, e-mail, Arquivos, Agenda…)
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      navigator.share({ files: [file], title: name }).then(function () { if (msg) toast(msg); })
        .catch(function (e) { if (e && e.name !== "AbortError") download(blob, name, msg); });
      return;
    }
    download(blob, name, msg);
  }
  function download(blob, name, msg) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    if (msg) toast(msg);
  }
  function csvCell(v) { v = v == null ? "" : String(v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  $("#csvBtn").addEventListener("click", function () {
    if (!entries.length) { toast("Ainda não há registros para exportar."); return; }
    var rows = [["data", "hora", "volume_ml", "perda", "aspecto", "observacao"]];
    entries.forEach(function (e) {
      var d = new Date(e.t);
      rows.push([pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(), hhmm(e.t), e.ml, e.leak ? "sim" : "nao", LOOK[e.look] || "", e.note || ""]);
    });
    var csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(";"); }).join("\r\n");
    deliverFile("diario-miccional-" + dayKey(Date.now()) + ".csv", "text/csv", csv, "Planilha gerada com " + entries.length + " registros.");
  });

  $("#backupBtn").addEventListener("click", function () {
    var data = JSON.stringify({ app: "diario-miccional", version: 1, exportedAt: new Date().toISOString(), entries: entries, settings: settings }, null, 1);
    deliverFile("backup-diario-miccional-" + dayKey(Date.now()) + ".json", "application/json", data, "Backup gerado.");
  });

  $("#restoreInput").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || data.app !== "diario-miccional" || !Array.isArray(data.entries)) throw new Error("formato");
        var known = {};
        entries.forEach(function (e) { known[e.id] = true; });
        var added = 0;
        data.entries.forEach(function (e) {
          if (e && typeof e.t === "number" && typeof e.ml === "number" && e.id && !known[e.id]) {
            entries.push({ id: String(e.id), t: e.t, ml: e.ml, leak: !!e.leak, look: LOOK[e.look] ? e.look : "", note: String(e.note || "").slice(0, 300) });
            added++;
          }
        });
        if (data.settings) { settings = merge(settings, data.settings); persistSettings(); applyBig(); }
        persistEntries(); refreshAll(); renderReminders();
        toast(added ? added + " registros restaurados." : "Nada novo: esses registros já estavam aqui.");
      } catch (e) { toast("Esse arquivo não é um backup do Diário Miccional."); }
    };
    reader.readAsText(f);
  });

  // ------------------------------------------------------------------ boot
  function refreshAll() {
    renderTop();
    if (current === "historico") renderHistory();
    if (current === "graficos") renderStats();
  }

  sortEntries();
  applyBig();
  resetForm();
  var start = (location.hash || "").slice(1);
  show(["registrar", "historico", "graficos", "lembretes"].indexOf(start) >= 0 ? start : "registrar");
  tick();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }

  // expõe para testes
  window.__dm = { nextDue: nextDue, get entries() { return entries; } };
})();
