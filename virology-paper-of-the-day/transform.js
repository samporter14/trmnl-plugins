// Virology Paper of the Day: transform (works in the default JS runtime and in serverless Node).
//
// Input: one Europe PMC search response per source (IDX_0, IDX_1, ...; or the bare response when
// there is only one source). Each response echoes its query in request.queryString, which is how a
// source is identified even when it returned nothing.
//
// What the screen means: the featured paper is the NEWEST matching paper from one source; the
// source rotates each day. It is not a ranking of importance. Nothing is invented: every item
// comes from Europe PMC, and an empty source is reported as empty.

var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var ABSTRACT_CHARS = 420;

function fields(input) {
  var t = (input && input.trmnl) || {};
  return (t.plugin_settings && t.plugin_settings.custom_fields_values) || {};
}
function splitList(s) {
  return String(s || "").split(/[,;\n]/).map(function (x) { return x.trim().replace(/"/g, ""); }).filter(Boolean);
}
function clean(s) {
  return String(s || "")
    .replace(/<\/(p|h\d|div|li)>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
function pretty(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  return m ? MONTHS[parseInt(m[2], 10) - 1] + " " + parseInt(m[3], 10) : "";
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// Title test used for preprints only (bioRxiv covers all of biology, so an abstract that merely
// mentions a virus is not enough). Each topic word must start a word ("phage" does not match
// "macrophage"); "virus" also matches inside names such as "astrovirus" or "coronavirus".
function titleMatcher(words) {
  if (!words.length) return function () { return true; };
  var re = new RegExp("(^|[^A-Za-z0-9])(" + words.map(escapeRe).join("|") + ")", "i");
  var anyVirus = words.some(function (w) { return /^virus/i.test(w); });
  return function (t) { return re.test(t) || (anyVirus && /virus/i.test(t)); };
}
function firstAuthor(s) {
  var a = String(s || "").replace(/\.$/, "").split(/,\s*/).filter(Boolean);
  if (!a.length) return "";
  var first = a[0].replace(/\s+[A-Z]{1,3}$/, "");   // "Smith JA" -> "Smith"
  return a.length > 1 ? first + " et al." : first;
}
function abstractExcerpt(s) {
  var t = clean(s).replace(/^(abstract|background|summary)[:\s]+/i, "");
  if (t.length <= ABSTRACT_CHARS) return t;
  var cut = t.slice(0, ABSTRACT_CHARS), sp = cut.lastIndexOf(" ");
  return (sp > 200 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, "") + "…";
}

function responses(input) {
  var keys = Object.keys(input).filter(function (k) { return /^IDX_\d+$/.test(k); })
    .sort(function (a, b) { return parseInt(a.slice(4), 10) - parseInt(b.slice(4), 10); });
  if (keys.length) return keys.map(function (k) { return input[k]; });
  return input.resultList || input.request ? [input] : [];
}

function describe(resp) {
  var q = (resp && resp.request && resp.request.queryString) || "";
  var issn = /ISSN:"([0-9X-]+)"/i.exec(q);
  if (issn) return { key: issn[1].toUpperCase(), preprint: false, label: "ISSN " + issn[1].toUpperCase() };
  if (/SRC:PPR/.test(q)) return { key: "preprints", preprint: true, label: /medRxiv/.test(q) ? "bioRxiv + medRxiv" : "bioRxiv" };
  return null;
}

function toItem(r, preprint) {
  var j = (r.journalInfo && r.journalInfo.journal) || {};
  var publisher = (r.bookOrReportDetails && r.bookOrReportDetails.publisher) || "";
  var isPre = preprint || (r.pubTypeList && (r.pubTypeList.pubType || []).indexOf("Preprint") >= 0);
  return {
    title: clean(r.title).replace(/\.$/, ""),
    authors: firstAuthor(r.authorString),
    venue: isPre ? (publisher || "Preprint") : (j.isoabbreviation || j.medlineAbbreviation || j.title || r.journalTitle || ""),
    preprint: !!isPre,
    date: r.firstPublicationDate || "",
    when: pretty(r.firstPublicationDate),
    doi: r.doi || "",
    abstract: abstractExcerpt(r.abstractText)
  };
}

function transform(input) {
  input = input || {};
  var f = fields(input);
  var words = splitList(f.topic_words || "virus, viruses, viral, virion, virome, phage, bacteriophage, HIV, SARS-CoV-2");
  var titleOk = titleMatcher(words);
  var t = input.trmnl || {};
  var offset = parseInt((t.user && t.user.utc_offset) || 0, 10) || 0;      // seconds
  var nowLocal = new Date(Date.now() + offset * 1000);
  var today = nowLocal.toISOString().slice(0, 10);
  var dayNumber = Math.floor((Date.now() + offset * 1000) / 86400000);

  var sources = [], errors = [];
  responses(input).forEach(function (resp) {
    var src = describe(resp);
    if (!src) { errors.push("A source did not respond"); return; }
    var rows = (resp.resultList && resp.resultList.result) || [];
    var items = rows.map(function (r) { return toItem(r, src.preprint); })
      .filter(function (i) { return i.title && i.date && i.date <= today; })
      .filter(function (i) { return !src.preprint || titleOk(i.title); });
    // Name a journal by what Europe PMC calls it; an empty journal keeps "ISSN ...".
    if (!src.preprint && items.length) src.label = items[0].venue;
    items.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    sources.push({ label: src.label, preprint: src.preprint, items: items, total: parseInt(resp.hitCount, 10) || 0 });
  });

  // Rotation: today's source = day number mod source count. If that source has nothing new,
  // move on to the next source that does (and say so on screen).
  var n = sources.length, featured = null, featuredSource = "", rotatedFrom = "";
  if (n) {
    var start = ((dayNumber % n) + n) % n;
    for (var k = 0; k < n; k++) {
      var s = sources[(start + k) % n];
      if (!s.items.length) continue;
      // Prefer the newest paper from before today so the pick holds steady through the day.
      featured = s.items.filter(function (i) { return i.date < today; })[0] || s.items[0];
      featuredSource = s.label;
      if (k > 0) rotatedFrom = sources[start].label;
      break;
    }
  }
  var also = [];
  sources.forEach(function (s) {
    s.items.forEach(function (i) {
      if (featured && i.doi === featured.doi && i.title === featured.title) return;
      if (also.length < 8 && also.filter(function (a) { return a.venue === i.venue; }).length < 2) also.push(i);
    });
  });
  // At most 2 per venue, newest first.
  also.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });

  var featuredOut = null;
  if (featured) featuredOut = Object.assign({}, featured);
  return {
    featured: featuredOut,
    featured_source: featuredSource,
    rotated_from: rotatedFrom,          // today's scheduled source, when it had nothing new
    also: also.map(function (i) { return { title: i.title, venue: i.venue, when: i.when, preprint: i.preprint }; }),
    sources: sources.map(function (s) { return { label: s.label, count: s.items.length, preprint: s.preprint }; }),
    source_names: sources.map(function (s) { return s.label; }).join(" · "),
    lookback_days: parseInt(f.lookback_days, 10) || 30,
    errors: errors
  };
}

async function run(input) { return transform(input); }
