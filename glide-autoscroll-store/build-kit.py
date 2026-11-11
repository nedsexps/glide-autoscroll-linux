# Fills kit-template.html with the text in listing.md -> kit.html
import json, re, pathlib
here = pathlib.Path(__file__).parent
listing = (here / 'listing.md').read_text()
manifest = json.loads((here.parent / 'glide-autoscroll' / 'manifest.json').read_text())

def block(heading):
    m = re.search(r'^###? ' + re.escape(heading) + r'\s*\n.*?```text\n(.*?)\n```', listing, re.S | re.M)
    if not m: raise SystemExit(f'missing block: {heading}')
    return m.group(1)

fields = {
    'description': block('Description'),
    'category': block('Category'),
    'language': block('Language'),
    'purpose': block('Single purpose description'),
    'storage': block('Permission justification: storage'),
    'scripting': block('Permission justification: scripting'),
    'host': block('Permission justification: host permission'),
    'test': block('Test instructions tab'),
    'policy_url': block('Privacy policy URL'),
    'homepage': 'https://github.com/nedsexps/glide-autoscroll-linux',
    'support': 'https://github.com/nedsexps/glide-autoscroll-linux/issues',
    'release_tag': 'v' + manifest['version'],
    'release_title': 'Glide Autoscroll ' + manifest['version'],
    'release_notes': (here / f"release-{manifest['version']}.md").read_text().strip(),
}
images = [
    dict(field='Store icon', file='store-icon-128x128.png', size='128×128', required=True, icon=True, alt='Glide icon'),
    dict(field='Screenshot 1', file='screenshot-1-glide.png', size='1280×800', required=True, alt='An article mid-glide'),
    dict(field='Screenshot 2', file='screenshot-2-panels.png', size='1280×800', required=False, alt='A notes app with its middle panel scrolling'),
    dict(field='Screenshot 3', file='screenshot-3-settings.png', size='1280×800', required=False, alt='The settings page with its test area'),
    dict(field='Screenshot 4', file='screenshot-4-popup.png', size='1280×800', required=False, alt='The toolbar popup over a site'),
    dict(field='Small promo tile', file='small-promo-tile-440x280.png', size='440×280', required=False, alt='Small promo tile'),
    dict(field='Marquee promo tile', file='marquee-promo-tile-1400x560.png', size='1400×560', required=False, alt='Marquee promo tile'),
]
for i in images:
    assert (here / 'images' / i['file']).exists(), i['file']
    i['src'] = 'images/' + i['file']
kit = dict(name=manifest['name'], summary=manifest['description'], fields=fields, images=images)
data = json.dumps(kit, ensure_ascii=False).replace('</', '<\\/')
out = (here / 'kit-template.html').read_text().replace('/*KIT_DATA*/null', data)
assert '/*KIT_DATA*/' not in out
(here / 'kit.html').write_text(out)
print('kit.html', len(out), 'bytes;', ', '.join(f'{k} {len(v)}' for k, v in fields.items()))
