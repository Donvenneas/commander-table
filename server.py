#!/usr/bin/env python3
"""Commander Table - local server for Mac and Linux (works on Windows too).

The same endpoints as Commander Table.exe and server.ps1, using only Python's standard library
(Python 3.8 or newer, which macOS and most Linux systems already have):
  * the game itself, from public/
  * /api/fetch      deck-site proxy (those sites block browser requests)
  * /api/edhtop16   EDHTop16's public GraphQL API (its registered queries only)
  * /api/rules      the Comprehensive Rules from Wizards of the Coast, cached for a week
  * /api/img        Scryfall card images, kept in data/images for offline play
  * /api/imgcache   the image folder's size and its cap (data/image-cache-mb.txt; 400 MB unless changed)
  * /api/library    your deck library in data/decks
  * /api/update     updates, only when you ask, from an address you choose
  * /api/room/...   online seats for friends (on ports 8800-8820), plus the free Cloudflare tunnel
  * /api/exit       shuts the server down

Run:  python3 server.py           (opens the game in your browser; never Microsoft Edge)
      python3 server.py --no-browser --port 8777
"""
import argparse
import hashlib
import hmac
import io
import json
import os
import platform
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'public')
CACHE = os.path.join(HERE, 'cache')
DATA = os.path.join(HERE, 'data')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 CommanderTable/1.0'
ALLOWED_HOSTS = {
    'archidekt.com', 'www.archidekt.com',
    'api2.moxfield.com', 'api.moxfield.com', 'moxfield.com', 'www.moxfield.com',
    'www.mtggoldfish.com', 'mtggoldfish.com',
    'tappedout.net', 'deckstats.net',
    'magic.wizards.com', 'media.wizards.com',
    'cedh-decklist-database.com', 'www.cedh-decklist-database.com',
    'cubecobra.com', 'www.cubecobra.com',
}
MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
}
IMAGE_CACHE_MAX = 400 * 1024 * 1024


def get_remote(url, data=None, content_type=None, timeout=30):
    """(status, content type, body) for a GET, or a POST when data is given; HTTP errors are returned, not raised."""
    headers = {'User-Agent': UA, 'Accept': 'application/json, text/plain, text/html;q=0.9, */*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9'}
    if content_type:
        headers['Content-Type'] = content_type
    req = urllib.request.Request(url, data=data, headers=headers, method='POST' if data is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get('Content-Type') or 'application/octet-stream', r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Content-Type') or 'text/plain', e.read()


def rules():
    path, src_path = os.path.join(CACHE, 'MagicCompRules.txt'), os.path.join(CACHE, 'rules-source.txt')
    # (written by the Windows servers too, sometimes with a byte-order mark and CRLF)
    source = open(src_path, encoding='utf-8-sig').read().strip() if os.path.exists(src_path) else ''
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 7 * 86400:
        return open(path, 'rb').read(), source
    try:
        _, _, page = get_remote('https://magic.wizards.com/en/rules')
        m = re.search(r'https://media\.wizards\.com/[^"\'<>]+?\.txt', page.decode('utf-8', 'replace'))
        if not m:
            raise RuntimeError('Could not find the Comprehensive Rules .txt link on magic.wizards.com/en/rules')
        url = m.group(0).replace(' ', '%20')
        status, _, body = get_remote(url)
        if status != 200:
            raise RuntimeError(f'Rules download failed with HTTP {status}')
        os.makedirs(CACHE, exist_ok=True)
        open(path, 'wb').write(body)
        open(src_path, 'w', encoding='utf-8').write(url)
        return body, url
    except Exception:
        if os.path.exists(path):
            return open(path, 'rb').read(), source
        raise


def js(s):
    return json.dumps(s if s is not None else '')


# ---------- online seats: the game runs in the host's browser; friends poll their view and post answers
class Seat:
    def __init__(self):
        self.state, self.question, self.answer, self.name = 'null', 'null', None, ''
        self.seen, self.last_chat, self.undo_ask, self.undo_reply, self.deck = 0.0, 0.0, 0.0, None, None
        self.key = seat_key()


# Each seat (and the spectators' view) has its own secret join code, so a friend can't open another
# seat's view (and see that hand) by changing the seat number in their link. 10 characters from 32
# letters and digits (no 0/O, 1/I) is about 50 bits; wrong codes are also limited to 30 a minute.
KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
MAX_FAILS = 30


def seat_key():
    return ''.join(secrets.choice(KEY_CHARS) for _ in range(10))


ROOM_LOCK = threading.Lock()
ROOM = {'code': None, 'seats': {}, 'chat': [], 'chat_id': 0, 'fails': []}
LAN = {'server': None, 'port': 0}
TUNNEL = {'status': 'off', 'url': '', 'error': '', 'proc': None}


def local_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))   # no packet is sent; this just picks the outgoing interface
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith('127.') and not ip.startswith('169.254.'))


