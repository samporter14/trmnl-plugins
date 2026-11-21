// PDB Structure of the Day: transform (serverless Node runtime; needs fetch).
//
// Input: IDX_0 = RCSB Search API result (entry IDs released in the last 7 days, i.e. the latest
// weekly PDB release, sorted by ID); IDX_1 = PDB-101 Molecule of the Month RSS (optional).
// If only one URL is polled, the search result arrives as the bare input.
//
// What the screen means: one entry from the latest weekly release, chosen by date (a fixed
// stride through the ID list, so consecutive days land on unrelated entries). It is NOT a
// ranking or an editorial pick. Every fact shown comes from the RCSB PDB Data API for that
// entry; nothing is written or summarised by this plugin.

var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var STRIDE = 7919; // prime, larger than any weekly release, so it is coprime with the list length

function fields(input) {
  var t = (input && input.trmnl) || {};
  return (t.plugin_settings && t.plugin_settings.custom_fields_values) || {};
}
function pretty(d, withYear) {
  d = String(d || ''); if (d.length < 10) return '';
  return MONTHS[parseInt(d.slice(5, 7), 10) - 1] + ' ' + parseInt(d.slice(8, 10), 10) + (withYear ? ', ' + d.slice(0, 4) : '');
}
function uniq(a) { var s = {}; return a.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }
function cap(s) { return String(s || '').toLowerCase().split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); }
function squash(s) { return String(s || '').split(String.fromCharCode(10)).join(' ').split('  ').join(' ').trim(); }
function noDot(s) { return s.charAt(s.length - 1) === '.' ? s.slice(0, -1) : s; }
// Drop a trailing isolate/strain parenthetical: 'X virus (isolate UK/123/2012)' -> 'X virus'.
function shortOrg(n) { n = String(n || ''); var i = n.indexOf(' ('); if (i < 1) return n; var rest = n.slice(i + 2).toLowerCase(); return (rest.indexOf('isolate') === 0 || rest.indexOf('strain') === 0) ? n.slice(0, i) : n; }
function sentence(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function methodName(m) {
  var map = { 'X-RAY DIFFRACTION': 'X-ray', 'ELECTRON MICROSCOPY': 'Cryo-EM', 'SOLUTION NMR': 'Solution NMR',
    'SOLID-STATE NMR': 'Solid-state NMR', 'ELECTRON CRYSTALLOGRAPHY': 'Electron crystallography',
    'NEUTRON DIFFRACTION': 'Neutron diffraction', 'FIBER DIFFRACTION': 'Fiber diffraction' };
  return map[m] || cap(m);
}
function firstAuthor(list) {
  if (!list || !list.length) return '';
  var last = String(list[0]).split(',')[0].trim();
  return list.length > 1 ? last + ' et al.' : last;
}

function searchResult(input) {
  if (input.IDX_0 !== undefined) return input.IDX_0;
  if (input.result_set || input.total_count !== undefined) return input;
  return null;
}
function motmFrom(input) {
  var r = input.IDX_1;
  if (!r) return null;
  var ch = (r.rss && r.rss.channel) || r.channel || null;
  var item = ch && (Array.isArray(ch.item) ? ch.item[0] : ch.item);
  if (!item) return null;
  var txt = function (v) { return typeof v === 'string' ? v : (v && (v['#text'] || v.__cdata || v['#cdata-section'] || v.content)) || ''; };
  var title = txt(item.title).trim(), sub = txt(item.description).trim();
  if (!title) return null;
  var pd = txt(item.pubDate).split(' ');   // 'Sun, 01 Nov 2026 00:00:00 GMT'
  return { title: title, subtitle: sub, month: pd.length > 3 ? pd[2] + ' ' + pd[3] : '' };
}

var GQL = `{entry(entry_id:"ID"){rcsb_id struct{title} struct_keywords{pdbx_keywords} exptl{method} ` +
  `rcsb_entry_info{resolution_combined molecular_weight deposited_polymer_monomer_count} ` +
  `rcsb_accession_info{initial_release_date deposit_date} ` +
  `rcsb_primary_citation{title journal_abbrev year pdbx_database_id_DOI rcsb_authors} audit_author{name} ` +
  `polymer_entities{rcsb_polymer_entity{pdbx_description} rcsb_entity_source_organism{scientific_name}} ` +
  `assemblies{rcsb_struct_symmetry{oligomeric_state kind}}}}`;

async function getJSON(url, ms) {
  var c = new AbortController(); var t = setTimeout(function () { c.abort(); }, ms);
  try { var r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function exists(url, ms) {
  var c = new AbortController(); var t = setTimeout(function () { c.abort(); }, ms);
  try { var r = await fetch(url, { method: 'HEAD', signal: c.signal }); return r.ok; } catch (e) { return false; }
  finally { clearTimeout(t); }
}

async function run(input) {
  input = input || {};
  var f = fields(input);
  var focus = String(f.focus || 'all').toLowerCase().indexOf('virus') >= 0 ? 'virus' : 'all';
  var publishedOnly = String(f.published_only || 'any').toLowerCase().indexOf('paper') >= 0;
  var t = input.trmnl || {};
  var offset = parseInt((t.user && t.user.utc_offset) || 0, 10) || 0;      // seconds
  var dayNumber = Math.floor((Date.now() + offset * 1000) / 86400000);

  var scope = (focus === 'virus' ? 'virus structures' : 'structures') + (publishedOnly ? ' with a published paper' : '');
  var out = { entry: null, motm: motmFrom(input), focus: focus, scope: scope, count: 0, error: '' };

  var sr = searchResult(input);
  var ids = ((sr && sr.result_set) || []).map(function (r) { return r.identifier; }).filter(Boolean);
  out.count = ids.length;
  if (!ids.length) return out;   // nothing matched (the Search API answers 204 with no body)

  var idx = ((dayNumber * STRIDE) % ids.length + ids.length) % ids.length;
  var id = ids[idx];
  out.pick = (idx + 1) + ' of ' + ids.length;
  try {
    var d = await getJSON('https://data.rcsb.org/graphql?query=' + encodeURIComponent(GQL.replace('ID', id)), 3500);
    var e = d && d.data && d.data.entry;
    if (!e) throw new Error('no entry');
    var info = e.rcsb_entry_info || {}, acc = e.rcsb_accession_info || {}, cit = e.rcsb_primary_citation || null;
    var ents = e.polymer_entities || [];
    var molecules = uniq(ents.map(function (p) { return p.rcsb_polymer_entity && p.rcsb_polymer_entity.pdbx_description; }));
    var organisms = uniq([].concat.apply([], ents.map(function (p) {
      return (p.rcsb_entity_source_organism || []).map(function (o) { return shortOrg(o.scientific_name); });
    })));
    var sym = ((e.assemblies || [])[0] || {}).rcsb_struct_symmetry || [];
    var glob = sym.filter(function (s) { return s.kind === 'Global Symmetry'; })[0] || sym[0] || {};
    var res = (info.resolution_combined || [])[0];
    var methods = uniq((e.exptl || []).map(function (x) { return methodName(x.method); }));
    var published = cit && cit.journal_abbrev && cit.journal_abbrev.toLowerCase() !== 'to be published';
    var lower = id.toLowerCase();
    var img = 'https://cdn.rcsb.org/images/structures/pdb/' + lower + '_assembly-1.jpeg';
    if (!(await exists(img, 1200))) img = 'https://cdn.rcsb.org/images/structures/pdb/' + lower + '_model-1.jpeg';
    out.entry = {
      id: e.rcsb_id || id,
      title: sentence(noDot(squash(e.struct && e.struct.title))),
      keywords: cap((e.struct_keywords && e.struct_keywords.pdbx_keywords) || '').split('/').map(sentence).join('/'),
      method: methods.join(' + '),
      resolution: res ? (Math.round(res * 100) / 100) + ' ' + String.fromCharCode(197) : '',
      weight: info.molecular_weight ? (info.molecular_weight >= 1000 ? (Math.round(info.molecular_weight / 100) / 10) + ' MDa' : Math.round(info.molecular_weight) + ' kDa') : '',
      molecules: molecules.slice(0, 3).join(' ' + String.fromCharCode(183) + ' ') + (molecules.length > 3 ? ' +' + (molecules.length - 3) + ' more' : ''),
      molecule_count: molecules.length,
      organisms: organisms.slice(0, 2).join(', ') + (organisms.length > 2 ? ' +' + (organisms.length - 2) : ''),
      assembly: glob.oligomeric_state || '',
      released: pretty(acc.initial_release_date, false),
      released_full: pretty(acc.initial_release_date, true),
      deposited: pretty(acc.deposit_date, true),
      authors: firstAuthor((e.audit_author || []).map(function (a) { return a.name; })),
      published: !!published,
      paper: published ? [cit.journal_abbrev, cit.year].filter(Boolean).join(' ') : '',
      paper_authors: published ? firstAuthor(cit.rcsb_authors) : '',
      paper_title: published ? noDot(squash(cit.title)) : '',
      doi: published ? (cit.pdbx_database_id_DOI || '') : '',
      image: img
    };
  } catch (err) {
    out.error = 'Could not load details for ' + id + ' from RCSB PDB';
    out.entry = { id: id, title: '', image: 'https://cdn.rcsb.org/images/structures/pdb/' + id.toLowerCase() + '_assembly-1.jpeg' };
  }
  return out;
}
