"""Serves a pretend "newer release" on this computer, to see the update banner in a debug build.

Run it, then start the app with SPELUNKER_UPDATE_URL=http://127.0.0.1:8765/ (debug builds only),
then press Check for updates on the About tab, or start the app with no check in the last day.
"""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer

RELEASE = {
    "tag_name": "v9.9.9",
    "html_url": "https://github.com/TheEndless/spelunker/releases/tag/v9.9.9",
    "published_at": "2026-10-29T00:00:00Z",
    "draft": False,
    "prerelease": False,
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(RELEASE).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
