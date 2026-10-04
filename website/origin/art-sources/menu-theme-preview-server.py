from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from threading import Event
import json

ROOT = Path('/home/cabewse/work_space/sloom-studio-gpl/website')
QA = Path('/tmp/origin-menu-theme-qa')
gates = {}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        name = query.get('case', ['hero'])[0]
        if url.path == '/__gate':
            gates.setdefault(name, Event()).wait(40)
            self.send_response(200)
            self.send_header('Content-Type', 'image/gif')
            self.end_headers()
            self.wfile.write(bytes.fromhex('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b'))
            return
        if url.path in ['/origin/', '/origin/index.html'] and '__preview' in query:
            gates[name] = Event()
            script = (QA / 'theme-check.js').read_text()
            html = (ROOT / 'origin/index.html').read_text().replace('</body>', '<script>' + script + '</script><img src="/__gate?case=' + name + '" width="1" height="1" alt="" style="position:absolute;opacity:0"></body>')
            data = html.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()
    def do_POST(self):
        if urlsplit(self.path).path != '/__report':
            self.send_error(404)
            return
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        (QA / (data['name'] + '.json')).write_text(json.dumps(data, indent=2) + '\n')
        gates.setdefault(data['name'], Event()).set()
        self.send_response(204)
        self.end_headers()
        print(data['name'] + ': ' + ('PASS' if data.get('passed') else 'CHECK'), flush=True)
    def log_message(self, *args):
        pass

print('Main-menu theme preview 127.0.0.1:18872', flush=True)
ThreadingHTTPServer(('127.0.0.1', 18872), Handler).serve_forever()