def room(method, action, seat, code, body, local):
    """(status, json text)"""
    with ROOM_LOCK:
        if action in ('view', 'hello') or (action in ('answer', 'chat', 'undo', 'deck') and method == 'POST'):
            s = ROOM['seats'].get(seat)
            if ROOM['code'] is None or s is None or not hmac.compare_digest((code or '').upper(), s.key):
                now = time.time()
                ROOM['fails'] = [t for t in ROOM['fails'] if now - t < 60] + [now]
                if len(ROOM['fails']) > MAX_FAILS:
                    return 429, '{"error":"Too many wrong join codes. Wait a minute and try again."}'
                return 403, '{"error":"This game isn\'t open, or the link is out of date."}'
            if seat >= 0:
                s.seen = time.time()
            if action == 'view':
                reply, s.undo_reply = s.undo_reply, None
                return 200, '{"state":%s,"question":%s,"undoReply":%s}' % (s.state, s.question, json.dumps(reply))
            if action == 'undo':
                if seat >= 0:
                    s.undo_ask, s.undo_reply = time.time(), None
                return 200, '{}'
            if action == 'deck':   # lobby: the friend's own deck
                if seat >= 0 and len(body) <= 200000:
                    s.deck = body
                return 200, '{}'
            if action == 'hello':
                if seat >= 0:
                    s.name = body[:40]
                return 200, '{}'
            if action == 'chat':
                if time.time() - s.last_chat < 1:
                    return 429, '{"error":"Slow down"}'
                s.last_chat = time.time()
                who, _, text = body.partition('\n') if '\n' in body else ('', '', body)
                clean = lambda t: re.sub(r'[\x00-\x1f]', ' ', t)
                text = clean(text).strip()[:200]
                if text:
                    ROOM['chat_id'] += 1
                    ROOM['chat'].append({'id': ROOM['chat_id'], 'seat': seat, 'name': clean(who)[:24], 'text': text})
                    del ROOM['chat'][:-50]
                return 200, '{}'
            s.answer = body
            return 200, '{}'
        if not local:
            return 403, '{"error":"Only the host can do that."}'
        if action == 'open':
            if not start_lan():
                return 500, '{"error":"Couldn\'t open a port for other players (8800-8820 are busy)."}'
            ROOM['code'] = uuid.uuid4().hex[:6].upper()   # the open room's id; seats join with their own keys
            ROOM['seats'] = {}
            ROOM['chat'] = []
            ROOM['fails'] = []
            for part in body.split(','):
                # ("seat" or "seat=KEY": a resumed game reopens its room with the same keys, so friends' links still work)
                num, _, key = part.strip().partition('=')
                try:
                    seat = Seat()
                    if len(key) == 10 and all(ch in KEY_CHARS for ch in key):
                        seat.key = key
                    ROOM['seats'][int(num)] = seat
                except ValueError:
                    pass
            keys = {str(k): v.key for k, v in ROOM['seats'].items()}
            return 200, json.dumps({'code': ROOM['code'], 'keys': keys, 'port': LAN['port'], 'ips': local_ips()})
        if action == 'close':
            ROOM['code'] = None
            ROOM['seats'].clear()
            ROOM['chat'].clear()
            return 200, '{}'
        if action == 'tunnel':
            if method == 'POST':
                start_tunnel()
            return 200, json.dumps({'status': TUNNEL['status'], 'url': TUNNEL['url'], 'error': TUNNEL['error']})
        if action == 'rekey':
            # (hand a seat to someone else: a new key, so the old link stops working)
            s = ROOM['seats'].get(seat)
            if not s:
                return 404, '{"error":"No such seat."}'
            s.key, s.name, s.seen, s.answer = seat_key(), '', 0.0, None
            return 200, json.dumps({'key': s.key})
        if action == 'state':
            if seat in ROOM['seats']:
                ROOM['seats'][seat].state = body or 'null'
            return 200, '{}'
        if action == 'deck':
            s = ROOM['seats'].get(seat)
            d, s.deck = (s.deck, None) if s else (None, None)
            return 200, d or ''
        if action == 'undoack':
            if seat in ROOM['seats']:
                ROOM['seats'][seat].undo_ask, ROOM['seats'][seat].undo_reply = 0.0, 'allowed' if body == 'yes' else 'declined'
            return 200, '{}'
        if action == 'ask':
            if seat in ROOM['seats']:
                ROOM['seats'][seat].question, ROOM['seats'][seat].answer = body or 'null', None
            return 200, '{}'
        if action == 'answer':
            s = ROOM['seats'].get(seat)
            if not s or s.answer is None:
                return 200, 'null'
            a, s.answer = s.answer, None
            return 200, a
        if action == 'status':
            return 200, json.dumps({str(k): {'name': v.name, 'seen': -1 if not v.seen else int(time.time() - v.seen),
                                             'undo': -1 if not v.undo_ask else int(time.time() - v.undo_ask),
                                             'deck': v.deck is not None} for k, v in ROOM['seats'].items() if k >= 0})
        if action == 'chat':   # host: messages newer than ?seat=<last id>
            return 200, json.dumps([c for c in ROOM['chat'] if c['id'] > seat])
    return 404, '{"error":"unknown"}'


