#!/usr/bin/env python3
"""Games for the menu's Games channel: RetroArch with the mGBA core, and your Game Boy, Game Boy Color
and Game Boy Advance games. Use only games you own.

    python3 tools/games.py 192.168.1.50 --setup
    python3 tools/games.py 192.168.1.50 add "My game.gba" [--title "My game"] [--color "#E8432E"]
                                                          [--cover picture.png]
    python3 tools/games.py 192.168.1.50 --list
    python3 tools/games.py 192.168.1.50 remove "My game" [--delete]

--setup installs RetroArch from the Homebrew Channel repository when it is missing (checking its published
SHA-256), the mGBA core from webosbrew's core server (checking its CRC32), a launch script that lets the
menu start a game, and settings for the TV remote. Run it again after RetroArch updates, which replace the
launch script. The games go to RetroArch's folder on the TV with a list the menu reads.

add also fetches the game's box art from libretro's thumbnail server, the one RetroArch uses, by the
file's name as in the No-Intro sets ("Game (USA).gba"); --cover gives your own image instead. Covers go
on the cartridge's label and, large, on the channel's shelf screen.
"""
import base64
import hashlib
import io
import json
import os
import re
import shutil
import struct
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tv import TV, FileServer, host_from_args  # noqa: E402

APP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
MENU_ID = "org.wiiwebos.menu"
MENU_DIR = "/media/developer/apps/usr/palm/applications/" + MENU_ID
RA_ID = "com.retroarch.webos"
RA = "/media/developer/apps/usr/palm/applications/" + RA_ID
CFG_DIR = RA + "/.config/retroarch"
CFG = CFG_DIR + "/retroarch.cfg"
ROMS = CFG_DIR + "/roms"
CORES = CFG_DIR + "/cores"
LIST = ROMS + "/games.json"
COVERS = ROMS + "/covers"
THUMBS = "https://thumbnails.libretro.com/"
THUMB_SYSTEMS = {".gba": "Nintendo - Game Boy Advance", ".gbc": "Nintendo - Game Boy Color",
                 ".gb": "Nintendo - Game Boy"}
COVER_SIDE = 360   # enough for the shelf's large cover; decoded, it stays near half a megabyte on the TV
REPO_API = "https://repo.webosbrew.org/api/apps.json"
CORE_SERVER = "http://retroarch-cores.webosbrew.org/armv7a/"
CORE = "mgba"
SYSTEMS = {".gba": "Game Boy Advance", ".gbc": "Game Boy Color", ".gb": "Game Boy"}
PALETTE = ["#E8432E", "#2F7DE1", "#3FA34D", "#F29D16", "#8E5BD8", "#16A9A4", "#E5508C"]

# The TV remote as wii-tv maps it: OK=A, Back=B, Red=Start, Green=Select, Yellow=L, Blue=R. RetroArch's
# webOS port sends Back as backspace (a single tap, so B can't be held) and the colour buttons as x/z/s/a.
SETTINGS = [
    ("input_player1_a", "enter"),
    ("input_player1_b", "backspace"),
    ("input_player1_start", "x"),
    ("input_player1_select", "z"),
    ("input_player1_l", "s"),
    ("input_player1_r", "a"),
    ("input_player1_x", "nul"),
    ("input_player1_y", "nul"),
    ("input_player1_gun_start", "nul"),
    ("input_menu_toggle_gamepad_combo", "7"),   # hold Start (red) two seconds for RetroArch's menu
    ("autosave_interval", "10"),                # in-game saves reach the file every ten seconds
    ("video_threaded", "true"),                 # steady frames; without it the sound crackles
    ("audio_latency", "128"),
    ("statistics_show", "false"),
    ("fps_show", "false"),
    ("rgui_browser_directory", ROMS),
]

# The menu starts a game by launching RetroArch with {"core": ..., "rom": ...}, which arrive as JSON in $1.
WRAPPER = r'''#!/bin/sh
# Installed by wii-webos (tools/games.py --setup) so the menu can start a game. The app manager passes
# launch parameters as JSON in $1; {"core": "<core .so>", "rom": "<game>"} starts that game, anything else
# opens RetroArch as usual. To remove it: mv retroarch.bin retroarch
DIR=$(dirname "$0")
core=$(echo "$1" | sed -n 's/.*"core" *: *"\([^"]*\)".*/\1/p')
rom=$(echo "$1" | sed -n 's/.*"rom" *: *"\([^"]*\)".*/\1/p')
if [ -n "$core" ] && [ -n "$rom" ]; then
  exec "$DIR/retroarch.bin" -L "$core" "$rom"
fi
exec "$DIR/retroarch.bin" "$@"
'''


