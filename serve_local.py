"""Serve only the derived offline build on loopback, without an API or uploads."""
import argparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import webbrowser
from scripts.prepare_client import PreparationError, prepare_client

ROOT = Path(__file__).resolve().parent / 'offline_web'

class LocalHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        target=Path(self.translate_path(self.path))
        if not target.is_relative_to(ROOT):
            self.send_error(403); return None
        for part in [target, *target.parents]:
            if part.exists() and (part.is_symlink() or getattr(part.stat(), 'st_file_attributes', 0)&0x400):
                self.send_error(403); return None
            if part==ROOT: break
        if target.is_dir() and not (target/'index.html').is_file():
            self.send_error(404); return None
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'")
        super().end_headers()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--open',action='store_true',help='Open the local page after binding the server')
    args=parser.parse_args()
    try:
        prepared = prepare_client()
    except (PreparationError, OSError) as error:
        raise SystemExit(f'Asset preparation failed: {error}') from error
    print(f'Assets verified: {prepared["verified"]}; restored: {prepared["restored"]}',flush=True)
    if not (ROOT/'index.html').is_file(): raise SystemExit('Build offline_web first')
    server=ThreadingHTTPServer(('127.0.0.1',args.port),LocalHandler)
    print(f'REA PokéBonk local: http://127.0.0.1:{args.port}/?lang=zh',flush=True)
    if args.open: webbrowser.open(f'http://127.0.0.1:{args.port}/?lang=zh')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
