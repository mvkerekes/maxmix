/* MaxMix — registro de sondagens (cateterismo intermitente).
   Tudo fica no aparelho (localStorage). Sem servidor, sem conta. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ storage
  var KEY_ENTRIES = "dm.entries.v1";
  var KEY_SETTINGS = "dm.settings.v1";
  var KEY_ALARM = "dm.alarm.v1";
  var KEY_MISSED = "dm.missed.v1"; // { "AAAA-MM-DD": nº aprox. de sondagens esquecidas }

  var DEFAULT_SETTINGS = {
    maxMl: null,
    targetAvg: 400,
    bigText: false,
    lastMl: 300,
    rem: { on: false, auto: true, fixed: false, offer: true, every: 4, start: "07:00", end: "23:00", times: ["07:00", "11:00", "15:00", "19:00", "23:00"] }
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
  // versões antigas tinham um único "modo"; converte para os dois interruptores
  if (settings.rem.mode) {
    settings.rem.auto = settings.rem.mode !== "times";
    settings.rem.fixed = settings.rem.mode === "times";
    delete settings.rem.mode;
  }
  var alarmState = load(KEY_ALARM, { acked: 0, snoozeUntil: 0 });
  var missed = load(KEY_MISSED, {});
  if (!missed || typeof missed !== "object" || Array.isArray(missed)) missed = {};
  function getMissed(k) { return Math.max(0, Math.min(20, +missed[k] || 0)); }
  function setMissed(k, n) {
    n = Math.max(0, Math.min(20, n | 0));
    if (n) missed[k] = n; else delete missed[k];
    save(KEY_MISSED, missed);
  }
  function plural(n, um, varios) { return n + " " + (n === 1 ? um : varios); }

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
  function setWhen(t) { var v = toLocalInput(t).split("T"); $("#whenDate").value = v[0]; $("#whenTime").value = v[1]; }
  function getWhen() {
    var d = $("#whenDate").value, h = $("#whenTime").value;
    return d && h ? fromLocalInput(d + "T" + h) : null;
  }
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
    renderTop();
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
    fitVolume();
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
  mlInput.addEventListener("input", fitVolume);
  window.addEventListener("resize", fitVolume);

  // Garante que o número inteiro caiba, qualquer que seja o zoom ou o tamanho de letra do celular:
  // começa no tamanho do CSS e diminui até não cortar nenhum dígito.
  function fitVolume() {
    var el = mlInput, box = el.parentNode;
    el.style.fontSize = "";
    el.style.width = (Math.max(1, String(el.value).length) + 0.4) + "ch"; // largura do número
    if (!el.offsetParent) return; // invisível: mede depois, ao abrir o pop-up
    var fs = parseFloat(getComputedStyle(el).fontSize);
    var guard = 40;
    while ((el.scrollWidth > el.clientWidth + 1 || box.scrollWidth > box.clientWidth + 1) && fs > 18 && guard--) {
      fs -= 2;
      el.style.fontSize = fs + "px";
    }
  }
  mlInput.addEventListener("focus", function () { mlInput.select(); });

  $("#nowBtn").addEventListener("click", function () { setWhen(Date.now()); });

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
    setWhen(Date.now());
    leak = false; setSwitch($("#leak"), false);
    look = ""; setSeg($("#look"), "");
    $("#note").value = "";
    $("#moreBox").open = false;
    $("#saveBtn").textContent = "Salvar registro";
  }

  // Inclusão e edição usam o mesmo formulário, dentro de um pop-up.
  function openSheet(e) {
    var isEdit = !!e;
    $("#editTitle").textContent = isEdit ? "Editar registro" : "Nova sondagem";
    $("#editOrig").textContent = isEdit
      ? "Original: " + e.ml + " ml às " + hhmm(e.t) + " · " + dayLabel(e.t).toLowerCase()
      : "Confira o volume e a hora e toque em Salvar.";
    $("#editSheet").classList.toggle("is-new", !isEdit);
    $("#editSheet").hidden = false;
    fitVolume();
    document.body.classList.add("modal-open");
    $("#editSheet .edit-card").scrollTop = 0;
    $("#editTitle").focus({ preventScroll: true }); // não abre o teclado sozinho
  }
  function closeSheet() {
    $("#editSheet").hidden = true;
    document.body.classList.remove("modal-open");
    resetForm();
  }
  function openNew() { resetForm(); openSheet(null); }
  $("#addBtn").addEventListener("click", openNew);
  $("#editClose").addEventListener("click", closeSheet);
  $("#editSheet").addEventListener("click", function (ev) { if (ev.target === this) closeSheet(); });

  function startEdit(id) {
    var e = entries.find(function (x) { return x.id === id; });
    if (!e) return;
    editingId = id;
    setMl(e.ml);
    setWhen(e.t);
    leak = !!e.leak; setSwitch($("#leak"), leak);
    look = e.look || ""; setSeg($("#look"), look);
    $("#note").value = e.note || "";
    $("#moreBox").open = !!(e.leak || e.look || e.note);
    $("#saveBtn").textContent = "Salvar alterações";
    openSheet(e);
  }
  $("#cancelEdit").addEventListener("click", closeSheet);

  $("#entryForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var ml = +mlInput.value;
    if (!ml || ml <= 0) { toast("Informe o volume em ml."); mlInput.focus(); return; }
    var t = getWhen() || Date.now();
    if (t > Date.now() + 5 * MIN) { toast("A data/hora está no futuro. Confira."); return; }
    var data = { t: t, ml: ml, leak: leak, look: look, note: $("#note").value.trim() };

    if (editingId) {
      var idx = entries.findIndex(function (x) { return x.id === editingId; });
      if (idx >= 0) entries[idx] = Object.assign({ id: editingId }, data);
      persistEntries();
      showSaved(data, true, null);
    } else {
      var entry = Object.assign({ id: uid() }, data);
      entries.push(entry);
      persistEntries();
      settings.lastMl = ml; persistSettings();
      showSaved(data, false, function () {
        entries = entries.filter(function (x) { return x.id !== entry.id; });
        persistEntries(); refreshAll(); toast("Registro removido.");
      });
      // registrar conta como "fiz a sondagem": limpa adiamento
      alarmState.snoozeUntil = 0; persistAlarm();
    }
    closeSheet();
    refreshAll();
  });

  // Pop-up de confirmação: mostra o que foi salvo e, ao fechar, volta a tela ao início atualizada.
  var savedUndoFn = null, savedTimer = null, savedAlarmAt = null;
  function showSaved(data, edited, undo) {
    $("#savedTitle").textContent = edited ? "Registro atualizado!" : "Registro salvo!";
    $("#savedMl").textContent = data.ml + " ml";
    var td = todayEntries();
    var total = td.reduce(function (a, e) { return a + e.ml; }, 0);
    var when = hhmm(data.t) + (dayStart(data.t) === dayStart(Date.now()) ? " de hoje" : " de " + new Date(data.t).toLocaleDateString("pt-BR"));
    $("#savedText").textContent = "Às " + when + "." + (td.length ? " Hoje: " + td.length + (td.length === 1 ? " sondagem" : " sondagens") + ", média " + fmtNum(total / td.length) + " ml." : "");
    savedUndoFn = undo;
    $("#savedUndo").hidden = !undo;
    var r = settings.rem, al = $("#savedAlarm");
    savedAlarmAt = (!edited && r.on && r.auto && r.offer) ? autoDue(Date.now()) : null;
    al.hidden = !savedAlarmAt;
    if (savedAlarmAt) al.textContent = "⏰ Criar alarme no celular para " + hhmm(savedAlarmAt) +
      (dayStart(savedAlarmAt) === dayStart(Date.now()) ? "" : " (amanhã)");
    $("#saved").hidden = false;
    $("#savedOk").focus();
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {}
    clearTimeout(savedTimer);
    savedTimer = setTimeout(closeSaved, savedAlarmAt ? 12000 : 4000);
  }
  function closeSaved() {
    clearTimeout(savedTimer);
    if ($("#saved").hidden) return;
    $("#saved").hidden = true;
    savedUndoFn = null;
    refreshAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("#savedOk").addEventListener("click", closeSaved);
  $("#savedAlarm").addEventListener("click", function () {
    var t = savedAlarmAt;
    closeSaved();
    if (t) deliverFile("alarme-sondagem-" + hhmm(t).replace(":", "h") + ".ics", "text/calendar", buildOneIcs(t),
      "Alarme para " + hhmm(t) + ". Abra o arquivo na sua agenda para confirmar.");
  });
  $("#savedUndo").addEventListener("click", function () { var f = savedUndoFn; closeSaved(); if (f) f(); });
  $("#saved").addEventListener("click", function (ev) { if (ev.target === this) closeSaved(); });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (!$("#saved").hidden) closeSaved(); else if (!$("#editSheet").hidden) closeSheet();
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
    var tm = getMissed(dayKey(Date.now()));
    $("#todaySummary").textContent = td.length
      ? "Hoje: " + plural(td.length, "sondagem", "sondagens") + (tm ? " (+" + tm + " esquecida" + (tm > 1 ? "s" : "") + ")" : "") + " · média " + fmtNum(total / td.length) + " ml"
      : (tm ? "Hoje: " + plural(tm, "sondagem esquecida", "sondagens esquecidas") : "Hoje: nenhum registro");

    renderHome(td, total);

    var pill = $("#nextPill");
    // No Início o cartão "Próxima" já mostra isso; o aviso do topo fica só nas outras abas.
    var nx = settings.rem.on && current !== "registrar" ? nextDue(Date.now()) : null;
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

  // ------------------------------------------------------------------ início
  function renderHome(td, total) {
    var now = Date.now();
    var dl = new Date(now).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    $("#homeDate").textContent = dl.charAt(0).toUpperCase() + dl.slice(1);

    var last = lastEntry();
    if (last) {
      $("#hcLast").textContent = hhmm(last.t);
      $("#lastLine").textContent = last.ml + " ml · " + (now - last.t < 2 * MIN ? "agora mesmo" : "há " + fmtDur(now - last.t)) +
        (dayStart(last.t) === dayStart(now) ? "" : " (" + dayLabel(last.t).toLowerCase() + ")");
    } else { $("#hcLast").textContent = "—"; $("#lastLine").textContent = "Nenhuma ainda"; }

    var box = $("#hcNextBox");
    var nx = settings.rem.on ? nextDue(now) : null;
    box.classList.remove("late");
    if (nx) {
      var diff = nx - now;
      $("#hcNext").textContent = hhmm(nx);
      $("#hcNextSub").textContent = diff < 0 ? "atrasada " + fmtDur(-diff) : "em " + fmtDur(diff);
      box.classList.toggle("late", diff < 0);
    } else {
      $("#hcNext").textContent = "—";
      $("#hcNextSub").textContent = settings.rem.on ? "sem horário previsto" : "lembretes desligados";
    }

    var tb = $("#hcTodayBox"); tb.classList.remove("ok", "over");
    if (td.length) {
      var avg = total / td.length;
      $("#hcAvg").textContent = fmtNum(avg) + " ml";
      var hm = getMissed(dayKey(now));
      $("#hcToday").textContent = plural(td.length, "sondagem", "sondagens") + (hm ? " + " + hm + " esquecida" + (hm > 1 ? "s" : "") : "") +
        " · " + (hm ? "~" + fmtNum(total + hm * avg) + " ml no total (estimado)" : fmtNum(total) + " ml no total");
      if (settings.targetAvg) tb.classList.add(avg < settings.targetAvg ? "ok" : "over");
    } else { $("#hcAvg").textContent = "—"; $("#hcToday").textContent = "Nenhum registro"; }

    $("#chartToday").innerHTML = chartToday(td);
    $("#todayChartCap").textContent = "hora e volume de cada sondagem" +
      (settings.targetAvg ? " · linha cinza = meta " + settings.targetAvg + " ml" : "") +
      (settings.maxMl ? " · linha laranja = máx. " + settings.maxMl + " ml" : "");

    var list = $("#todayList"); list.innerHTML = "";
    if (!td.length) {
      list.innerHTML = '<div class="empty"><p>Toque no <strong>+</strong> depois de cada sondagem.</p></div>';
    } else {
      var day = document.createElement("section"); day.className = "day";
      td.slice().reverse().forEach(function (e) { day.append(entryRow(e)); });
      list.append(day);
    }
    var mb = $("#homeMissed"); mb.innerHTML = ""; mb.append(missedControl(dayKey(now), "home"));
  }

  // Controle "Esqueci de registrar": nº aproximado de sondagens que não foram anotadas no dia.
  var missedFocus = null;
  function missedControl(k, where) {
    var n = getMissed(k);
    var box = document.createElement("div"); box.className = "missed" + (n ? " has" : "");
    var txt = document.createElement("div"); txt.className = "missed-txt";
    var t = document.createElement("strong"); t.textContent = "Esqueci de registrar";
    var h = document.createElement("span");
    h.textContent = n ? "Conta como sondagem nas estatísticas, sem mexer na média por sondagem." : "Quantas sondagens deste dia você não anotou? (aprox.)";
    txt.append(t, h);
    var st = document.createElement("div"); st.className = "missed-step";
    var lbl = k === dayKey(Date.now()) ? "hoje" : new Date(keyToTime(k)).toLocaleDateString("pt-BR");
    function btn(sym, d, label) {
      var b = document.createElement("button"); b.type = "button"; b.className = "round sm";
      b.innerHTML = '<span aria-hidden="true">' + sym + "</span>";
      b.setAttribute("aria-label", label + " (" + lbl + ")");
      b.dataset.mk = k + "|" + where + "|" + d;
      b.disabled = (d < 0 && n === 0) || (d > 0 && n >= 20);
      b.addEventListener("click", function () {
        setMissed(k, getMissed(k) + d);
        missedFocus = b.dataset.mk;
        refreshAll();
      });
      return b;
    }
    var out = document.createElement("output"); out.className = "missed-n"; out.textContent = n;
    out.setAttribute("aria-live", "polite");
    out.setAttribute("aria-label", plural(n, "sondagem esquecida", "sondagens esquecidas"));
    st.append(btn("−", -1, "Diminuir esquecidas"), out, btn("+", 1, "Aumentar esquecidas"));
    box.append(txt, st);
    return box;
  }
  function keyToTime(k) { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12).getTime(); }
  function restoreMissedFocus() {
    if (!missedFocus) return;
    var el = document.querySelector('[data-mk="' + missedFocus + '"]');
    missedFocus = null;
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }

  // Gráfico do dia: eixo X = horas (00h–24h), barra em cada sondagem com altura = volume.
  function chartToday(td) {
    var W = 520, H = 250, L = 40, R = 14, T = 46, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var now = Date.now(), from = dayStart(now), end = from + DAY;
    var maxV = Math.max.apply(null, td.map(function (e) { return e.ml; }).concat(settings.targetAvg || 0, settings.maxMl || 0, 400));
    var top = niceMax(maxV * 1.08);
    var x = function (t) { return L + ((t - from) / (end - from)) * pw; };
    var y = function (v) { return T + ph - (v / top) * ph; };
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Horário e volume de cada sondagem de hoje">';
    for (var i = 0; i <= 4; i++) {
      var v = top * i / 4, yy = y(v);
      out += '<line class="c-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>';
      out += '<text class="c-axis" x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmtNum(v) + "</text>";
    }
    for (var h = 0; h <= 24; h += 3) {
      var xh = x(from + h * HOUR);
      out += '<text class="c-axis" x="' + Math.min(Math.max(xh, L + 8), W - R - 8) + '" y="' + (H - 8) + '" text-anchor="middle">' + pad(h % 24) + "h</text>";
    }
    // agora
    var xn = x(now);
    out += '<line class="c-now" x1="' + xn + '" x2="' + xn + '" y1="' + (T - 6) + '" y2="' + (T + ph) + '"/>';
    out += '<text class="c-now-t" x="' + Math.min(xn + 4, W - R - 24) + '" y="' + (T + ph - 4) + '">agora</text>';
    if (settings.targetAvg) {
      var ty = y(settings.targetAvg);
      out += '<line class="c-target" x1="' + L + '" x2="' + (W - R) + '" y1="' + ty + '" y2="' + ty + '"/>';
    }
    if (settings.maxMl) {
      var my = y(settings.maxMl);
      out += '<line class="c-limit" x1="' + L + '" x2="' + (W - R) + '" y1="' + my + '" y2="' + my + '"/>';
    }
    var bw = 14;
    td.forEach(function (e, i) {
      var cx = x(e.t), yv = y(e.ml);
      var cls = settings.targetAvg ? (e.ml >= settings.targetAvg ? " over" : " ok") : "";
      if (settings.maxMl && e.ml > settings.maxMl) cls = " over";
      out += '<rect class="c-bar' + cls + '" x="' + (cx - bw / 2) + '" y="' + yv + '" width="' + bw + '" height="' + (T + ph - yv) + '" rx="4"><title>' +
        esc(hhmm(e.t) + " · " + e.ml + " ml") + "</title></rect>";
      // rótulo: volume em cima; hora logo abaixo do volume quando há espaço
      var lx = Math.min(Math.max(cx, L + 16), W - R - 16);
      out += '<text class="c-val halo" x="' + lx + '" y="' + (yv - 6) + '" text-anchor="middle">' + e.ml + "</text>";
      out += '<text class="c-time halo" x="' + lx + '" y="' + (yv - 20) + '" text-anchor="middle">' + hhmm(e.t) + "</text>";
    });
    if (!td.length) {
      out += '<text class="c-axis" x="' + (L + pw / 2) + '" y="' + (T + ph / 2) + '" text-anchor="middle" font-size="13">Nenhuma sondagem hoje ainda</text>';
    }
    return out + "</svg>";
  }

  // ------------------------------------------------------------------ histórico
  var historyDays = 14;
  function renderHistory() {
    var box = $("#historyList");
    box.innerHTML = "";
    if (!entries.length && !Object.keys(missed).length) {
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
    Object.keys(missed).forEach(function (k) { if (!groups[k]) { groups[k] = []; order.push(k); } });
    order.sort().reverse();
    order.slice(0, historyDays).forEach(function (k) {
      var list = groups[k];
      var total = list.reduce(function (a, e) { return a + e.ml; }, 0);
      var m = getMissed(k);
      var day = document.createElement("section");
      day.className = "day";
      var head = document.createElement("div");
      head.className = "day-head";
      var h = document.createElement("h3"); h.textContent = dayLabel(keyToTime(k));
      var s = document.createElement("span");
      s.textContent = plural(list.length, "sondagem", "sondagens") + (m ? " + " + m + " esquecida" + (m > 1 ? "s" : "") : "") + " · " + fmtNum(total) + " ml registrados";
      head.append(h, s);
      day.append(head);
      list.forEach(function (e) { day.append(entryRow(e)); });
      var foot = document.createElement("div"); foot.className = "day-missed";
      foot.append(missedControl(k, "hist"));
      day.append(foot);
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
        ? (period === 1 ? "<p>Nenhum registro hoje ainda.</p>" : "<p>Nenhum registro nos últimos " + period + " dias.</p>")
        : "<p>Os gráficos aparecem depois dos primeiros registros.</p>";
      return;
    }

    // dias com registro (para médias justas, só conta dias que têm dado)
    var byDay = {};
    for (var i = 0; i < period; i++) {
      var dk = dayKey(from + i * DAY + 2 * HOUR);
      byDay[dk] = { t: from + i * DAY, n: 0, ml: 0, miss: getMissed(dk) };
    }
    list.forEach(function (e) { var d = byDay[dayKey(e.t)]; if (d) { d.n++; d.ml += e.ml; } });
    var days = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
    var activeDays = days.filter(function (d) { return d.n > 0 || d.miss > 0; });

    var total = list.reduce(function (a, e) { return a + e.ml; }, 0);
    // Média por sondagem: só registros reais (as esquecidas não têm volume, não entram).
    var avg = total / list.length;
    var max = Math.max.apply(null, list.map(function (e) { return e.ml; }));
    // Esquecidas entram na contagem e, no total do dia, com o volume médio daquele dia.
    var missTotal = days.reduce(function (a, d) { return a + d.miss; }, 0);
    days.forEach(function (d) { d.est = d.miss ? d.miss * (d.n ? d.ml / d.n : avg) : 0; });
    var perDay = (list.length + missTotal) / activeDays.length;
    var totalPerDay = days.reduce(function (a, d) { return a + d.ml + d.est; }, 0) / activeDays.length;

    // intervalo médio entre sondagens consecutivas, ignorando lacunas > 12h (noite/esquecimento)
    // e dias com sondagens esquecidas (o intervalo ali pareceria maior do que foi).
    var gaps = [];
    for (var j = 1; j < list.length; j++) {
      var g = list[j].t - list[j - 1].t;
      if (getMissed(dayKey(list[j].t)) || getMissed(dayKey(list[j - 1].t))) continue;
      if (g > 0 && g <= 12 * HOUR) gaps.push(g);
    }
    var avgGap = gaps.length ? gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length : null;
    var over = settings.maxMl ? list.filter(function (e) { return e.ml > settings.maxMl; }).length : 0;
    var leaks = list.filter(function (e) { return e.leak; }).length;

    var target = settings.targetAvg;
    renderAvgHero(list, days, avg, target);
    $("#chartAvg").innerHTML = chartAvg(days, target);
    // No modo "Hoje", gráficos por dia teriam uma barra só: esconde.
    $("#chartAvg").closest("figure").hidden = period === 1;
    $("#chartDaily").closest("figure").hidden = period === 1;
    $("#avgCaption").textContent = target
      ? "verde = abaixo da meta · laranja = acima · tracejado = meta (" + target + " ml)"
      : "defina uma meta em Lembretes › Ajustes";

    var k = [
      { v: fmtNum(avg) + " ml", l: "média por sondagem", warn: target && avg >= target, ok: target && avg < target },
      { v: perDay.toFixed(1).replace(".", ","), l: (period === 1 ? "sondagens hoje" : "sondagens por dia") + (missTotal ? " (com " + plural(missTotal, "esquecida", "esquecidas") + ")" : "") },
      { v: avgGap ? fmtDur(avgGap) : "—", l: "intervalo médio" },
      { v: (missTotal ? "~" : "") + fmtNum(totalPerDay) + " ml", l: (period === 1 ? "total hoje" : "total médio por dia") + (missTotal ? " (estimado)" : "") },
      { v: fmtNum(max) + " ml", l: "maior volume", warn: settings.maxMl && max > settings.maxMl },
      { v: String(leaks), l: leaks === 1 ? "registro com perda" : "registros com perda", warn: leaks > 0 }
    ];
    var kb = $("#kpis"); kb.innerHTML = "";
    k.forEach(function (x) {
      var d = document.createElement("div"); d.className = "kpi" + (x.warn ? " warn" : x.ok ? " ok" : "");
      var b = document.createElement("b"); b.textContent = x.v;
      var s = document.createElement("small"); s.textContent = x.l;
      d.append(b, s); kb.append(d);
    });

    $("#chartDaily").innerHTML = chartDaily(days);
    $("#chartEach").innerHTML = chartEach(list, from, now);
    $("#chartHours").innerHTML = chartHours(list);
    // Mapas de calor: só fazem sentido com vários dias
    $("#heatFreqBox").hidden = period === 1;
    $("#heatVolBox").hidden = period === 1;
    if (period > 1) renderHeat(list, days);
    $("#limitCaption").textContent = settings.maxMl
      ? "linha tracejada = seu máximo (" + settings.maxMl + " ml)"
      : "defina um máximo em Lembretes › Ajustes para ver a linha de referência";

    var fl = $("#flags"); fl.innerHTML = "";
    var looks = list.filter(function (e) { return e.look === "turva" || e.look === "sangue"; }).length;
    if (over) addFlag(fl, over + (over === 1 ? " sondagem passou" : " sondagens passaram") + " do máximo definido.");
    if (looks) addFlag(fl, looks + (looks === 1 ? " registro" : " registros") + " com urina turva ou com sangue no período. Vale comentar com seu médico.");
  }
  function renderAvgHero(list, days, avg, target) {
    var h = $("#avgHero");
    h.innerHTML = "";
    var over = target && avg >= target;
    h.className = "hero" + (over ? " over" : "");
    var lab = document.createElement("span"); lab.className = "hero-label";
    lab.textContent = "Média por sondagem · " + (period === 1 ? "hoje" : "últimos " + period + " dias");
    var num = document.createElement("div"); num.className = "hero-num";
    var b = document.createElement("b"); b.textContent = fmtNum(avg) + " ml";
    var pill = document.createElement("span"); pill.className = "hero-pill";
    if (!target) pill.textContent = "sem meta definida";
    else if (over) pill.textContent = "Acima da meta em " + fmtNum(avg - target) + " ml";
    else pill.textContent = "Dentro da meta (abaixo de " + target + " ml)";
    num.append(b, pill);
    h.append(lab, num);
    var sub = document.createElement("div"); sub.className = "hero-sub";
    var td = todayEntries();
    if (td.length && period > 1) {
      var ta = td.reduce(function (a, e) { return a + e.ml; }, 0) / td.length;
      sub.append(span("Hoje: " + fmtNum(ta) + " ml"));
    }
    if (target) {
      var act = days.filter(function (d) { return d.n; });
      var bad = act.filter(function (d) { return d.ml / d.n >= target; }).length;
      var above = list.filter(function (e) { return e.ml >= target; }).length;
      if (period > 1) sub.append(span("Dias acima da meta: " + bad + " de " + act.length));
      sub.append(span("Sondagens com " + target + " ml ou mais: " + above + " de " + list.length));
    }
    var mt = days.reduce(function (a, d) { return a + d.miss; }, 0);
    if (mt) sub.append(span("Esquecidas informadas: " + mt + " (não entram nesta média)"));
    if (sub.childNodes.length) h.append(sub);
  }
  function span(t) { var s = document.createElement("span"); s.textContent = t; return s; }

  function chartAvg(days, target) {
    var W = 520, H = 200, L = 44, R = 54, T = 18, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var avgs = days.map(function (d) { return d.n ? d.ml / d.n : 0; });
    var top = niceMax(Math.max.apply(null, avgs.concat(target || 0)) * 1.1);
    var y = function (v) { return T + ph - (v / top) * ph; };
    var bw = pw / days.length;
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Média por sondagem em cada dia">';
    for (var i = 0; i <= 4; i++) {
      var v = top * i / 4, yy = y(v);
      out += '<line class="c-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>';
      out += '<text class="c-axis" x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmtNum(v) + "</text>";
    }
    var every = days.length > 14 ? 5 : days.length > 7 ? 2 : 1;
    days.forEach(function (d, i) {
      var a = avgs[i], cx = L + i * bw + bw / 2, w = Math.max(2, bw * 0.62);
      if (a > 0) {
        var cls = target ? (a >= target ? " over" : " ok") : "";
        out += '<rect class="c-bar' + cls + '" x="' + (cx - w / 2) + '" y="' + y(a) + '" width="' + w + '" height="' + (T + ph - y(a)) + '" rx="3"><title>' +
          esc(new Date(d.t).toLocaleDateString("pt-BR") + ": média " + fmtNum(a) + " ml (" + d.n + " sondagens)") + "</title></rect>";
        if (bw > 26) out += '<text class="c-val" x="' + cx + '" y="' + (y(a) - 5) + '" text-anchor="middle">' + fmtNum(a) + "</text>";
      }
      if ((days.length - 1 - i) % every === 0) {
        var dt = new Date(d.t);
        out += '<text class="c-axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + pad(dt.getDate()) + "/" + pad(dt.getMonth() + 1) + "</text>";
      }
    });
    if (target) {
      var ty = y(target);
      out += '<line class="c-target" x1="' + L + '" x2="' + (W - R) + '" y1="' + ty + '" y2="' + ty + '"/>';
      out += '<text class="c-target-t" x="' + (W - R + 6) + '" y="' + (ty - 2) + '">meta</text>';
      out += '<text class="c-target-t" x="' + (W - R + 6) + '" y="' + (ty + 11) + '">' + target + "</text>";
    }
    return out + "</svg>";
  }

  // ---------------- mapas de calor (dia × hora)
  function heatGrid(list, days) {
    var rows = days.map(function (d) { return { t: d.t, cells: [] }; });
    rows.forEach(function (r) { for (var h = 0; h < 24; h++) r.cells.push({ n: 0, ml: 0 }); });
    var idx = {}; days.forEach(function (d, i) { idx[dayKey(d.t)] = i; });
    var all = []; for (var h = 0; h < 24; h++) all.push({ n: 0, ml: 0 });
    list.forEach(function (e) {
      var i = idx[dayKey(e.t)], h = new Date(e.t).getHours();
      if (i === undefined) return;
      rows[i].cells[h].n++; rows[i].cells[h].ml += e.ml;
      all[h].n++; all[h].ml += e.ml;
    });
    return { rows: rows, all: all };
  }
  function heatSvg(g, kind, target) {
    var nR = g.rows.length;
    var L = 46, R = 6, T = 18, W = 520;
    var cw = (W - L - R) / 24, ch = nR > 14 ? 13 : 18, gapSum = 10, legendH = 34;
    var H = T + nR * ch + gapSum + ch + 18 + legendH;
    var maxN = 1; g.rows.forEach(function (r) { r.cells.forEach(function (c) { if (c.n > maxN) maxN = c.n; }); });
    var maxAll = Math.max(1, Math.max.apply(null, g.all.map(function (c) { return c.n; })));
    function fillFor(c, isAll) {
      if (!c.n) return null;
      if (kind === "freq") {
        var m = isAll ? maxAll : maxN;
        return { cls: "h-seq", op: (0.18 + 0.82 * c.n / m).toFixed(2) };
      }
      var avg = c.ml / c.n;
      if (!target) return { cls: "h-seq", op: "0.6" };
      var d = Math.min(1, Math.abs(avg - target) / (target * 0.4)); // 40% da meta = cor cheia
      return { cls: avg >= target ? "h-hot" : "h-cool", op: (0.12 + 0.88 * d).toFixed(2) };
    }
    function tip(c, label, h) {
      var hh = pad(h) + "h–" + pad((h + 1) % 24) + "h";
      if (!c.n) return label + ", " + hh + ": nenhuma sondagem";
      return label + ", " + hh + ": " + plural(c.n, "sondagem", "sondagens") + " · média " + fmtNum(c.ml / c.n) + " ml";
    }
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' +
      (kind === "freq" ? "Mapa de calor da quantidade de sondagens por dia e hora" : "Mapa de calor do volume médio por dia e hora") + '">';
    for (var h = 0; h < 24; h += 3) out += '<text class="c-axis" x="' + (L + h * cw + cw / 2) + '" y="' + (T - 6) + '" text-anchor="middle">' + pad(h) + "h</text>";
    function row(cells, y, label, isAll) {
      var s = '<text class="c-axis' + (isAll ? " strong" : "") + '" x="' + (L - 6) + '" y="' + (y + ch / 2 + 4) + '" text-anchor="end">' + label + "</text>";
      cells.forEach(function (c, h) {
        var f = fillFor(c, isAll), x = L + h * cw + 1, w = cw - 2, hh = ch - 2;
        s += '<rect class="h-cell ' + (f ? f.cls : "h-empty") + '" x="' + x.toFixed(1) + '" y="' + (y + 1) + '" width="' + w.toFixed(1) + '" height="' + hh + '" rx="2"' +
          (f ? ' fill-opacity="' + f.op + '"' : "") + "><title>" + esc(tip(c, isAll ? "Período todo" : label, h)) + "</title></rect>";
      });
      return s;
    }
    g.rows.forEach(function (r, i) {
      var dt = new Date(r.t);
      out += row(r.cells, T + i * ch, pad(dt.getDate()) + "/" + pad(dt.getMonth() + 1), false);
    });
    var yAll = T + nR * ch + gapSum;
    out += row(g.all, yAll, kind === "freq" ? "Total" : "Média", true);
    // legenda
    var ly = yAll + ch + 22;
    if (kind === "freq") {
      out += '<text class="c-axis" x="' + L + '" y="' + (ly + 10) + '">menos</text>';
      [0.18, 0.4, 0.6, 0.8, 1].forEach(function (o, i) { out += '<rect class="h-seq" x="' + (L + 40 + i * 22) + '" y="' + ly + '" width="18" height="13" rx="2" fill-opacity="' + o + '"/>'; });
      out += '<text class="c-axis" x="' + (L + 40 + 5 * 22 + 4) + '" y="' + (ly + 10) + '">mais sondagens</text>';
    } else if (target) {
      var x0 = L;
      out += '<text class="c-axis" x="' + x0 + '" y="' + (ly + 10) + '">abaixo</text>';
      [1, 0.6, 0.2].forEach(function (o, i) { out += '<rect class="h-cool" x="' + (x0 + 44 + i * 22) + '" y="' + ly + '" width="18" height="13" rx="2" fill-opacity="' + o + '"/>'; });
      out += '<text class="c-axis" x="' + (x0 + 44 + 3 * 22 + 4) + '" y="' + (ly + 10) + '">meta ' + target + "</text>";
      [0.2, 0.6, 1].forEach(function (o, i) { out += '<rect class="h-hot" x="' + (x0 + 180 + i * 22) + '" y="' + ly + '" width="18" height="13" rx="2" fill-opacity="' + o + '"/>'; });
      out += '<text class="c-axis" x="' + (x0 + 180 + 3 * 22 + 4) + '" y="' + (ly + 10) + '">acima</text>';
    }
    return out + "</svg>";
  }
  function renderHeat(list, days) {
    var g = heatGrid(list, days), target = settings.targetAvg;
    $("#heatFreq").innerHTML = heatSvg(g, "freq", target);
    $("#heatVol").innerHTML = heatSvg(g, "vol", target);
    $("#heatVolCap").textContent = target
      ? "azul = abaixo da meta de " + target + " ml · laranja = acima · quanto mais forte, mais longe da meta"
      : "defina uma meta em Lembretes › Ajustes para colorir por meta";
    // leituras automáticas (só com dados de verdade; horas com pelo menos 2 sondagens)
    var hrs = g.all.map(function (c, h) { return { h: h, n: c.n, avg: c.n ? c.ml / c.n : 0 }; }).filter(function (x) { return x.n >= 2; });
    var top = hrs.slice().sort(function (a, b) { return b.n - a.n; }).slice(0, 3).sort(function (a, b) { return a.h - b.h; });
    $("#heatFreqNote").textContent = top.length
      ? "Horários em que você mais faz: " + top.map(function (x) { return pad(x.h) + "h (" + x.n + "×)"; }).join(", ") + "."
      : "Ainda há poucos registros para ver um padrão.";
    var hot = target ? hrs.filter(function (x) { return x.avg >= target; }).sort(function (a, b) { return b.avg - a.avg; }).slice(0, 4) : [];
    var vn = $("#heatVolNote");
    vn.classList.toggle("warn", hot.length > 0);
    vn.textContent = !target ? "" : hot.length
      ? "Mais atenção: nestes horários o volume médio passa da meta, então vale encurtar o intervalo antes deles: " +
        hot.map(function (x) { return pad(x.h) + "h (" + fmtNum(x.avg) + " ml)"; }).join(", ") + "."
      : (hrs.length ? "Nenhum horário com média acima da meta no período." : "Ainda há poucos registros para ver um padrão.");
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
    var top = niceMax(Math.max.apply(null, days.map(function (d) { return d.ml + (d.est || 0); })));
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
      var tot = d.ml + (d.est || 0);
      if (d.est) {
        out += '<rect class="c-bar est" x="' + (cx - w / 2) + '" y="' + y(tot) + '" width="' + w + '" height="' + (y(d.ml) - y(tot)) + '" rx="3"><title>' +
          esc(new Date(d.t).toLocaleDateString("pt-BR") + ": ~" + fmtNum(d.est) + " ml estimados de " + d.miss + " esquecida(s)") + "</title></rect>";
      }
      if (d.ml > 0) {
        out += '<rect class="c-bar' + (d.t === today ? " today" : "") + '" x="' + (cx - w / 2) + '" y="' + y(d.ml) + '" width="' + w + '" height="' + (T + ph - y(d.ml)) + '" rx="3"><title>' +
          esc(new Date(d.t).toLocaleDateString("pt-BR") + ": " + fmtNum(d.ml) + " ml em " + d.n + " sondagens") + "</title></rect>";
      }
      if (tot > 0 && bw > 14) out += '<text class="c-val" x="' + cx + '" y="' + (y(tot) - 5) + '" text-anchor="middle">' + d.n + (d.miss ? "+" + d.miss : "") + "</text>";
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
    if (nDays === 1) {
      // Hoje: eixo por hora do dia
      for (var hh = 0; hh <= 24; hh += 3) {
        var th = from + hh * HOUR, xx = Math.min(Math.max(x(th), L + 10), W - R - 10);
        out += '<line class="c-grid" x1="' + x(th) + '" x2="' + x(th) + '" y1="' + T + '" y2="' + (T + ph) + '" opacity=".5"/>';
        out += '<text class="c-axis" x="' + xx + '" y="' + (H - 8) + '" text-anchor="middle">' + pad(hh % 24) + "h</text>";
      }
      nDays = 0;
    }
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
  // Lembrete automático: X horas depois da última sondagem, respeitando a faixa de horário.
  function autoDue(now) {
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
    var every = (+r.every || 4) * HOUR;
    var base = last ? last.t + every : null;
    if (base === null) return inWindow(now) ? null : nextWindowStart(now);
    // depois de muito tempo sem registro, não acumula atraso infinito
    if (now - base > 12 * HOUR) base = inWindow(now) ? now : nextWindowStart(now);
    if (!inWindow(base)) base = nextWindowStart(base);
    return base;
  }
  // Horários fixos: o horário mais recente ainda não cumprido, senão o próximo.
  function fixedDue(now) {
    var times = (settings.rem.times || []).map(timeToMin).sort(function (a, b) { return a - b; });
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
  // Próxima sondagem prevista, juntando os dois tipos (pode estar no passado = atrasada).
  function nextDue(now) {
    var r = settings.rem, c = [];
    if (r.auto) { var a = autoDue(now); if (a) c.push(a); }
    if (r.fixed) { var f = fixedDue(now); if (f) c.push(f); }
    return c.length ? Math.min.apply(null, c) : null;
  }

  function renderReminders() {
    var r = settings.rem;
    setSwitch($("#remOn"), r.on);
    $("#remBody").classList.toggle("off", !r.on);
    setSwitch($("#remAuto"), r.auto); $("#autoBody").hidden = !r.auto;
    setSwitch($("#remFixed"), r.fixed); $("#fixedBody").hidden = !r.fixed;
    setSwitch($("#remOffer"), r.offer);
    $("#everyOut").textContent = fmtEvery(r.every);
    var last = lastEntry();
    $("#autoPreview").textContent = last
      ? "Última às " + hhmm(last.t) + " → próximo lembrete automático às " + hhmm(autoDue(Date.now())) + "."
      : "Assim que você registrar uma sondagem, o próximo lembrete é marcado.";
    $("#winStart").value = r.start; $("#winEnd").value = r.end;
    var ul = $("#timesList"); ul.innerHTML = "";
    r.times.slice().sort().forEach(function (t) {
      var li = document.createElement("li"); li.textContent = t;
      var b = document.createElement("button"); b.type = "button"; b.textContent = "×"; b.setAttribute("aria-label", "Remover " + t);
      b.addEventListener("click", function () { r.times = r.times.filter(function (x) { return x !== t; }); persistSettings(); renderReminders(); renderTop(); });
      li.append(b); ul.append(li);
    });
    $("#maxMl").value = settings.maxMl || "";
    $("#targetAvg").value = settings.targetAvg || "";
    setSwitch($("#bigText"), settings.bigText);
    updateNotifBtn();
  }

  $("#remOn").addEventListener("click", function () {
    settings.rem.on = !settings.rem.on; persistSettings(); renderReminders(); renderTop();
    if (settings.rem.on) { unlockAudio(); toast("Lembretes ligados."); }
  });
  function fmtEvery(v) { var h = Math.floor(v), m = Math.round((v - h) * 60); return h + " h" + (m ? " " + pad(m) : ""); }
  function toggleRem(key, msgOn) {
    settings.rem[key] = !settings.rem[key];
    persistSettings(); renderReminders(); renderTop();
    if (settings.rem[key] && msgOn) toast(msgOn);
  }
  $("#remAuto").addEventListener("click", function () { toggleRem("auto", "Lembrete automático ligado."); });
  $("#remFixed").addEventListener("click", function () { toggleRem("fixed", "Horários fixos ligados."); });
  $("#remOffer").addEventListener("click", function () { settings.rem.offer = !settings.rem.offer; persistSettings(); renderReminders(); });
  function stepEvery(d) {
    var v = Math.max(0.5, Math.min(12, (+settings.rem.every || 4) + d));
    settings.rem.every = v; persistSettings(); renderReminders(); renderTop();
  }
  $("#everyMinus").addEventListener("click", function () { stepEvery(-0.25); });
  $("#everyPlus").addEventListener("click", function () { stepEvery(0.25); });
  $("#winStart").addEventListener("change", function () { settings.rem.start = this.value || "07:00"; persistSettings(); renderReminders(); renderTop(); });
  $("#winEnd").addEventListener("change", function () { settings.rem.end = this.value || "23:00"; persistSettings(); renderReminders(); renderTop(); });
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
  $("#targetAvg").addEventListener("change", function () {
    var v = +this.value; settings.targetAvg = v > 0 ? v : null; persistSettings();
    toast(settings.targetAvg ? "Meta salva: média abaixo de " + settings.targetAvg + " ml." : "Meta removida.");
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
    closeAlarm(); show("registrar"); openNew();
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
  function icsTimes() { return settings.rem.times.slice().sort(); }
  function icsStamp(d) { return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "00Z"; }
  // Um alarme só, para um horário específico (o próximo do modo automático).
  function buildOneIcs(t) {
    var start = new Date(t), end = new Date(t + 10 * MIN);
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MaxMix//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT", "UID:sondagem-" + t + "@maxmix", "DTSTAMP:" + icsStamp(new Date()),
      "DTSTART:" + icsStamp(start), "DTEND:" + icsStamp(end),
      "SUMMARY:Sondagem", "DESCRIPTION:Hora da sondagem. Depois registre o volume no MaxMix.", "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Hora da sondagem", "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n") + "\r\n";
  }
  function buildIcs(times) {
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + "T" + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + "00Z";
    var date = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MaxMix//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    times.forEach(function (t, i) {
      var hm = t.replace(":", "");
      var endMin = timeToMin(t) + 10;
      var endHm = pad(Math.floor(endMin / 60) % 24) + pad(endMin % 60);
      lines.push("BEGIN:VEVENT", "UID:sondagem-" + hm + "-" + i + "-" + date + "@diario-miccional",
        "DTSTAMP:" + stamp, "DTSTART:" + date + "T" + hm + "00", "DTEND:" + date + "T" + (endMin >= 1440 ? "2359" : endHm) + "00",
        "RRULE:FREQ=DAILY", "SUMMARY:Sondagem", "DESCRIPTION:Hora da sondagem. Depois registre o volume no MaxMix.",
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
    var items = entries.map(function (e) { return { t: e.t, e: e }; });
    Object.keys(missed).forEach(function (k) { items.push({ t: keyToTime(k) + 11.9 * HOUR, m: getMissed(k) }); });
    items.sort(function (a, b) { return a.t - b.t; });
    items.forEach(function (it) {
      var d = new Date(it.t), ds = pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
      if (it.m) { rows.push([ds, "", "", "", "", plural(it.m, "sondagem não registrada", "sondagens não registradas") + " (informado no app)"]); return; }
      var e = it.e;
      rows.push([ds, hhmm(e.t), e.ml, e.leak ? "sim" : "nao", LOOK[e.look] || "", e.note || ""]);
    });
    var csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(";"); }).join("\r\n");
    deliverFile("maxmix-" + dayKey(Date.now()) + ".csv", "text/csv", csv, "Planilha gerada com " + entries.length + " registros.");
  });

  $("#backupBtn").addEventListener("click", function () {
    var data = JSON.stringify({ app: "maxmix", version: 1, exportedAt: new Date().toISOString(), entries: entries, settings: settings, missed: missed }, null, 1);
    deliverFile("backup-maxmix-" + dayKey(Date.now()) + ".json", "application/json", data, "Backup gerado.");
  });

  $("#restoreInput").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || (data.app !== "maxmix" && data.app !== "diario-miccional") || !Array.isArray(data.entries)) throw new Error("formato");
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
        if (data.missed && typeof data.missed === "object") {
          Object.keys(data.missed).forEach(function (k) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(k)) setMissed(k, Math.max(getMissed(k), +data.missed[k] || 0));
          });
        }
        persistEntries(); refreshAll(); renderReminders();
        toast(added ? added + " registros restaurados." : "Nada novo: esses registros já estavam aqui.");
      } catch (e) { toast("Esse arquivo não é um backup do MaxMix."); }
    };
    reader.readAsText(f);
  });

  // ------------------------------------------------------------------ gráfico em tela cheia
  var viewerFig = null;
  function setupChartFigures() {
    $all("figure.chart").forEach(function (fig) {
      if (fig.dataset.zoom) return;
      fig.dataset.zoom = "1";
      fig.classList.add("zoomable");
      fig.setAttribute("tabindex", "0");
      fig.setAttribute("role", "button");
      var cap = fig.querySelector("figcaption strong");
      fig.setAttribute("aria-label", "Ampliar gráfico: " + (cap ? cap.textContent : ""));
      var hint = document.createElement("span"); hint.className = "zoom-hint"; hint.setAttribute("aria-hidden", "true");
      hint.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>Ampliar';
      fig.querySelector("figcaption").append(hint);
      fig.addEventListener("click", function () { openViewer(fig); });
      fig.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openViewer(fig); } });
    });
  }
  function openViewer(fig) {
    var svg = fig.querySelector(".chart-box svg");
    if (!svg) return;
    viewerFig = fig;
    var cap = fig.querySelector("figcaption strong");
    $("#viewerTitle").textContent = cap ? cap.textContent : "Gráfico";
    var body = $("#viewerBody"); body.innerHTML = "";
    var clone = svg.cloneNode(true);
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    clone.removeAttribute("width"); clone.removeAttribute("height");
    body.append(clone);
    $("#viewerTip").textContent = "Toque num ponto, barra ou quadradinho para ver os detalhes.";
    var v = $("#viewer");
    v.hidden = false;
    document.body.classList.add("modal-open");
    $("#viewerClose").focus({ preventScroll: true });
    // tenta tela cheia + paisagem; se o celular não deixar, gira a tela por CSS
    var done = function () { fitViewer(); };
    try {
      // tela cheia na página inteira (o navegador não deixa girar o próprio elemento em tela cheia)
      var de = document.documentElement;
      var req = de.requestFullscreen || de.webkitRequestFullscreen;
      var p = req ? req.call(de) : null;
      if (p && p.then) {
        p.then(function () {
          if (screen.orientation && screen.orientation.lock) return screen.orientation.lock("landscape").catch(function () {});
        }).then(done, done);
      } else done();
    } catch (e) { done(); }
  }
  function fitViewer() {
    var v = $("#viewer");
    if (v.hidden) return;
    var portrait = window.innerHeight > window.innerWidth;
    v.classList.toggle("rotated", portrait);
  }
  function closeViewer() {
    var v = $("#viewer");
    if (v.hidden) return;
    v.hidden = true; v.classList.remove("rotated");
    document.body.classList.remove("modal-open");
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); } catch (e) {}
    if (viewerFig) viewerFig.focus({ preventScroll: true });
    viewerFig = null;
  }
  $("#viewerClose").addEventListener("click", function (ev) { ev.stopPropagation(); closeViewer(); });
  window.addEventListener("resize", fitViewer);
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement) fitViewer(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeViewer(); });
  // toque: pega a marca (barra, ponto, quadradinho) mais perto do dedo
  $("#viewerBody").addEventListener("click", function (ev) {
    var svg = this.querySelector("svg"); if (!svg) return;
    var best = null, bestD = 1e9;
    Array.prototype.forEach.call(svg.querySelectorAll("rect, circle"), function (el) {
      var t = el.querySelector("title"); if (!t) return;
      var r = el.getBoundingClientRect();
      var dx = Math.max(r.left - ev.clientX, 0, ev.clientX - r.right);
      var dy = Math.max(r.top - ev.clientY, 0, ev.clientY - r.bottom);
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = el; }
    });
    Array.prototype.forEach.call(svg.querySelectorAll(".sel"), function (el) { el.classList.remove("sel"); });
    if (best && bestD <= 28) {
      best.classList.add("sel");
      $("#viewerTip").textContent = best.querySelector("title").textContent;
    } else {
      $("#viewerTip").textContent = "Toque num ponto, barra ou quadradinho para ver os detalhes.";
    }
  });

  // ------------------------------------------------------------------ boot
  function refreshAll() {
    renderTop();
    if (current === "historico") renderHistory();
    if (current === "graficos") renderStats();
    restoreMissedFocus();
  }

  sortEntries();
  applyBig();
  setupChartFigures();
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
