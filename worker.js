/* Runs the user's regex off the main thread; app.js kills this worker if it takes too long. */
"use strict";
var MAX = 5000; // shortcut: stop listing after 5000 matches; the count says "5000+" so the user knows

self.onmessage = function (e) {
  var d = e.data, out = { id: d.id, matches: [], more: false };
  try {
    var re = new RegExp(d.source, d.flags);
    var take = function (m) {
      out.matches.push({ index: m.index, text: m[0], groups: m.slice(1), named: m.groups ? Object.assign({}, m.groups) : null });
    };
    if (re.global) {
      for (var m of d.text.matchAll(re)) { if (out.matches.length >= MAX) { out.more = true; break; } take(m); }
    } else {
      var one = re.exec(d.text);
      if (one) take(one);
    }
    if (d.replace != null) out.replaced = d.text.replace(re, d.replace);
  } catch (err) {
    out.error = err.message;
  }
  self.postMessage(out);
};

