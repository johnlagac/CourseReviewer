#!/usr/bin/env python3
"""Build self-contained, single-file copies of each subject reviewer.

A subject page normally pulls the shared engine from ../../assets/, so
moving that one file anywhere else silently loses all styling and all
interactivity. This inlines the stylesheet and the engine so the result
works from any folder, with nothing beside it — for emailing, for a
phone, or for dropping into a study folder.

    python3 build-standalone.py            # every subject
    python3 build-standalone.py act501     # just one

Output goes to standalone/. Re-run after changing a subject page or the
engine; the generated files do not update themselves.
"""
import os, re, sys, html as _html

ROOT = os.path.dirname(os.path.abspath(__file__))
SUBJECTS = os.path.join(ROOT, 'subjects')
OUT = os.path.join(ROOT, 'standalone')


def slug(text):
    return re.sub(r'[^A-Za-z0-9]+', '-', text).strip('-')


def build(code):
    src = os.path.join(SUBJECTS, code, 'index.html')
    if not os.path.isfile(src):
        raise SystemExit('no such subject page: ' + src)

    with open(src, encoding='utf-8') as f:
        page = f.read()
    with open(os.path.join(ROOT, 'assets', 'reviewer.css'), encoding='utf-8') as f:
        css = f.read()
    with open(os.path.join(ROOT, 'assets', 'reviewer.js'), encoding='utf-8') as f:
        js = f.read()

    # A literal </script> inside the engine would close the tag early.
    if '</script' in js.lower():
        raise SystemExit('engine contains </script>; inlining would break it')

    page, n = re.subn(r'<link rel="stylesheet" href="\.\./\.\./assets/reviewer\.css">',
                      lambda m: '<style>\n' + css + '\n</style>', page)
    assert n == 1, 'expected exactly one stylesheet link, found %d' % n

    page, n = re.subn(r'<script src="\.\./\.\./assets/reviewer\.js"></script>',
                      lambda m: '<script>\n' + js + '\n</script>', page)
    assert n == 1, 'expected exactly one engine script tag, found %d' % n

    # Both routes back to the subject index have no target in a lone file.
    page, n = re.subn(r'<a class="brand" href="\.\./\.\./index\.html">(.*?)</a>',
                      lambda m: '<span class="brand">%s</span>' % m.group(1), page, flags=re.S)
    assert n == 1, 'expected exactly one brand link, found %d' % n
    page, n = re.subn(r'[ \t]*<a class="rail-home"[^>]*>.*?</a>\n', '', page, flags=re.S)
    assert n == 1, 'expected exactly one rail-home link, found %d' % n

    leftover = re.findall(r'(?:src|href)="\.\./\.\./[^"]*"', page)
    if leftover:
        raise SystemExit('unresolved relative references remain: %r' % leftover)

    title = re.search(r'<title>(.*?)</title>', page, re.S).group(1)
    name = slug(_html.unescape(title).replace('—', '-')) + '.html'

    os.makedirs(OUT, exist_ok=True)
    dest = os.path.join(OUT, name)
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(page)
    print('  %-46s %6.0f KB' % (os.path.relpath(dest, ROOT), len(page.encode()) / 1024))
    return dest


if __name__ == '__main__':
    codes = sys.argv[1:] or sorted(
        d for d in os.listdir(SUBJECTS)
        if not d.startswith('_') and os.path.isfile(os.path.join(SUBJECTS, d, 'index.html')))
    print('Building standalone reviewers:')
    for c in codes:
        build(c)
