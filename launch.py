#!/usr/bin/env python3
from pathlib import Path
from http.server import ThreadingHTTPServer
import subprocess, sys, threading, webbrowser
from server import Handler
URL='http://localhost:8080'
def show():
    if sys.platform=='darwin' and Path('/Applications/Google Chrome.app').exists():
        subprocess.Popen(['open','-a','Google Chrome',URL])
    else:
        webbrowser.open(URL)
try:
    server=ThreadingHTTPServer(('127.0.0.1',8080),Handler)
except OSError:
    print('Port 8080 is already in use. If SunSeek is running, open '+URL)
    sys.exit(1)
threading.Timer(.5,show).start()
print('SunSeek Ground Station: '+URL+' · Ctrl+C to stop',flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
