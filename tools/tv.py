#!/usr/bin/env python3
"""Talk to a rooted LG webOS TV: run shell commands as root and move files.

Commands go over SSH when root@<TV> accepts this computer's key, otherwise over Homebrew Channel's
telnet root shell. Files move over HTTP: FileServer serves a folder to the TV and takes uploads from
it, because both shells are slow for anything bigger than a few kilobytes.

    python3 tools/tv.py 192.168.1.50 'uname -a'
"""
import base64
import http.server
import os
import socket
import subprocess
import sys
import threading
import time
import uuid

IAC, DONT, DO, WONT, WILL, SB, SE = 255, 254, 253, 252, 251, 250, 240


def host_from_args(args):
    """The TV's address: the first argument that isn't an option, else $TV_HOST."""
    for a in args:
        if not a.startswith("-"):
            return a
    host = os.environ.get("TV_HOST")
    if not host:
        sys.exit("Give the TV's IP address, e.g. python3 %s 192.168.1.50" % os.path.basename(sys.argv[0]))
    return host


class TV:
    def __init__(self, host):
        self.host = host
        self._ssh = None

    # ---- shell ---------------------------------------------------------------------------------

    def use_ssh(self):
        if self._ssh is None:
            try:
                r = subprocess.run(
                    ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
                     "-o", "StrictHostKeyChecking=accept-new", "root@" + self.host, "true"],
                    capture_output=True, timeout=15)
                self._ssh = r.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                self._ssh = False
        return self._ssh

    def run(self, cmd, timeout=120):
        """Runs cmd with sh on the TV; returns (exit status, combined output)."""
        if self.use_ssh():
            r = subprocess.run(["ssh", "-o", "BatchMode=yes", "root@" + self.host, "sh -s"],
                               input=cmd.encode(), capture_output=True, timeout=timeout)
            return r.returncode, (r.stdout + r.stderr).decode(errors="replace")
        return self._telnet(cmd, timeout)

    def check(self, cmd, timeout=120):
        rc, out = self.run(cmd, timeout)
        if rc != 0:
            raise RuntimeError("TV command failed (%d): %s\n%s" % (rc, cmd.strip()[:200], out))
        return out

    def _telnet(self, cmd, timeout):
        tag = uuid.uuid4().hex
        s = socket.create_connection((self.host, 23), timeout=10)
        s.settimeout(1)
        time.sleep(0.8)
        try:
            self._negotiate(s, s.recv(65536))
        except socket.timeout:
            pass
        s.sendall(b"stty -echo 2>/dev/null\n")
        time.sleep(0.3)
        # The command travels base64-encoded, so the shell's prompt and echo can't interleave with
        # it, in lines well under the terminal's 4 KB line limit; a longer line hangs the shell.
        # The markers are split with '' so the echoed command never matches them.
        payload = base64.b64encode(cmd.encode()).decode()
        s.sendall(b"rm -f /tmp/.tvsh.b64\n")
        for i in range(0, len(payload), 1500):
            s.sendall(("printf %%s '%s' >> /tmp/.tvsh.b64\n" % payload[i:i + 1500]).encode())
            time.sleep(0.05)
        s.sendall(("echo BEGIN''%s; base64 -d /tmp/.tvsh.b64 > /tmp/.tvsh.sh; sh /tmp/.tvsh.sh 2>&1; "
                   "echo END''%s$?\n" % (tag, tag)).encode())
        buf, deadline = b"", time.time() + timeout
        begin, end = ("BEGIN" + tag).encode(), ("END" + tag).encode()
        while time.time() < deadline:
            try:
                chunk = s.recv(65536)
            except socket.timeout:
                continue
            if not chunk:
                break
            buf += self._negotiate(s, chunk)
            if end in buf.split(begin, 1)[-1]:
                time.sleep(0.2)
                break
        s.close()
        text = buf.decode(errors="replace").replace("\r", "")
        body = text.rsplit("BEGIN%s\n" % tag, 1)[-1]
        if "END" + tag not in body:
            return 124, body + "\n(timed out)"
        body, _, rc = body.rpartition("END" + tag)
        try:
            status = int(rc.strip().splitlines()[0])
        except (ValueError, IndexError):
            status = 1
        return status, body

    @staticmethod
    def _negotiate(sock, data):
        """Refuses every telnet option and returns the data without negotiation bytes."""
        out, i = bytearray(), 0
        while i < len(data):
            b = data[i]
            if b == IAC and i + 1 < len(data):
                cmd = data[i + 1]
                if cmd in (DO, DONT, WILL, WONT) and i + 2 < len(data):
                    sock.sendall(bytes([IAC, WONT if cmd in (DO, DONT) else DONT, data[i + 2]]))
                    i += 3
                    continue
                if cmd == SB:
                    j = data.find(bytes([IAC, SE]), i)
                    i = j + 2 if j != -1 else len(data)
                    continue
                i += 2
                continue
            out.append(b)
            i += 1
        return bytes(out)

    # ---- network -------------------------------------------------------------------------------

    def local_ip(self):
        """This computer's address on the TV's network."""
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((self.host, 9))
            return s.getsockname()[0]
        finally:
            s.close()


class FileServer:
    """Serves serve_dir to the TV over HTTP and stores PUT /up/<name> uploads in upload_dir.

        with FileServer(tv, serve_dir="build", upload_dir="/tmp/x") as fs:
            tv.run("curl -o /tmp/a.ipk %s/a.ipk" % fs.url)
    """

    def __init__(self, tv, serve_dir=None, upload_dir=None):
        self.tv, self.serve_dir, self.upload_dir = tv, serve_dir, upload_dir

    def __enter__(self):
        serve_dir, upload_dir = self.serve_dir, self.upload_dir

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw):
                super().__init__(*a, directory=serve_dir or os.getcwd(), **kw)

            def do_PUT(self):
                name = os.path.basename(self.path)
                if not upload_dir or not self.path.startswith("/up/") or not name:
                    self.send_error(404)
                    return
                n = int(self.headers.get("Content-Length", 0))
                with open(os.path.join(upload_dir, name), "wb") as f:
                    f.write(self.rfile.read(n))
                self.send_response(201)
                self.end_headers()


            def log_message(self, *a):
                pass

        ip = self.tv.local_ip()
        self.httpd = http.server.ThreadingHTTPServer((ip, 0), Handler)
        self.url = "http://%s:%d" % (ip, self.httpd.server_address[1])
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: tv.py <TV IP> '<shell command>'")
    rc, out = TV(sys.argv[1]).run(sys.argv[2])
    sys.stdout.write(out)
    sys.exit(rc)
