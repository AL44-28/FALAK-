"""FALAK local preview: standard-library static files, no simulation build."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        # Local edits should never be hidden behind an old main.js in cache.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    root = Path(__file__).resolve().parent / "site"
    if not (root / "index.html").is_file():
        raise SystemExit("FALAK: extract the complete project before opening preview.")
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(Handler, directory=str(root))
    )
    url = f"http://127.0.0.1:{server.server_port}/"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print("FALAK Mission Control:", url, flush=True)
    print("Static preview ready. No orbit calculations or package installs.", flush=True)
    print("Keep this window open. Press Ctrl+C to stop.", flush=True)
    try:
        if not webbrowser.open(url):
            print("Open the address above in your browser.", flush=True)
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
