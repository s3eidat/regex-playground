/* Regex Playground — the regex itself runs in worker.js so a catastrophic pattern can be killed. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var TIMEOUT = 1500;

  // ---------- worker runner with a hard timeout ----------
  var worker = null, pending = null, seq = 0;
  function runRegex(job, timeoutMs) {
    if (pending) { clearTimeout(pending.timer); pending.resolve({ superseded: true }); if (worker) { worker.terminate(); worker = null; } }
    if (!worker) worker = new Worker("worker.js");
    return new Promise(function (resolve) {
      var id = ++seq, w = worker;
      pending = { resolve: resolve, timer: setTimeout(function () {
        w.terminate(); if (worker === w) worker = null; pending = null; resolve({ timeout: true });
      }, timeoutMs || TIMEOUT) };
      w.onmessage = function (e) {
        if (e.data.id !== id) return;
        clearTimeout(pending.timer); pending = null; resolve(e.data);
      };
      w.onerror = function (e) { e.preventDefault(); clearTimeout(pending && pending.timer); pending = null; resolve({ error: e.message || "Worker error" }); };
      w.postMessage({ id: id, source: job.source, flags: job.flags, text: job.text, replace: job.replace });
    });
  }

  // ---------- data ----------
  var PRESETS = [
    ["Email address", "[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+", "gi"],
    ["URL (http/https)", "https?:\\/\\/[^\\s/$.?#][^\\s]*", "gi"],
    ["IPv4 address", "\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b", "g"],
    ["Date YYYY-MM-DD", "(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])", "g"],
    ["Hex colour", "#(?:[0-9a-fA-F]{3}){1,2}\\b", "g"],
    ["Number (int or decimal)", "-?\\d+(?:\\.\\d+)?", "g"],
    ["Duplicate word", "\\b(\\w+)\\s+\\1\\b", "gi"],
    ["Arabic word", "\\p{Script=Arabic}+", "gu"],
    ["Trailing whitespace", "[ \\t]+$", "gm"],
    ["Strong password (8+, upper, lower, digit)", "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$", "gm"]
  ];
  var CHEAT = [
    ["Characters", [[".", "any character except newline"], ["\\d", "digit 0–9"], ["\\D", "not a digit"], ["\\w", "word char [A-Za-z0-9_]"], ["\\W", "not a word char"], ["\\s", "whitespace"], ["\\S", "not whitespace"], ["\\p{L}", "any letter (u flag)"], ["\\t", "tab"], ["\\n", "newline"]]],
    ["Sets & anchors", [["[abc]", "a, b or c"], ["[^abc]", "not a, b or c"], ["[a-z]", "range a to z"], ["^", "start (of line with m)"], ["$", "end (of line with m)"], ["\\b", "word boundary"], ["\\B", "not a word boundary"]]],
    ["Quantifiers", [["*", "0 or more"], ["+", "1 or more"], ["?", "0 or 1"], ["{3}", "exactly 3"], ["{2,5}", "2 to 5"], ["{2,}", "2 or more"], ["+?", "lazy: as few as possible"]]],
    ["Groups & lookaround", [["(abc)", "capture group"], ["(?<name>abc)", "named group"], ["(?:abc)", "group, no capture"], ["a|b", "a or b"], ["\\1", "back-reference to group 1"], ["(?=abc)", "followed by"], ["(?!abc)", "not followed by"], ["(?<=abc)", "preceded by"], ["(?<!abc)", "not preceded by"]]],
    ["Replacement", [["$1", "group 1"], ["$<name>", "named group"], ["$&", "the whole match"], ["$`", "text before the match"], ["$'", "text after the match"], ["$$", "a literal $"]]]
  ];

  // Name (or null) of each capture group in order, so $1, $2… can be labelled <name>.
  function captureNames(src) {
    var names = [], inClass = false;
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      if (c === "\\") { i++; continue; }
      if (inClass) { if (c === "]") inClass = false; continue; }
      if (c === "[") { inClass = true; continue; }
      if (c !== "(") continue;
      if (src[i + 1] !== "?") { names.push(null); continue; }
      var m = /^\?<([A-Za-z_$][\w$]*)>/.exec(src.slice(i + 1));
      if (m) names.push(m[1]);
    }
    return names;
  }

  // ---------- UI ----------
  var pat = $("#pattern"), text = $("#text"), rep = $("#replace");
  var saved = S3.store("rx.state") || {};
  var flags = saved.flags != null ? saved.flags : "g";
  pat.value = saved.pattern || ""; rep.value = saved.replace || "";
  var last = null;

  function syncFlags() {
    $$("#flags button").forEach(function (b) { b.setAttribute("aria-pressed", String(flags.indexOf(b.dataset.f) >= 0)); });
    $("#flagText").textContent = flags;
  }
  function status(cls, msg) { var s = $("#status"); s.className = "chip " + cls; s.textContent = msg; }
  function remember() { S3.store("rx.state", { pattern: pat.value, flags: flags, replace: rep.value }); }

  function update() {
    remember();
    var t = text.value;
    $("#textInfo").textContent = t.length.toLocaleString() + " characters";
    if (!pat.value) { last = null; status("", "Type a pattern"); drawHL(t, []); drawMatches(null); $("#replaced").textContent = t; return; }
    runRegex({ source: pat.value, flags: flags, text: t, replace: rep.value }).then(function (r) {
      if (r.superseded) return;
      if (r.timeout) { last = null; status("bad", "Stopped after " + TIMEOUT / 1000 + "s — likely catastrophic backtracking"); drawMatches(null); return; }
      if (r.error) { last = null; status("bad", r.error.replace(/^Invalid regular expression: /, "")); drawMatches(null); return; }
      last = r;
      var n = r.matches.length;
      status(n ? "ok" : "warn", n ? (r.more ? n + "+" : n) + " match" + (n === 1 ? "" : "es") : "No match");
      drawHL(t, r.matches); drawMatches(r);
      $("#replaced").textContent = r.replaced != null ? r.replaced : t;
    });
  }
  var updateSoon = S3.debounce(update, 120);

  function drawHL(t, matches) {
    var hl = $("#hl"); hl.textContent = "";
    if (!t) { hl.appendChild(S3.h("span", { "class": "faint", text: "Your test text appears here with matches highlighted." })); return; }
    var pos = 0, frag = document.createDocumentFragment();
    matches.slice(0, 2000).forEach(function (m, i) {
      if (m.index < pos) return;
      if (m.index > pos) frag.appendChild(document.createTextNode(t.slice(pos, m.index)));
      frag.appendChild(S3.h("mark", { "class": (i % 2 ? "b" : "a") + (m.text ? "" : " empty"), title: "Match " + (i + 1), text: m.text }));
      pos = m.index + m.text.length;
    });
    if (pos < t.length) frag.appendChild(document.createTextNode(t.slice(pos)));
    hl.appendChild(frag);
  }

  function drawMatches(r) {
    var box = $("#matches"); box.textContent = "";
    $("#count").textContent = r && r.matches.length ? "(" + r.matches.length + (r.more ? "+" : "") + ")" : "";
    if (!r || !r.matches.length) {
      box.appendChild(S3.h("div", { "class": "empty" }, [S3.h("b", { text: r ? "No matches" : "Nothing to show yet" }), r ? "Try another pattern or flag." : "Enter a pattern and some text."]));
      return;
    }
    var names = captureNames(pat.value);
    r.matches.slice(0, 300).forEach(function (m, i) {
      var groups = m.groups.map(function (g, gi) {
        var name = names[gi];
        return S3.h("div", { "class": "rx-g" }, [S3.h("span", { "class": "faint", text: (name ? "<" + name + ">" : "$" + (gi + 1)) + " " }), g == null ? S3.h("i", { "class": "faint", text: "undefined" }) : S3.h("code", { text: g })]);
      });
      box.appendChild(S3.h("div", { "class": "rx-m" }, [
        S3.h("div", { "class": "row between" }, [S3.h("b", { text: "#" + (i + 1) }), S3.h("span", { "class": "faint", text: "index " + m.index + " · length " + m.text.length })]),
        S3.h("code", { "class": "rx-mt", text: m.text || "(empty match)" })
      ].concat(groups)));
    });
    if (r.matches.length > 300) box.appendChild(S3.h("p", { "class": "faint", text: "Showing the first 300 matches. Copy gets them all." }));
  }

  $$("#flags button").forEach(function (b) {
    b.addEventListener("click", function () {
      var f = b.dataset.f;
      flags = flags.indexOf(f) >= 0 ? flags.replace(f, "") : "gimsuy".split("").filter(function (x) { return flags.indexOf(x) >= 0 || x === f; }).join("");
      syncFlags(); update();
    });
  });
  [pat, text, rep].forEach(function (el) { el.addEventListener("input", updateSoon); });

  PRESETS.forEach(function (p, i) { $("#preset").appendChild(S3.h("option", { value: String(i), text: p[0] })); });
  $("#preset").addEventListener("change", function () {
    var p = PRESETS[+this.value]; if (!p) return;
    pat.value = p[1]; flags = p[2]; syncFlags(); update(); this.value = "";
  });
  $("#clear").addEventListener("click", function () { pat.value = ""; rep.value = ""; text.value = ""; update(); pat.focus(); });
  $("#copyMatches").addEventListener("click", function () {
    if (!last || !last.matches.length) { S3.toast("No matches to copy", "error"); return; }
    S3.copy(last.matches.map(function (m) { return m.text; }).join("\n"), last.matches.length + " matches copied"); S3.done();
  });
  $("#copyRep").addEventListener("click", function () { S3.copy($("#replaced").textContent, "Result copied"); S3.done(); });

  var grid = $("#cheatGrid");
  CHEAT.forEach(function (sec) {
    grid.appendChild(S3.h("div", { "class": "rx-cs" }, [S3.h("h3", { text: sec[0] })].concat(sec[1].map(function (c) {
      return S3.h("button", { "class": "rx-tok", type: "button", title: "Insert " + c[0], onclick: function () {
        var target = sec[0] === "Replacement" ? rep : pat, s = target.selectionStart != null ? target.selectionStart : target.value.length;
        target.value = target.value.slice(0, s) + c[0] + target.value.slice(target.selectionEnd || s);
        target.focus(); target.setSelectionRange(s + c[0].length, s + c[0].length); update();
      } }, [S3.h("code", { text: c[0] }), S3.h("span", { text: c[1] })]);
    }))));
  });
  if (S3.store("rx.cheat")) $("#cheat").open = true;
  $("#cheat").addEventListener("toggle", function () { S3.store("rx.cheat", this.open || undefined); });

  syncFlags(); update();

  window.S3_DEMO = function () {
    pat.value = "(?<user>[\\w.+-]+)@(?<domain>[\\w-]+(?:\\.[\\w-]+)+)";
    flags = "gi"; syncFlags();
    text.value = "Contact ada@example.org for the beta.\nSales: sales.team@s3eidat.dev, support+jo@mail.example.jo\nNot an email: user@ or @domain.com";
    rep.value = "$<user> [at] $<domain>";
    update();
    return new Promise(function (r) { setTimeout(r, 300); });
  };

  window.S3_SELFTEST = async function () {
    var r = await runRegex({ source: "(\\d+)-(?<w>[a-z]+)", flags: "g", text: "1-ab 22-cd x", replace: "$<w>:$1" });
    if (r.matches.length !== 2 || r.matches[1].index !== 5 || r.matches[1].groups[0] !== "22" || r.matches[1].named.w !== "cd") return "groups";
    if (r.replaced !== "ab:1 cd:22 x") return "replace";
    r = await runRegex({ source: "a", flags: "", text: "aaa", replace: "b" });
    if (r.matches.length !== 1 || r.replaced !== "baa") return "non-global";
    r = await runRegex({ source: "", flags: "g", text: "ab" });
    if (r.matches.length !== 3) return "empty matches";
    r = await runRegex({ source: "\\p{L}+", flags: "gu", text: "مرحبا hi" });
    if (r.matches.length !== 2 || r.matches[0].text !== "مرحبا") return "unicode";
    r = await runRegex({ source: "(", flags: "g", text: "x" });
    if (!r.error) return "syntax error";
    r = await runRegex({ source: "^(a+)+$", flags: "", text: "a".repeat(40) + "!" }, 300);
    if (!r.timeout) return "catastrophic guard";
    r = await runRegex({ source: "b", flags: "g", text: "abc" }); // worker recreated after the kill
    if (r.matches.length !== 1) return "worker restart";
    var cn = captureNames("(a)(?:b)(?<x>c)[(](?<=d)\\((e)");
    if (JSON.stringify(cn) !== '[null,"x",null]') return "captureNames " + JSON.stringify(cn);
    return true;
  };
})();
