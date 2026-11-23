// Amtrak Station Board: transform (serverless Node runtime; needs fetch).
// Input: Amtraker v3 station record, polled from https://api-v3.amtraker.com/v3/stations/CODE
// ({CODE: {name, code, tz, trains: ['352-20', ...]}}). The station record lists only the trains
// Amtrak is tracking right now (running, or about to leave their origin). The transform fetches
// the full train list once (one ~1.3 MB request) and keeps this station's stop for each train.
// Times are shown exactly as Amtrak's train map reports them for this stop (scheduled vs
// estimated or actual); delay = estimate minus schedule. Nothing is predicted by this plugin.

var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fields(input) {
  var t = (input && input.trmnl) || {};
  return (t.plugin_settings && t.plugin_settings.custom_fields_values) || {};
}
function stationRecord(input) {
  var r = input.IDX_0 !== undefined ? input.IDX_0 : input;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  var keys = Object.keys(r).filter(function (k) { return r[k] && r[k].code; });
  return keys.length ? r[keys[0]] : null;
}
// '2026-11-20T19:43:00-05:00' -> local clock parts at the stop (the string already carries the stop's offset)
function clock(iso, h24) {
  iso = String(iso || ''); if (iso.length < 16) return '';
  var h = parseInt(iso.slice(11, 13), 10), m = iso.slice(14, 16);
  if (h24) return (h < 10 ? '0' : '') + h + ':' + m;
  var ap = h < 12 ? 'am' : 'pm'; var hh = h % 12; if (hh === 0) hh = 12;
  return hh + ':' + m + ap;
}
function dayKey(iso) { return String(iso || '').slice(0, 10); }
function prettyDay(iso) { var d = String(iso || ''); return d.length < 10 ? '' : MONTHS[parseInt(d.slice(5, 7), 10) - 1] + ' ' + parseInt(d.slice(8, 10), 10); }
function ms(iso) { var t = Date.parse(iso); return isNaN(t) ? null : t; }
function mins(a, b) { var x = ms(a), y = ms(b); return (x === null || y === null) ? null : Math.round((x - y) / 60000); }
function delayText(d, endsHere) {
  if (d === null) return '';
  if (d < 0 && endsHere) return (-d) + ' min early';
  if (d <= 0) return 'On time';
  if (d < 60) return d + ' min late';
  var h = Math.floor(d / 60), m = d % 60;
  return h + ' h ' + (m ? m + ' min ' : '') + 'late';
}
function delayShort(d) {
  if (d === null || d <= 0) return '';
  if (d < 60) return '+' + d + 'm';
  var h = Math.floor(d / 60), m = d % 60;
  return '+' + h + 'h' + (m ? (m < 10 ? '0' : '') + m : '');
}
function nowParts(tz, h24) {
  try {
    var p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: !h24 }).format(new Date());
    return p.replace(' AM', 'am').replace(' PM', 'pm');
  } catch (e) { return ''; }
}
async function getJSON(url, ms_) {
  var c = new AbortController(); var t = setTimeout(function () { c.abort(); }, ms_);
  try { var r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

async function run(input) {
  input = input || {};
  var f = fields(input);
  var code = String(f.station || 'ARB').trim().toUpperCase();
  var h24 = String(f.time_format || '').indexOf('24') >= 0;
  var nDeparted = parseInt(f.show_departed === undefined ? '1' : f.show_departed, 10); if (isNaN(nDeparted)) nDeparted = 1;
  var buses = f.buses === true || ['true', 'yes'].indexOf(String(f.buses || '').toLowerCase()) >= 0;
  var st = stationRecord(input);
  var out = { station: { code: code, name: '' }, upcoming: [], departed: [], count: 0, as_of: '', error: '', tracked: 0 };
  if (!st) { out.error = 'Station code ' + code + ' not found. Use the 3-letter Amtrak code, e.g. ARB, CHI, NYP.'; return out; }
  out.station = { code: st.code, name: st.name || st.code, city: st.city || '', state: st.state || '', tz: st.tz || '' };
  out.as_of = nowParts(st.tz || 'America/New_York', h24);
  var ids = st.trains || [];
  out.tracked = ids.length;
  if (!ids.length) return out;

  var all;
  try { all = await getJSON('https://api-v3.amtraker.com/v3/trains', 8000); }
  catch (e) { out.error = 'Could not load train data from Amtraker'; return out; }
  var want = {}; ids.forEach(function (id) { want[id] = 1; });
  var now = Date.now();
  var rows = [];
  Object.keys(all || {}).forEach(function (k) {
    (all[k] || []).forEach(function (t) {
      if (!want[t.trainID]) return;
      var stops = t.stations || [];
      var i = -1; for (var j = 0; j < stops.length; j++) { if (stops[j].code === st.code) { i = j; break; } }
      if (i < 0) return;
      var s = stops[i];
      if (s.bus && !buses) return;
      var isOrigin = i === 0, isDest = i === stops.length - 1;
      // Departure times for most stops; arrival times where the train ends here.
      var sch = isDest ? s.schArr : (s.schDep || s.schArr);
      var est = isDest ? s.arr : (s.dep || s.arr);
      var d = mins(est, sch);
      var departed = s.status === 'Departed';
      var row = {
        num: t.trainNum, route: t.routeName || '', provider: t.providerShort || '',
        to: isDest ? ('from ' + (t.origName || t.origCode)) : (t.destName || t.destCode),
        ends_here: isDest, starts_here: isOrigin, bus: !!s.bus,
        sched: clock(sch, h24), est: clock(est, h24), changed: clock(sch, h24) !== clock(est, h24),
        day: prettyDay(sch), other_day: false,
        delay: d, delay_text: delayText(d, isDest), delay_short: delayShort(d), late: d !== null && d > 0,
        status: departed ? (isDest ? 'Arrived' : 'Departed') : (s.status === 'Station' ? 'At station' : (t.trainState === 'Predeparture' ? (isOrigin ? 'Starts here' : 'Not yet left ' + (t.origName || t.origCode || 'origin')) : 'En route')),
        gone: departed,
        platform: s.platform || '',
        sort: ms(est) || ms(sch) || 0,
        sched_key: dayKey(sch)
      };
      rows.push(row);
    });
  });
  var up = rows.filter(function (r) { return !r.gone; }).sort(function (a, b) { return a.sort - b.sort; });
  var gone = rows.filter(function (r) { return r.gone && now - r.sort < 3 * 3600000; }).sort(function (a, b) { return b.sort - a.sort; });
  // Flag rows not on the same calendar day as the first upcoming row (overnight / long-distance trains).
  var ref = up.length ? up[0].sched_key : (gone.length ? gone[0].sched_key : '');
  up.concat(gone).forEach(function (r) { r.other_day = !!ref && r.sched_key !== ref; delete r.sort; delete r.sched_key; });
  out.upcoming = up;
  out.departed = gone.slice(0, Math.max(0, nDeparted));
  out.count = up.length;
  return out;
}
