// 100 Years Ago Today: transform (TRMNL serverless Node runtime; needs fetch).
//
// Input: one year of a date-to-front-page index for the chosen paper, e.g.
// index/sn87055779/1926.json in github.com/samporter14/trmnl-plugins (see polling_url.liquid).
// Each index was built once from the Library of Congress Chronicling America API (loc.gov), because
// loc.gov answers 403 to TRMNL's servers. It maps each issue date to the IIIF image service of that
// issue's front page and the page's width/height ratio. Page images load straight from tile.loc.gov.
//
// The transform computes today's date in the user's time zone minus 100 years, picks the issue on that
// date or, failing that, the nearest one (fetching the neighbouring year's index when the date is near
// a year boundary), and builds IIIF crop URLs. Nothing on screen is written by this plugin: the image
// is the page scan, and the paper name, place and issue date come from the LoC record.

var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var INDEX = 'https://raw.githubusercontent.com/samporter14/trmnl-plugins/main/hundred-years-ago/index/';
var IIIF = 'https://tile.loc.gov/image-services/iiif/service:';
var DEFAULT_LCCN = 'sn87055779'; // South Bend News-Times (South Bend, Ind.)
var NEAR = 20; // look in the neighbouring year when the nearest issue is further than this many days

function fields(input) {
  var t = (input && input.trmnl) || {};
  return (t.plugin_settings && t.plugin_settings.custom_fields_values) || {};
}
function ymd(d) { return d.toISOString().slice(0, 10); }
function parse(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00Z'); }
function longDate(s) { var d = parse(s); return DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
function shortDate(s) { var d = parse(s); return MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
function dayDiff(a, b) { return Math.round((parse(a) - parse(b)) / 86400000); }
function capWord(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }
function cap(s) { return String(s || '').split(' ').map(function (w) { return w.split('-').map(capWord).join('-'); }).join(' '); }
function noDot(s) { s = String(s || '').trim(); return s.charAt(s.length - 1) === '.' ? s.slice(0, -1) : s; }
function cleanPlace(s) { return String(s || '').split('[').join('').split(']').join('').split('  ').join(' ').trim(); }

// Target = today's month/day in the user's time zone, 100 years earlier (Feb 29 -> Feb 28 if needed).
function targetDate(input) {
  var t = input.trmnl || {};
  var offset = parseInt((t.user && t.user.utc_offset) || 0, 10) || 0; // seconds
  var now = new Date(Date.now() + offset * 1000);
  var y = now.getUTCFullYear() - 100, m = now.getUTCMonth(), d = now.getUTCDate();
  var dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCMonth() !== m) dt = new Date(Date.UTC(y, m + 1, 0));
  return ymd(dt);
}

async function getJSON(url, ms) {
  var c = new AbortController(); var t = setTimeout(function () { c.abort(); }, ms);
  try { var r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
function isIndex(o) { return o && typeof o === 'object' && o.issues && typeof o.issues === 'object'; }
async function loadYear(lccn, year) {
  try { var d = await getJSON(INDEX + lccn + '/' + year + '.json', 5000); return isIndex(d) ? d : null; } catch (e) { return null; }
}

function nearest(idx, target) {
  var best = null, bd = Infinity;
  Object.keys((idx && idx.issues) || {}).forEach(function (date) {
    var dd = Math.abs(dayDiff(date, target));
    if (dd < bd || (dd === bd && date < best)) { best = date; bd = dd; }
  });
  return best ? { date: best, diff: bd, idx: idx } : null;
}

function images(value) {
  var parts = String(value || '').split('|');
  var svc = IIIF + parts[0];
  var r = parseFloat(parts[1]) || 0.77;              // page width / height
  // Top crop: 97% of the width (trims scanner margins), height = 0.8 x that width,
  // so landscape views show masthead and top headlines; the layout cuts off the rest.
  var hp = Math.min(98.8, Math.round(0.97 * 0.8 * r * 1000) / 10);
  return {
    top: svc + '/pct:1.5,0.6,97,' + hp + '/1400,/0/default.jpg',
    page: svc + '/pct:1.5,0.6,97,98.8/,1300/0/default.jpg'
  };
}

async function run(input) {
  input = input || {};
  var f = fields(input);
  var lccn = String(f.paper || DEFAULT_LCCN).toLowerCase().trim();
  var target = targetDate(input);
  var ty = parseInt(target.slice(0, 4), 10);
  var out = { ok: false, target: target, target_label: longDate(target), target_short: shortDate(target), lccn: lccn, error: '' };

  var polled = isIndex(input) ? input : (isIndex(input.IDX_0) ? input.IDX_0 : null);
  var main = (polled && polled.year === ty) ? polled : await loadYear(lccn, ty);
  var best = nearest(main, target);

  if (!best || best.diff > NEAR) {
    var md = target.slice(5);
    var other = await loadYear(lccn, md < '07-01' ? ty - 1 : ty + 1);
    var alt = nearest(other, target);
    if (alt && (!best || alt.diff < best.diff)) best = alt;
  }

  if (!best) {
    out.error = main ? 'none' : 'no_index';
    if (polled) { out.paper = noDot(cap(polled.title)); }
    return out;
  }

  var idx = best.idx;
  var img = images(idx.issues[best.date]);
  var off = dayDiff(best.date, target);
  out.ok = true;
  out.exact = off === 0;
  out.days_off = Math.abs(off);
  out.off_label = off === 0 ? '' : (Math.abs(off) + ' day' + (Math.abs(off) === 1 ? '' : 's') + (off < 0 ? ' before' : ' after'));
  out.paper = noDot(cap(idx.title));
  out.place = cleanPlace(idx.place);
  out.date = best.date;
  out.date_label = longDate(best.date);
  out.date_short = shortDate(best.date);
  out.image_top = img.top;
  out.image_page = img.page;
  return out;
}
