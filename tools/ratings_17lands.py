"""Builds public/data/ratings/<SET>.json from 17Lands' public game data (developer tool; players never run it).

17Lands Public Data (https://www.17lands.com/public_datasets) is licensed under the Creative Commons Attribution
4.0 International License (https://creativecommons.org/licenses/by/4.0/). We compute our own summary from it: for
each card, the win rate of games where it was in the opening hand or drawn ("GIH WR") and how many such games there
were. Only the public datasets are used, never 17Lands' site or API (their terms of service don't allow reuse).

Usage:  py -I tools/ratings_17lands.py BLB DSK FDN [--games 150000]
The file is streamed and stops after --games games, so only part of it is downloaded.
"""
import argparse
import csv
import gzip
import json
import os
import sys
import time
import urllib.request

URL = 'https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.{set}.PremierDraft.csv.gz'
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'data', 'ratings')
MIN_GAMES = 200   # cards seen in fewer games than this get no rating
csv.field_size_limit(10_000_000)


def build(code, max_games):
    req = urllib.request.Request(URL.format(set=code), headers={'User-Agent': 'CommanderTable-ratings/1.0'})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as resp, gzip.open(resp, 'rt', encoding='utf-8', newline='') as f:
        rows = csv.reader(f)
        head = next(rows)
        won = head.index('won')
        names = sorted({h[len('opening_hand_'):] for h in head if h.startswith('opening_hand_')})
        cols = [(n, head.index('opening_hand_' + n), head.index('drawn_' + n)) for n in names if 'drawn_' + n in head]
        seen = {n: 0 for n in names}
        wins = {n: 0 for n in names}
        games = total_wins = 0
        for row in rows:
            w = row[won] == 'True'
            games += 1
            total_wins += w
            for n, oh, dr in cols:
                if row[oh] != '0' or row[dr] != '0':
                    seen[n] += 1
                    wins[n] += w
            if games >= max_games:
                break
    cards = {n: {'gihwr': round(wins[n] / seen[n], 4), 'games': seen[n]} for n in names if seen[n] >= MIN_GAMES}
    data = {
        'set': code, 'games': games, 'average': round(total_wins / max(1, games), 4), 'cards': cards,
        'source': '17Lands Public Data, ' + URL.format(set=code),
        'license': 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes: per-card win rate when in the opening hand or drawn, computed by Commander Table from the first %d games of the file.' % games,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, code + '.json'), 'w', encoding='utf-8') as out:
        json.dump(data, out, ensure_ascii=False, separators=(',', ':'))
    print(f'{code}: {games} games, {len(cards)} cards rated, {time.time() - t0:.0f} s')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sets', nargs='+')
    ap.add_argument('--games', type=int, default=150000)
    args = ap.parse_args()
    for code in args.sets:
        try:
            build(code.upper(), args.games)
        except Exception as e:
            print(f'{code}: failed ({e})', file=sys.stderr)


if __name__ == '__main__':
    main()
