// Bus Arrivals (TheRide, Ann Arbor) transform.
// One polling URL fetches every stop at once (stpid=1285,1776). This reshapes the
// BusTime "bustime-response" into stops -> routes -> next clock times.
// Stop order on screen follows the installer's Stop IDs field (done in shared.liquid).
var MAX_TIMES = 3;
var DIRS = { NB: "Northbound", SB: "Southbound", EB: "Eastbound", WB: "Westbound" };

function list(x) { return x ? (Array.isArray(x) ? x : [x]) : []; }
function clock(s) { // "20261106 16:19" -> "4:19"
  var m = /(\d{2}):(\d{2})$/.exec(s || "");
  if (!m) return "";
  var h = parseInt(m[1], 10) % 12; if (h === 0) h = 12;
  return h + ":" + m[2];
}
function ampm(s) { var m = /(\d{2}):\d{2}$/.exec(s || ""); return m && parseInt(m[1], 10) >= 12 ? "PM" : "AM"; }
function shortDest(d) {
  d = (d || "").replace(/^.* to /, "");
  return d.replace("Blake Transit Center", "Blake Transit Ctr")
          .replace("Central Campus Transit Center", "Central Campus")
          .replace(/^CCTC$/, "Central Campus");
}
function friendly(msg) {
  msg = msg || "";
  if (/no data found/i.test(msg)) return "No buses predicted right now";
  if (/no service/i.test(msg)) return "No service scheduled";
  if (/no arrival/i.test(msg)) return "No buses predicted right now";
  if (/no parameter/i.test(msg)) return "Add a stop ID in the plugin settings";
  if (/maximum number/i.test(msg)) return "Too many stop IDs; enter up to 4";
  return msg;
}

function transform(input) {
  var br = (input && input["bustime-response"]) || {};
  var prd = list(br.prd), errs = list(br.error);
  var byId = {}, order = [], newest = "", general = "";

  function stop(id, rawName) {
    id = String(id || "").trim();
    if (!byId[id]) { byId[id] = { id: id, name: "", dir: "", routes: [], note: "", _g: {} }; order.push(id); }
    var s = byId[id];
    if (rawName && !s.name) {
      var m = /^(NB|SB|EB|WB)\s+(.*)$/.exec(rawName);
      s.name = m ? m[2] : rawName;
      s.dir = m ? DIRS[m[1]] : "";
    }
    return s;
  }

  prd.sort(function (a, b) { return a.prdtm < b.prdtm ? -1 : a.prdtm > b.prdtm ? 1 : 0; });
  prd.forEach(function (p) {
    if (p.tmstmp > newest) newest = p.tmstmp;
    var s = stop(p.stpid, p.stpnm);
    var key = p.rt + "|" + p.des;
    if (!s._g[key]) { s._g[key] = { route: p.rt, dest: shortDest(p.des), times: [] }; s.routes.push(s._g[key]); }
    if (s._g[key].times.length < MAX_TIMES) s._g[key].times.push(clock(p.prdtm));
  });
  errs.forEach(function (e) {
    if (e.stpid) { stop(e.stpid).note = friendly(e.msg); }
    else { general = friendly(e.msg); }
  });

  var stops = order.map(function (id) { var s = byId[id]; delete s._g; return s; });
  return { stops: stops, error: general, updated: newest ? clock(newest) + " " + ampm(newest) : "" };
}
async function run(input) { return transform(input); }