def cloudflared_path():
    found = shutil.which('cloudflared')
    if found:
        return found
    return os.path.join(DATA, 'cloudflared.exe' if os.name == 'nt' else 'cloudflared')


def download_cloudflared(target):
    """Cloudflare's official tool from its GitHub releases (only when you start internet play)."""
    system, machine = platform.system().lower(), platform.machine().lower()
    arch = 'arm64' if machine in ('arm64', 'aarch64') else 'amd64'
    base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/'
    if system == 'darwin':
        status, _, body = get_remote(base + f'cloudflared-darwin-{arch}.tgz', timeout=300)
        if status != 200:
            raise RuntimeError(f'Download failed (HTTP {status})')
        with tarfile.open(fileobj=io.BytesIO(body)) as t:
            member = next(m for m in t.getmembers() if os.path.basename(m.name) == 'cloudflared' and m.isfile())
            data = t.extractfile(member).read()
    else:
        name = 'cloudflared-windows-amd64.exe' if system == 'windows' else f'cloudflared-linux-{arch}'
        status, _, data = get_remote(base + name, timeout=300)
        if status != 200:
            raise RuntimeError(f'Download failed (HTTP {status})')
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'wb') as f:
        f.write(data)
    os.chmod(target, os.stat(target).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def start_tunnel():
    p = TUNNEL['proc']
    if TUNNEL['status'] in ('starting', 'downloading') or (TUNNEL['status'] == 'on' and p and p.poll() is None):
        return
    if not LAN['server']:
        TUNNEL.update(status='error', error='Open a game with an online seat first.')
        return
    TUNNEL.update(error='', url='')

    def run():
        try:
            exe = cloudflared_path()
            if not os.path.exists(exe):
                TUNNEL['status'] = 'downloading'
                download_cloudflared(exe)
            TUNNEL['status'] = 'starting'
            proc = subprocess.Popen([exe, 'tunnel', '--no-autoupdate', '--url', f'http://localhost:{LAN["port"]}'],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
            TUNNEL['proc'] = proc
            found = re.compile(r'https://[a-z0-9-]+\.trycloudflare\.com')

            def watch():
                for line in proc.stdout:
                    m = found.search(line)
                    if m and TUNNEL['status'] != 'on':
                        TUNNEL.update(url=m.group(0), status='on')
                if not QUITTING.is_set():
                    TUNNEL.update(status='error', error='The internet tunnel stopped. Try again.')
            threading.Thread(target=watch, daemon=True).start()
            for _ in range(60):
                if TUNNEL['status'] != 'starting':
                    break
                time.sleep(0.5)
            if TUNNEL['status'] == 'starting':
                TUNNEL.update(status='error', error="Cloudflare didn't hand out an address in time. Check your internet connection and try again.")
                proc.kill()
        except Exception as e:
            TUNNEL.update(status='error', error=str(e))
    threading.Thread(target=run, daemon=True).start()


# ---------- deck library, image cache, updates
def safe_name(name):
    name = re.sub(r"[^\w ,.'&+()-]", '', name or '').strip().lstrip('.')
    return name[:80]


def card_image(url):
    """(status, type, body) for a Scryfall image, from data/images when it was downloaded before."""
    u = urllib.parse.urlparse(url or '')
    if u.scheme != 'https' or u.hostname not in ('cards.scryfall.io', 'svgs.scryfall.io'):
        return 400, 'text/plain; charset=utf-8', b'Only Scryfall card images are served here.'
    ext = os.path.splitext(u.path)[1].lower()
    ctype = MIME.get(ext, '')
    if not ctype.startswith('image/'):
        ext, ctype = '.jpg', 'image/jpeg'
    folder = os.path.join(DATA, 'images')
    path = os.path.join(folder, hashlib.sha1(url.encode('utf-8')).hexdigest() + ext)
    if os.path.exists(path):
        return 200, ctype, open(path, 'rb').read()
    status, rtype, body = get_remote(url)
    if status == 200 and body:
        try:
            os.makedirs(folder, exist_ok=True)
            open(path, 'wb').write(body)
            trim_images(folder)
        except OSError:
            pass
        return 200, rtype if rtype.startswith('image/') else ctype, body
    return status, rtype, body


_trim_count = [0]


def image_cap():
    """The image folder's cap in bytes: data/image-cache-mb.txt (set in the app), else 400 MB."""
    try:
        mb = int(open(os.path.join(DATA, 'image-cache-mb.txt'), encoding='utf-8').read().strip())
        return max(100, min(20000, mb)) * 1024 * 1024
    except (OSError, ValueError):
        return IMAGE_CACHE_MAX


def image_usage():
    folder = os.path.join(DATA, 'images')
    files = [os.path.join(folder, f) for f in os.listdir(folder)] if os.path.isdir(folder) else []
    return len(files), sum(os.path.getsize(f) for f in files)


def trim_images(folder):
    _trim_count[0] += 1
    if _trim_count[0] % 200:
        return
    cap = image_cap()
    files = [os.path.join(folder, f) for f in os.listdir(folder)]
    total = sum(os.path.getsize(f) for f in files)
    if total <= cap:
        return
    for f in sorted(files, key=os.path.getmtime):
        if total <= cap * 0.8:
            break
        total -= os.path.getsize(f)
        try:
            os.remove(f)
        except OSError:
            pass


def local_version():
    p = os.path.join(HERE, 'VERSION')
    return open(p, encoding='utf-8').read().strip() if os.path.exists(p) else 'unknown'


def inspect_update(path):
    """(prefix, version, count) or raises ValueError with a message for the user."""
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise ValueError(f"That zip couldn't be read: {e}")
    with z:
        names = [n.replace('\\', '/') for n in z.namelist()]
        hits = sorted((n for n in names if n.endswith('public/index.html')), key=len)
        if not hits:
            raise ValueError("That zip doesn't look like Commander Table (no public/index.html in it).")
        prefix = hits[0][:-len('public/index.html')]
        if prefix.count('/') > 1:
            raise ValueError("That zip doesn't look like Commander Table.")
        files = [n for n in names if n.startswith(prefix) and not n.endswith('/') and not n[len(prefix):].startswith('data/')]
        if any('../' in n or ':' in n for n in files):
            raise ValueError('That zip contains unsafe file paths, so it was not used.')
        version = z.read(prefix + 'VERSION').decode('utf-8', 'replace').strip() if prefix + 'VERSION' in names else 'unknown'
        return prefix, version, len(files)


def apply_update(path):
    prefix, _, _ = inspect_update(path)
    backup = os.path.join(DATA, 'update', 'backup-' + time.strftime('%Y%m%d-%H%M%S'))
    root = os.path.realpath(HERE)
    changed = 0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = info.filename.replace('\\', '/')
            if not name.startswith(prefix) or name.endswith('/'):
                continue
            rel = name[len(prefix):]
            if not rel or rel.startswith('data/'):
                continue
            target = os.path.realpath(os.path.join(root, *rel.split('/')))
            if not target.startswith(root + os.sep):
                continue
            data = z.read(info)
            if os.path.exists(target):
                old = open(target, 'rb').read()
                if old == data:
                    continue
                b = os.path.join(backup, *rel.split('/'))
                os.makedirs(os.path.dirname(b), exist_ok=True)
                open(b, 'wb').write(old)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            try:
                open(target, 'wb').write(data)
                changed += 1
            except OSError:
                print(f'Skipped {rel} (in use)')
    os.remove(path)
    return changed, (os.path.relpath(backup, HERE) if changed else '')


# ---------- HTTP
QUITTING = threading.Event()


class Handler(BaseHTTPRequestHandler):
    server_version = 'CommanderTable'
    local = True     # the main server (this computer only); the friends' server overrides this

    def log_message(self, fmt, *args):
        pass

    def send(self, status, ctype, body, headers=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (headers or {}).items():
            self.send_header(k, re.sub(r'[^\x20-\x7e]', '', str(v)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def text(self, status, msg):
        self.send(status, 'text/plain; charset=utf-8', msg)

    def body(self):
        n = min(int(self.headers.get('Content-Length') or 0), 2 * 1024 * 1024)
        return self.rfile.read(n).decode('utf-8', 'replace') if n > 0 else ''

    def do_GET(self):
        self.route()

    def do_POST(self):
        self.route()

    def do_DELETE(self):
        self.route()

    def do_HEAD(self):
        self.route()

    def foreign(self, api):
        """True when a request to this computer's own server didn't come from the game's own page:
        a Host header other than localhost (DNS rebinding), or, for /api/ calls, another website's page
        (cross-site requests; the browser marks them with Origin and Sec-Fetch-Site)."""
        port = self.server.server_address[1]
        ours = (f'localhost:{port}', f'127.0.0.1:{port}')
        if (self.headers.get('Host') or '').lower() not in ours:
            return True
        if not api:
            return False
        origin = (self.headers.get('Origin') or '').lower()
        if origin and origin not in ['http://' + o for o in ours]:
            return True
        return (self.headers.get('Sec-Fetch-Site') or '').lower() in ('cross-site', 'same-site')

    def route(self):
        url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(url.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        if self.local and self.foreign(path.startswith('/api/')):
            return self.text(403, 'Only the Commander Table page on this computer can use this.')
        try:
            if path.startswith('/api/room/'):
                try:
                    seat = int(q.get('seat', '0'))
                except ValueError:
                    seat = 0
                status, out = room(self.command, path[len('/api/room/'):], seat, q.get('code'), self.body(), self.local)
                return self.send(status, 'application/json', out)
            if not self.local:
                return self.serve_friend_file(path)
            if path == '/api/fetch':
                u = urllib.parse.urlparse(q.get('url', ''))
                if u.scheme != 'https' or (u.hostname or '').lower() not in ALLOWED_HOSTS:
                    return self.text(400, 'That URL is not on the allowed deck-site list.')
                status, ctype, body = get_remote(q['url'])
                return self.send(status, ctype, body, {'X-Upstream-Status': str(status)})
            if path == '/api/edhtop16' and self.command == 'POST':
                status, ctype, body = get_remote('https://edhtop16.com/api/graphql', self.body().encode('utf-8'), 'application/json')
                return self.send(status, 'application/json', body)
            if path == '/api/rules':
                body, source = rules()
                return self.send(200, 'text/plain', body, {'X-Rules-Source': source})
            if path == '/api/img':
                status, ctype, body = card_image(q.get('u'))
                return self.send(status, ctype, body, {'Cache-Control': 'public, max-age=2592000'} if status == 200 else None)
            if path == '/api/imgcache':
                # GET: how much the image folder holds; POST (from the app only) a new cap in MB
                if self.command == 'POST':
                    if self.headers.get('X-Commander-Table') != 'images':
                        return self.text(400, 'Use the Updates window in the app.')
                    try:
                        mb = max(100, min(20000, int(self.body().strip())))
                    except ValueError:
                        return self.text(400, 'The cap is a number of MB.')
                    os.makedirs(DATA, exist_ok=True)
                    open(os.path.join(DATA, 'image-cache-mb.txt'), 'w', encoding='utf-8').write(str(mb))
                n, size = image_usage()
                return self.send(200, 'application/json', json.dumps({'files': n, 'bytes': size, 'capMB': image_cap() // (1024 * 1024)}))
            if path == '/api/library':
                return self.library(q)
            if path == '/api/update':
                return self.update(q)
            if path == '/api/exit':
                # The custom header forces a CORS preflight, so other websites can't shut the server down
                if self.command != 'POST' or self.headers.get('X-Commander-Table') != 'exit':
                    return self.text(400, 'Use the Exit button in the app.')
                self.text(200, 'Commander Table has shut down.')
                QUITTING.set()
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            return self.serve_file(path)
        except Exception as e:
            try:
                self.text(502, str(e))
            except OSError:
                pass

    def serve_file(self, path, root=ROOT):
        if path == '/':
            path = '/index.html'
        full = os.path.realpath(os.path.join(root, *path.lstrip('/').split('/')))
        if not full.startswith(os.path.realpath(root) + os.sep) or not os.path.isfile(full):
            return self.text(404, 'Not found')
        self.send(200, MIME.get(os.path.splitext(full)[1].lower(), 'application/octet-stream'), open(full, 'rb').read())

    def serve_friend_file(self, path):
        # Friends only get the join page and the files it uses, never the host's own page or other endpoints
        if path == '/':
            path = '/play.html'
        if path.startswith('/api/') or path == '/index.html':
            return self.text(404, 'Not found')
        return self.serve_file(path)

    def library(self, q):
        folder = os.path.join(DATA, 'decks')
        if self.command == 'GET':
            items = []
            if os.path.isdir(folder):
                for f in sorted(os.listdir(folder)):
                    if f.endswith('.txt'):
                        p = os.path.join(folder, f)
                        items.append({'name': f[:-4], 'modified': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(os.path.getmtime(p))),
                                      'text': open(p, encoding='utf-8', errors='replace').read()})
            return self.send(200, 'application/json', json.dumps(items))
        # The custom header forces a CORS preflight, so other websites can't change the library
        if self.headers.get('X-Commander-Table') != 'library':
            return self.text(400, 'Use the deck library in the app.')
        name = safe_name(q.get('name'))
        if not name:
            return self.text(400, 'The deck needs a name.')
        path = os.path.join(folder, name + '.txt')
        if self.command == 'POST':
            body = self.body()
            if len(body) > 200000:
                return self.text(400, 'That decklist is too long.')
            os.makedirs(folder, exist_ok=True)
            open(path, 'w', encoding='utf-8').write(body)
            return self.send(200, 'application/json', json.dumps({'name': name}))
        if self.command == 'DELETE':
            if os.path.exists(path):
                os.remove(path)
            return self.send(200, 'application/json', '{}')
        return self.text(405, 'Use GET, POST or DELETE.')

    def update(self, q):
        folder = os.path.join(DATA, 'update')
        url_file, zip_file = os.path.join(folder, 'source-url.txt'), os.path.join(folder, 'download.zip')
        if self.command == 'GET':
            saved = open(url_file, encoding='utf-8').read().strip() if os.path.exists(url_file) else ''
            return self.send(200, 'application/json', json.dumps({'version': local_version(), 'url': saved}))
        if self.command != 'POST' or self.headers.get('X-Commander-Table') != 'update':
            return self.text(400, 'Use the Updates window in the app.')
        step = q.get('step')
        try:
            if step == 'check':
                url = self.body().strip()
                if urllib.parse.urlparse(url).scheme != 'https':
                    return self.text(400, 'The update address must start with https://')
                os.makedirs(folder, exist_ok=True)
                open(url_file, 'w', encoding='utf-8').write(url)
                status, _, body = get_remote(url, timeout=300)
                if status != 200:
                    return self.text(502, f'The update address answered HTTP {status}.')
                if body[:2] != b'PK':
                    return self.text(400, "That address didn't give a .zip file.")
                open(zip_file, 'wb').write(body)
                try:
                    _, version, count = inspect_update(zip_file)
                except ValueError:
                    os.remove(zip_file)
                    raise
                return self.send(200, 'application/json', json.dumps({'version': version, 'current': local_version(), 'files': count, 'size': len(body)}))
            if step == 'apply':
                if not os.path.exists(zip_file):
                    return self.text(400, 'Check for an update first.')
                changed, backup = apply_update(zip_file)
                return self.send(200, 'application/json', json.dumps({'changed': changed, 'version': local_version(), 'backup': backup}))
        except ValueError as e:
            return self.text(400, str(e))
        return self.text(400, 'Unknown step.')


class FriendHandler(Handler):
    local = False


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def start_lan():
    if LAN['server']:
        return True
    for port in range(8800, 8821):
        try:
            srv = Server(('0.0.0.0', port), FriendHandler)
        except OSError:
            continue
        LAN.update(server=srv, port=port)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return True
    return False


# ---------- opening the game in a browser (any browser except Microsoft Edge)
def open_browser(url):
    system = platform.system()
    candidates = []
    if system == 'Darwin':
        for app in ('Google Chrome', 'Firefox', 'Brave Browser', 'Vivaldi', 'Chromium', 'Safari'):
            if os.path.isdir(f'/Applications/{app}.app') or os.path.isdir(os.path.expanduser(f'~/Applications/{app}.app')):
                candidates.append(['open', '-a', app, url])
    elif system == 'Windows':
        for p in (r'%ProgramFiles%\Google\Chrome\Application\chrome.exe', r'%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe',
                  r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe', r'%ProgramFiles%\Mozilla Firefox\firefox.exe',
                  r'%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe'):
            p = os.path.expandvars(p)
            if os.path.exists(p):
                candidates.append([p, url])
    else:
        default = ''
        try:
            default = subprocess.run(['xdg-settings', 'get', 'default-web-browser'], capture_output=True, text=True, timeout=5).stdout.lower()
        except (OSError, subprocess.SubprocessError):
            pass
        if default and 'edge' not in default and shutil.which('xdg-open'):
            candidates.append(['xdg-open', url])
        for exe in ('firefox', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser', 'vivaldi'):
            if shutil.which(exe):
                candidates.append([exe, url])
    for cmd in candidates:
        try:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except OSError:
            continue
    print(f'  Open {url} in any web browser other than Microsoft Edge.')
    return False


def self_check():
    """What this computer has for Commander Table, in plain words. Returns True when it can run."""
    ok = True
    def line(good, text, fix=''):
        print(f"  [{'ok' if good else '!!'}] {text}" + (f"\n       {fix}" if fix and not good else ''))
    print(f'\nCommander Table self-check ({platform.system()} {platform.release()}, Python {platform.python_version()})\n')
    good = sys.version_info >= (3, 8)
    line(good, 'Python 3.8 or newer', 'Install a newer Python (python.org, or your package manager), then run start.sh again.')
    ok &= good
    good = os.path.isfile(os.path.join(ROOT, 'index.html'))
    line(good, 'Game files found (public/index.html)', 'Keep server.py inside the Commander Table folder, next to "public".')
    ok &= good
    try:
        os.makedirs(DATA, exist_ok=True)
        probe = os.path.join(DATA, '.write-test')
        open(probe, 'w').close()
        os.remove(probe)
        line(True, 'The data folder can be written (deck library, card images, updates)')
    except OSError:
        line(False, 'The data folder can be written', 'The folder is read-only: the game runs, but your library, card images and updates are not saved. Copy the folder somewhere writable.')
    free = None
    for port in range(8777, 8791):
        try:
            s = socket.socket(); s.bind(('127.0.0.1', port)); s.close(); free = port; break
        except OSError:
            continue
    line(free is not None, f'A free port for the game ({free})' if free else 'A free port for the game (8777-8790)', 'Close other copies of Commander Table, or start with --port <number>.')
    ok &= free is not None
    lan = None
    for port in range(8800, 8821):
        try:
            s = socket.socket(); s.bind(('0.0.0.0', port)); s.close(); lan = port; break
        except OSError:
            continue
    line(lan is not None, f'A free port for friends on your network ({lan})' if lan else 'A free port for friends (8800-8820)', 'Online seats need one of these ports. A firewall may also need to allow it.')
    browsers = [b for b in ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'firefox', 'brave-browser', 'vivaldi') if shutil.which(b)]
    if platform.system() == 'Darwin':
        browsers = [a for a in ('Google Chrome', 'Firefox', 'Brave Browser', 'Vivaldi', 'Chromium', 'Safari') if os.path.isdir(f'/Applications/{a}.app')]
    elif platform.system() == 'Windows':
        paths = {'Chrome': r'%ProgramFiles%\Google\Chrome\Application\chrome.exe', 'Chrome (x86)': r'%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe',
                 'Chrome (user)': r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe', 'Firefox': r'%ProgramFiles%\Mozilla Firefox\firefox.exe',
                 'Brave': r'%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe'}
        browsers = [n for n, p in paths.items() if os.path.exists(os.path.expandvars(p))]
    line(bool(browsers), f"A browser to open the game in ({', '.join(browsers[:3])})" if browsers else 'A browser to open the game in',
         'Open the address it prints in any browser other than Microsoft Edge.')
    cf = shutil.which('cloudflared') or (os.path.exists(cloudflared_path()) and cloudflared_path())
    line(True, 'Internet play: ' + ('cloudflared is ready' if cf else 'cloudflared will be downloaded from Cloudflare the first time you use it'))
    try:
        socket.create_connection(('api.scryfall.com', 443), timeout=5).close()
        line(True, 'Internet connection (Scryfall reachable)')
    except OSError:
        line(False, 'Internet connection (Scryfall reachable)', 'Without internet, only decks loaded before (and their saved card images) work.')
    print('\n  ' + ('Everything needed is here. Start the game with: sh start.sh' if ok else 'Fix the items marked !! above, then try again.') + '\n')
    return ok


def main():
    ap = argparse.ArgumentParser(description='Commander Table local server')
    ap.add_argument('--port', type=int, default=0, help='port for the game (default: first free one from 8777)')
    ap.add_argument('--no-browser', action='store_true', help="don't open a browser window")
    ap.add_argument('--check', action='store_true', help='check this computer for what the game needs, then exit')
    args = ap.parse_args()
    if args.check:
        sys.exit(0 if self_check() else 1)
    if not os.path.isdir(ROOT):
        sys.exit('The "public" folder was not found next to server.py. Keep this file in the Commander Table folder.')
    for d in (CACHE, DATA):
        try:
            os.makedirs(d, exist_ok=True)
        except OSError:
            pass
    srv = None
    for port in ([args.port] if args.port else range(8777, 8791)):
        try:
            srv = Server(('127.0.0.1', port), Handler)
            break
        except OSError:
            continue
    if not srv:
        sys.exit('No free port between 8777 and 8790. Is Commander Table already running?')
    url = f'http://localhost:{srv.server_address[1]}/'
    print(f'\n  Commander Table is running at {url}\n  Press Ctrl+C to stop.\n')
    if not args.no_browser:
        open_browser(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        QUITTING.set()
        p = TUNNEL['proc']
        if p and p.poll() is None:
            p.terminate()
        if LAN['server']:
            LAN['server'].shutdown()
        srv.server_close()


if __name__ == '__main__':
    main()
