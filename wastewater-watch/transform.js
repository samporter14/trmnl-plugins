// Wastewater Watch: transform (works in the default JS runtime and in serverless Node).
//
// Input: rows from CDC's "Wastewater Viral Activity Level for SARS-CoV-2, Influenza A and RSV"
// dataset (data.cdc.gov, Socrata id atcp-73re) for one county, last ~10 weeks.
// Socrata returns a bare JSON array; TRMNL hands it over as input.data (or IDX_0 / the array itself).
//
// Honesty rules: every value and category shown is CDC's own field, unrounded and unrecomputed.
// No smoothing, no interpolation, no recomputed categories. Missing weeks stay missing.

var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var PATHOGENS = [
  { key: "SARS-CoV-2", name: "SARS-CoV-2", disease: "COVID-19" },
  { key: "Influenza A virus", name: "Influenza A", disease: "" },
  { key: "RSV", name: "RSV", disease: "" }
];
// CDC's ordinal categories (site_wval_category). Position is only used for the 5-dot ladder.
var LADDER = ["very low", "low", "moderate", "high", "very high"];
var STALE_DAYS = 14;   // CDC posts each Friday for the week ending the previous Saturday (6 days).
var HISTORY_WEEKS = 8;

function fields(input) {
  var t = (input && input.trmnl) || {};
  return (t.plugin_settings && t.plugin_settings.custom_fields_values) || {};
}
function rowsOf(input) {
  if (Array.isArray(input)) return { rows: input };
  if (input && Array.isArray(input.data)) return { rows: input.data };
  if (input && input.IDX_0) return rowsOf(input.IDX_0);
  if (input && (input.errorCode || input.error || input.message)) {
    return { rows: [], error: String(input.message || input.error || input.errorCode).slice(0, 140) };
  }
  return { rows: [], error: "No response from data.cdc.gov" };
}
function pretty(d, withYear) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  if (!m) return "";
  return MONTHS[parseInt(m[2], 10) - 1] + " " + parseInt(m[3], 10) + (withYear ? ", " + m[1] : "");
}
function dayNum(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : NaN;
}
function siteNum(s) { return String(s || "").replace(/^ID:\s*/i, "").trim(); }
function popFull(p) {
  var n = Math.round(parseFloat(p));
  return isFinite(n) ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "";
}
function popShort(p) {
  var n = parseFloat(p);
  if (!isFinite(n)) return "";
  if (n >= 1e6) return (Math.round(n / 1e5) / 10) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(Math.round(n));
}
function sourceText(s) {
  return String(s || "").split(/,\s*/).filter(Boolean).map(function (x) {
    if (x === "State_Territory") return "state health dept";
    if (/^CDC_/.test(x)) return "CDC contract lab";
    return x;   // WastewaterSCAN
  }).join(" + ");
}
function titleCase(s) {   // select values arrive lowercased ("michigan")
  return s.replace(/[a-z][^\s]*/gi, function (w, i) {
    if (i > 0 && /^of$/i.test(w)) return "of";
    if (/^u\.s\.$/i.test(w)) return "U.S.";
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
}
function countyMatches(served, county) {
  var want = county.toLowerCase().replace(/\s+(county|parish|borough)$/, "").trim();
  return String(served || "").split(/,\s*/).some(function (c) {
    return c.toLowerCase().replace(/\s+(county|parish|borough)$/, "").trim() === want;
  });
}

function transform(input) {
  input = input || {};
  var f = fields(input);
  var county = String(f.county || "Washtenaw").trim();
  var state = titleCase(String(f.state || "Michigan").trim());
  var wantSite = siteNum(f.site_id || "");
  var place = county + (/\b(county|parish|borough)$/i.test(county) ? "" : " County") + ", " + state;

  var t = input.trmnl || {};
  var offset = parseInt((t.user && t.user.utc_offset) || 0, 10) || 0;   // seconds
  var todayNum = Math.floor((Date.now() + offset * 1000) / 86400000);

  var got = rowsOf(input);
  var rows = got.rows.filter(function (r) { return r && r.site && countyMatches(r.counties_served, county); });
  var out = { place: place, county: county, state: state, error: got.error || "", note: "", site: null,
              pathogens: [], other_sites: "", ok: false };

  // Sites in this county, newest data first, then by population served.
  var sites = {};
  rows.forEach(function (r) {
    var id = siteNum(r.site), s = sites[id];
    if (!s) s = sites[id] = { id: id, latest: "", rows: [] };
    s.rows.push(r);
    if (r.week_end > s.latest) { s.latest = r.week_end; s.pop = r.population_served; s.source = r.source;
      s.counties = r.counties_served; s.updated = r.date_updated; }
  });
  var list = Object.keys(sites).map(function (k) { return sites[k]; });
  list.sort(function (a, b) {
    if (a.latest !== b.latest) return a.latest < b.latest ? 1 : -1;
    return (parseFloat(b.pop) || 0) - (parseFloat(a.pop) || 0);
  });
  if (!list.length) {
    if (!out.error) out.error = "No CDC wastewater data for " + place + " in the last 10 weeks";
    return out;
  }
  var site = wantSite ? sites[wantSite] : list[0];
  if (!site) {
    // Asked-for site is not in this county (e.g. the county was changed): say so, show the default pick.
    site = list[0];
    out.note = "Site " + wantSite + " is not in " + place + "; showing site " + site.id + ".";
  }
  out.other_sites = list.filter(function (s) { return s.id !== site.id; })
    .map(function (s) { return s.id + " (" + popShort(s.pop) + " people)"; }).join(", ");
  out.site_count = list.length;

  var week = site.latest;
  var daysOld = todayNum - dayNum(week);
  out.site = { id: site.id, population: popFull(site.pop), pop_short: popShort(site.pop),
               source: sourceText(site.source), counties: site.counties };
  out.week_end = week;
  out.week_label = pretty(week, true);
  out.week_short = pretty(week, false);
  out.days_old = daysOld;
  out.stale = daysOld > STALE_DAYS;
  out.cdc_updated = pretty(site.updated, false);
  if (out.stale) out.note = (out.note ? out.note + " " : "") + "Newest data is " + daysOld + " days old. CDC normally updates on Fridays.";

  PATHOGENS.forEach(function (p) {
    var pr = site.rows.filter(function (r) { return r.pathogen_target === p.key; })
      .sort(function (a, b) { return a.week_end < b.week_end ? 1 : a.week_end > b.week_end ? -1 : 0; });
    var cur = pr[0] || null;
    var current = !!(cur && cur.week_end === week);
    var cat = cur ? String(cur.site_wval_category || "").trim() : "";
    var level = LADDER.indexOf(cat.toLowerCase()) + 1;   // 0 = not one of the five levels
    var prev = pr[1] || null;
    var hist = pr.slice(0, HISTORY_WEEKS).reverse()
      .filter(function (r) { return r.site_wval !== undefined && r.site_wval !== null && r.site_wval !== ""; })
      .map(function (r) { return [pretty(r.week_end, false), parseFloat(r.site_wval)]; });
    out.pathogens.push({
      name: p.name, disease: p.disease,
      has_data: !!cur,
      current: current,
      category: cat || "No data",
      wval: cur && cur.site_wval !== undefined ? String(cur.site_wval) : "",
      level: level,
      as_of: cur ? pretty(cur.week_end, false) : "",
      prev: prev ? (String(prev.site_wval_category || "") + (prev.site_wval ? " " + prev.site_wval : "")) : "",
      prev_week: prev ? pretty(prev.week_end, false) : "",
      hist: hist
    });
  });
  // One y-axis range for all three history charts.
  var hmax = 0;
  out.pathogens.forEach(function (p) { p.hist.forEach(function (h) { if (h[1] > hmax) hmax = h[1]; }); });
  out.hist_max = Math.ceil(hmax || 1);
  out.ok = true;
  return out;
}

async function run(input) { return transform(input); }
