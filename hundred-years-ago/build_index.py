import json, time, urllib.request, urllib.parse, os, sys
# One index file per paper per year: date -> front-page IIIF service id | page width/height.
# Run from anywhere: python3 build_index.py (about 15 s per paper-year; loc.gov is slow).
PAPERS = ['sn87055779','sn82015313','sn83045462','sn84026749','sn82016181','sn82014519','sn83045293','sn85042243','sn86063730']
YEARS = range(1926, 1932)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index')
PFX = 'https://tile.loc.gov/image-services/iiif/service:'
def get(url):
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'curl/8'}), timeout=90) as r:
                return json.load(r)
        except Exception as e:
            print('retry', i, e, file=sys.stderr); time.sleep(5 * (i + 1))
    raise SystemExit('failed ' + url)
for l in PAPERS:
    for y in YEARS:
        fn = f'{OUT}/{l}/{y}.json'
        if os.path.exists(fn): continue
        issues = {}; meta = {}; sp = 1
        while True:
            u = ('https://www.loc.gov/collections/chronicling-america/?fa=' + urllib.parse.quote('number_lccn:' + l) +
                 f'&dates={y}-01-01/{y}-12-31&dl=issue&fo=json&c=500&sp={sp}&at=results,pagination')
            d = get(u)
            for x in d.get('results', []):
                img = (x.get('image_url') or [''])[0]
                if not img.startswith(PFX) or not x.get('date'): continue
                svc, _, rest = img.partition('/full/')
                h = rest.split('h=')[1].split('&')[0] if 'h=' in rest else ''
                w = rest.split('w=')[1].split('&')[0] if 'w=' in rest else ''
                it = x.get('item') or {}
                if x['date'] in issues: continue  # keep first edition listed
                issues[x['date']] = svc[len(PFX):] + '|' + (str(round(int(w)/int(h), 3)) if h and w else '')
                if not meta:
                    meta = {'title': (it.get('newspaper_title') or [''])[0], 'place': it.get('place_of_publication', '')}
            pg = d.get('pagination') or {}
            if not pg.get('next'): break
            sp += 1; time.sleep(2)
        os.makedirs(f'{OUT}/{l}', exist_ok=True)
        json.dump({'lccn': l, 'year': y, 'title': meta.get('title',''), 'place': meta.get('place',''),
                   'source': 'Library of Congress, Chronicling America (loc.gov). image = IIIF service id; ratio = page width/height.',
                   'issues': dict(sorted(issues.items()))}, open(fn, 'w'), separators=(',', ':'))
        print(l, y, len(issues), flush=True)
        time.sleep(2)
