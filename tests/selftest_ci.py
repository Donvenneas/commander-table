"""Runs the game's self-test page (public/selftest.html) in a headless browser and fails on broken rows.

Used by .github/workflows/selftest.yml, and can be run locally:
    pip install playwright==1.49.1 && python -m playwright install chromium
    python server.py --no-browser --port 8777        (in another window)
    python tests/selftest_ci.py --url http://localhost:8777

Rows that only check an outside service (Scryfall, EDHTop16, Archidekt, Commander Spellbook) are reported as
warnings, since those sites can be down for a while. Everything else - the local server and every game row -
must pass. The four built-in decks are loaded from Scryfall, so the games need internet access.
"""
import argparse
import sys
import time

from playwright.sync_api import sync_playwright

OUTSIDE = ('Archidekt', 'EDHTop16', 'Scryfall (card data)', 'Commander Spellbook')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:8777')
    ap.add_argument('--timeout', type=int, default=600, help='seconds to wait for the self-test to finish')
    args = ap.parse_args()
    gh = '::warning::', '::error::'
    errors, warnings, console = [], [], []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on('console', lambda m: m.type == 'error' and console.append(m.text))
        page.on('pageerror', lambda e: console.append(str(e)))
        page.goto(args.url.rstrip('/') + '/selftest.html?run')
        deadline = time.time() + args.timeout
        while time.time() < deadline:
            summary = page.inner_text('#summary')
            if summary and 'Running' not in summary:
                break
            time.sleep(2)
        else:
            errors.append(f'The self-test did not finish within {args.timeout} s')
        rows = page.eval_on_selector_all(
            '#checks tr, #games tr', 'trs => trs.map(t => [...t.children].map(td => td.textContent.trim()))')
        browser.close()

    for name, status, detail in rows:
        print(f'{status:8} {name}  {detail}')
        if status == 'pass':
            continue
        msg = f'{name}: {status} {detail}'
        (warnings if any(name.startswith(o) or o in name for o in OUTSIDE) else errors).append(msg)
    for c in console:
        print(f'console error: {c}')
    print()
    print(f'Summary: {summary}')
    for w in warnings:
        print(gh[0] + 'Outside service (not a code problem): ' + w)
    for e in errors:
        print(gh[1] + e)
    if not rows:
        errors.append('No self-test rows were found')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