def fetch(url, timeout=120):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def put_text(tv, path, text):
    tv.check("echo %s | base64 -d > '%s'" % (base64.b64encode(text.encode()).decode(), path))


def owner(tv):
    return tv.check("stat -c %%u:%%g %s" % CFG_DIR).strip()


def ra_installed(tv):
    rc, _ = tv.run("[ -e %s/retroarch ] || [ -e %s/retroarch.bin ]" % (RA, RA))
    return rc == 0


def wait_closed(tv):
    tv.close_app(RA_ID)
    tv.run("for i in $(seq 1 15); do pidof retroarch.bin retroarch >/dev/null || exit 0; sleep 1; done")


# ---- setup -----------------------------------------------------------------------------------------

def install_retroarch(tv):
    apps = json.loads(fetch(REPO_API))
    pkg = next(p for p in apps.get("packages", apps) if p.get("id") == RA_ID)
    m = pkg["manifest"]
    url, want = m["ipkUrl"], m["ipkHash"]["sha256"]
    if not url.startswith("http"):
        url = pkg["manifestUrl"].rsplit("/", 1)[0] + "/" + url
    print("Downloading RetroArch %s from the Homebrew Channel repository..." % m["version"])
    data = fetch(url, timeout=300)
    if hashlib.sha256(data).hexdigest() != want:
        sys.exit("RetroArch's download doesn't match the repository's SHA-256; not installing it.")
    tmp = tempfile.mkdtemp(prefix="wii-ra-")
    try:
        path = os.path.join(tmp, "%s_%s.ipk" % (RA_ID, m["version"]))
        open(path, "wb").write(data)
        tv.install_ipk(path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("Installed RetroArch.")


def first_run(tv):
    """RetroArch writes its settings and folders the first time it opens."""
    rc, _ = tv.run("[ -f %s ]" % CFG)
    if rc == 0:
        return
    print("Opening RetroArch once so it creates its settings...")
    tv.launch_app(RA_ID)
    tv.run("for i in $(seq 1 30); do [ -f %s ] && exit 0; sleep 1; done" % CFG, timeout=60)
    time.sleep(2)
    wait_closed(tv)


def install_core(tv):
    rc, _ = tv.run("[ -f %s/%s_libretro.so ]" % (CORES, CORE))
    if rc == 0:
        return
    name = CORE + "_libretro.so.zip"
    index = fetch(CORE_SERVER + ".index-extended").decode()
    crc = next((line.split()[1] for line in index.splitlines() if line.endswith(" " + name)), None)
    data = fetch(CORE_SERVER + name)
    if crc is None or "%08x" % (zlib.crc32(data) & 0xFFFFFFFF) != crc.lower():
        sys.exit("The %s core doesn't match the core server's index; not installing it." % CORE)
    tmp = tempfile.mkdtemp(prefix="wii-core-")
    try:
        zipfile.ZipFile(io.BytesIO(data)).extract(CORE + "_libretro.so", tmp)
        with FileServer(tv, serve_dir=tmp) as fs:
            tv.check("mkdir -p %s && curl -s -f -o %s/%s_libretro.so %s/%s_libretro.so && chown %s %s/%s_libretro.so"
                     % (CORES, CORES, CORE, fs.url, CORE, owner(tv), CORES, CORE), timeout=120)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("Installed the %s core." % CORE)


def install_wrapper(tv):
    # A RetroArch update puts its program back at `retroarch`; the script moves it aside again.
    rc, _ = tv.run("head -c 4 %s/retroarch | grep -q ELF" % RA)
    if rc == 0:
        tv.check("mv -f %s/retroarch %s/retroarch.bin" % (RA, RA))
    put_text(tv, RA + "/retroarch", WRAPPER)
    tv.check("chmod 755 %s/retroarch && chown %s %s/retroarch" % (RA, owner(tv), RA))
    print("Installed the launch script.")


def apply_settings(tv):
    # RetroArch writes its settings back when it closes, so it must be closed while they change.
    wait_closed(tv)
    tv.check("[ -f %s.before-wii-webos ] || cp -p %s %s.before-wii-webos" % (CFG, CFG, CFG))
    script = ['C=%s' % CFG,
              'set_key() { if grep -q "^$1 = " $C; then sed -i "s|^$1 = .*|$1 = \\"$2\\"|" $C; '
              'else echo "$1 = \\"$2\\"" >> $C; fi; }']
    script += ['set_key %s "%s"' % (k, v) for k, v in SETTINGS]
    tv.check("\n".join(script))
    tv.check("mkdir -p %s && chown %s %s" % (ROMS, owner(tv), ROMS))
    print("Set RetroArch up for the TV remote; its old settings are in retroarch.cfg.before-wii-webos.")


def setup(tv):
    if not ra_installed(tv):
        install_retroarch(tv)
    first_run(tv)
    install_core(tv)
    install_wrapper(tv)
    apply_settings(tv)
    publish(tv)


# ---- covers ----------------------------------------------------------------------------------------

def fetch_cover(path):
    """The game's box art from libretro's thumbnail server, or None. RetroArch looks thumbnails up by the
    file name with &*/:`<>?\\| replaced by underscores, and so does this."""
    system = THUMB_SYSTEMS.get(os.path.splitext(path)[1].lower())
    if not system:
        return None
    name = re.sub(r'[&*/:`<>?\\|"]', "_", os.path.splitext(os.path.basename(path))[0])
    url = THUMBS + urllib.parse.quote(system) + "/Named_Boxarts/" + urllib.parse.quote(name) + ".png"
    try:
        return fetch(url, timeout=30)
    except urllib.error.HTTPError:
        return None


def _unfilter(f, line, prev, bpp):
    n = len(line)
    if f == 1:
        for x in range(bpp, n):
            line[x] = (line[x] + line[x - bpp]) & 255
    elif f == 2:
        for x in range(n):
            line[x] = (line[x] + prev[x]) & 255
    elif f == 3:
        for x in range(n):
            left = line[x - bpp] if x >= bpp else 0
            line[x] = (line[x] + ((left + prev[x]) >> 1)) & 255
    elif f == 4:
        for x in range(n):
            a = line[x - bpp] if x >= bpp else 0
            b, c = prev[x], prev[x - bpp] if x >= bpp else 0
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255


def shrink_png(data, side=COVER_SIDE):
    """The PNG scaled down to fit side x side, or the data unchanged when it already fits or is a kind of
    PNG this can't read (16-bit or interlaced). Plain Python, so the tools need nothing installed."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return data
    pos, idat, plte, trns, hdr = 8, b"", b"", b"", None
    while pos + 8 <= len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif kind == b"PLTE":
            plte = body
        elif kind == b"tRNS":
            trns = body
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    if not hdr:
        return data
    w, h, depth, ctype, _, _, interlace = hdr
    chans = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(ctype)
    if depth != 8 or interlace or not chans or max(w, h) <= side:
        return data
    raw, stride = zlib.decompress(idat), w * chans
    rgba, prev, i = bytearray(w * h * 4), bytearray(stride), 0
    for y in range(h):
        line = bytearray(raw[i + 1:i + 1 + stride])
        _unfilter(raw[i], line, prev, chans)
        i += 1 + stride
        for x in range(w):
            o, d = x * chans, (y * w + x) * 4
            if ctype == 6:
                rgba[d:d + 4] = line[o:o + 4]
            elif ctype == 2:
                rgba[d:d + 3], rgba[d + 3] = line[o:o + 3], 255
            elif ctype == 3:
                k = line[o]
                rgba[d:d + 3] = plte[k * 3:k * 3 + 3]
                rgba[d + 3] = trns[k] if k < len(trns) else 255
            else:
                rgba[d] = rgba[d + 1] = rgba[d + 2] = line[o]
                rgba[d + 3] = line[o + 1] if ctype == 4 else 255
        prev = line

    sc = side / max(w, h)
    tw, th = max(1, round(w * sc)), max(1, round(h * sc))
    out = bytearray()
    for ty in range(th):
        y0, y1 = ty * h // th, max(ty * h // th + 1, (ty + 1) * h // th)
        out.append(0)
        for tx in range(tw):
            x0, x1 = tx * w // tw, max(tx * w // tw + 1, (tx + 1) * w // tw)
            acc, count = [0, 0, 0, 0], (y1 - y0) * (x1 - x0)
            for y in range(y0, y1):
                base = y * w * 4
                for x in range(x0, x1):
                    d = base + x * 4
                    acc[0] += rgba[d]; acc[1] += rgba[d + 1]; acc[2] += rgba[d + 2]; acc[3] += rgba[d + 3]
            out += bytes(v // count for v in acc)

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", tw, th, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(out), 9)) + chunk(b"IEND", b""))


def pull_covers(tv):
    """The TV's covers into app/covers/, so an install carries them."""
    local = os.path.join(APP_DIR, "covers")
    shutil.rmtree(local, ignore_errors=True)
    os.makedirs(local)
    names = tv.check("ls %s 2>/dev/null; true" % COVERS).split()
    if not names:
        return
    with FileServer(tv, upload_dir=local) as fs:
        tv.run("\n".join("curl -s -m 30 -T '%s/%s' '%s/up/%s'" % (COVERS, n, fs.url, n) for n in names) + "\ntrue",
               timeout=300)


# ---- games -----------------------------------------------------------------------------------------

def read_list(tv):
    rc, out = tv.run("cat %s 2>/dev/null" % LIST)
    try:
        return json.loads(out[out.index("["):]) if rc == 0 and "[" in out else []
    except ValueError:
        return []


def write_list(tv, games):
    put_text(tv, LIST, json.dumps(games, indent=1, ensure_ascii=False))
    tv.check("chown %s %s" % (owner(tv), LIST))


def menu_data(tv):
    """What the menu needs to show and start the games."""
    ok = ra_installed(tv) and tv.run("[ -f %s/%s_libretro.so ]" % (CORES, CORE))[0] == 0
    games = []
    for g in read_list(tv):
        ext = os.path.splitext(g["file"])[1].lower()
        games.append({"title": g["title"], "color": g.get("color") or "", "system": SYSTEMS.get(ext, ""),
                      "rom": ROMS + "/" + g["file"], "core": CORES + "/" + g.get("core", CORE) + "_libretro.so",
                      "cover": "covers/" + g["cover"] if g.get("cover") else ""})
    return {"app": RA_ID, "ready": ok, "games": games}


def write_menu_file(tv):
    """app/games.js for the next install; returns its text."""
    text = ("// Generated by tools/games.py: RetroArch and the games on the TV.\n"
            "window.TV_GAMES = " + json.dumps(menu_data(tv), indent=1, ensure_ascii=False) + ";\n")
    with open(os.path.join(APP_DIR, "games.js"), "w", encoding="utf-8") as f:
        f.write(text)
    return text


def publish(tv):
    """Updates the installed menu's game list; an open menu restarts to show it."""
    text = write_menu_file(tv)
    pull_covers(tv)
    if tv.run("[ -d %s ]" % MENU_DIR)[0] != 0:
        return
    put_text(tv, MENU_DIR + "/games.js", text)
    tv.check("rm -rf %s/covers && mkdir -p %s/covers && cp %s/* %s/covers/ 2>/dev/null; true"
             % (MENU_DIR, MENU_DIR, COVERS, MENU_DIR))
    out = tv.check("luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}'")
    if MENU_ID in out:
        tv.close_app(MENU_ID)
        time.sleep(1)
        tv.launch_app(MENU_ID)
    else:
        tv.close_app(MENU_ID)   # it reads the new list when it next opens


def clean_title(path):
    """A file name without the region and version tags ROM sets add: "Game (USA) (Rev 1)" -> "Game",
    "Legend of Zelda, The - The Minish Cap (USA)" -> "The Legend of Zelda - The Minish Cap"."""
    stem = os.path.splitext(os.path.basename(path))[0]
    title = re.sub(r"\s*[\(\[][^\)\]]*[\)\]]", "", stem).strip()
    # Sets file "The Legend of Zelda" as "Legend of Zelda, The"; put the article back in front.
    parts = [re.sub(r"^(.*), (The|A|An)$", r"\2 \1", part) for part in title.split(" - ")]
    return " - ".join(parts) or stem


def slug(title):
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "game"


def put_file(tv, data, folder, name):
    """Sends bytes to folder/name on the TV, owned by RetroArch like the rest of its folder."""
    tmp = tempfile.mkdtemp(prefix="wii-file-")
    try:
        open(os.path.join(tmp, name), "wb").write(data)
        with FileServer(tv, serve_dir=tmp) as fs:
            tv.check("mkdir -p '%s' && curl -s -f -o '%s/%s' '%s/%s' && chown %s '%s' '%s/%s'"
                     % (folder, folder, name, fs.url, name, owner(tv), folder, folder, name), timeout=300)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def add(tv, path, title=None, color=None, cover=None):
    ext = os.path.splitext(path)[1].lower()
    if ext not in SYSTEMS:
        sys.exit("Only %s files are supported." % ", ".join(sorted(SYSTEMS)))
    if color and not re.match(r"^#[0-9A-Fa-f]{6}$", color):
        sys.exit("--color takes a colour like #E8432E.")
    if cover and os.path.splitext(cover)[1].lower() not in (".png", ".jpg", ".jpeg"):
        sys.exit("--cover takes a PNG or JPEG image.")
    if not ra_installed(tv):
        sys.exit("RetroArch isn't set up yet; run tools/games.py <TV IP> --setup first.")
    title = title or clean_title(path)
    games = [g for g in read_list(tv) if g["title"] != title]
    data = open(path, "rb").read()
    md5 = hashlib.md5(data).hexdigest()

    # The same game already on the TV keeps its file name, and with it its in-game save.
    out = tv.check("cd %s 2>/dev/null && md5sum * 2>/dev/null; true" % ROMS)
    same = next((line.split(None, 1)[1].strip() for line in out.splitlines()
                 if line.startswith(md5 + " ")), None)
    if same:
        name = same
    else:
        used = set(line.split(None, 1)[1].strip() for line in out.splitlines() if " " in line)
        name, n = slug(title) + ext, 2
        while name in used:
            name, n = "%s-%d%s" % (slug(title), n, ext), n + 1
        put_file(tv, data, ROMS, name)
    entry = {"title": title, "file": name, "core": CORE,
             "color": color or PALETTE[sum(map(ord, title)) % len(PALETTE)]}

    art = open(cover, "rb").read() if cover else fetch_cover(path)
    if art:
        cover_ext = ".jpg" if art[:3] == b"\xff\xd8\xff" else ".png"
        entry["cover"] = os.path.splitext(name)[0] + cover_ext
        put_file(tv, shrink_png(art), COVERS, entry["cover"])
    games.append(entry)
    write_list(tv, games)
    publish(tv)
    print("Added %s (%s)%s." % (title, name, ", with %s cover" % ("your" if cover else "its box-art") if art
                                else ", without a cover: libretro has none under this file name"))


def remove(tv, title, delete=False):
    games = read_list(tv)
    gone = [g for g in games if g["title"] == title]
    if not gone:
        sys.exit("No game called %r; see --list." % title)
    write_list(tv, [g for g in games if g["title"] != title])
    if delete:
        for g in gone:
            tv.check("rm -f '%s/%s'" % (ROMS, g["file"]))
    for g in gone:
        if g.get("cover"):
            tv.check("rm -f '%s/%s'" % (COVERS, g["cover"]))
    publish(tv)
    print("Removed %s%s." % (title, " and its file" if delete else ""))


def main():
    args = sys.argv[1:]
    opts = {}
    for flag in ("--title", "--color", "--cover"):
        if flag in args:
            i = args.index(flag)
            opts[flag] = args[i + 1]
            del args[i:i + 2]
    words = [a for a in args if not a.startswith("--")]
    if words and words[0] not in ("add", "remove"):
        tv, words = TV(words[0]), words[1:]
    else:
        tv = TV(host_from_args([]))
    if "--setup" in args:
        setup(tv)
    elif "--list" in args:
        for g in read_list(tv):
            print("%-36s %s" % (g["title"], g["file"]))
    elif words[:1] == ["add"] and len(words) == 2:
        add(tv, words[1], opts.get("--title"), opts.get("--color"), opts.get("--cover"))
    elif words[:1] == ["remove"] and len(words) == 2:
        remove(tv, words[1], "--delete" in args)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
