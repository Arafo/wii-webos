#!/usr/bin/env python3
"""Install the menu on a rooted LG TV, or remove it.

    python3 tools/install.py 192.168.1.50               # read the TV's apps, package, install, open
    python3 tools/install.py 192.168.1.50 --uninstall

Reads the TV's apps (tools/sync.py), packages app/ as an .ipk in build/, sends it to the TV over
HTTP and installs it with the same appInstallService call LG's `ares-install` makes, which a root
shell may use without Developer Mode. Run it again after changing app/config.js or installing apps.
"""
import io
import json
import os
import sys
import tarfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tv import TV, host_from_args  # noqa: E402
from sync import sync  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, "app")
BUILD = os.path.join(ROOT, "build")


def ar_member(name, data):
    head = "%-16s%-12d%-6d%-6d%-8s%-10d`\n" % (name, int(time.time()), 0, 0, "100644", len(data))
    return head.encode() + data + (b"\n" if len(data) % 2 else b"")


def tar_gz(entries):
    """entries: (archive path, bytes or None for a directory)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        for path, data in entries:
            info = tarfile.TarInfo(path)
            info.mtime = int(time.time())
            if data is None:
                info.type, info.mode = tarfile.DIRTYPE, 0o755
                tar.addfile(info)
            else:
                info.size, info.mode = len(data), 0o644
                tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def package():
    info = json.load(open(os.path.join(APP_DIR, "appinfo.json")))
    app_id, version = info["id"], info["version"]
    base = "./usr/palm/applications/%s" % app_id
    entries, size = [], 0
    for d in ("./usr", "./usr/palm", "./usr/palm/applications", "./usr/palm/packages",
              "./usr/palm/packages/" + app_id, base):
        entries.append((d, None))
    for dirpath, dirnames, filenames in os.walk(APP_DIR):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        rel = os.path.relpath(dirpath, APP_DIR)
        if rel != ".":
            entries.append((base + "/" + rel, None))
        for f in sorted(filenames):
            if f.startswith("."):
                continue
            data = open(os.path.join(dirpath, f), "rb").read()
            size += len(data)
            entries.append((base + "/" + (f if rel == "." else rel + "/" + f), data))
    pkginfo = json.dumps({"app": app_id, "id": app_id, "loc_name": info.get("title", app_id),
                          "package_format_version": 2, "vendor": info.get("vendor", ""),
                          "version": version}, indent=2).encode()
    entries.append(("./usr/palm/packages/%s/packageinfo.json" % app_id, pkginfo))
    control = ("Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\n"
               "Installed-Size: %d\nMaintainer: N/A <nobody@example.com>\nDescription: %s\n"
               "webOS-Package-Format-Version: 2\nwebOS-Packager-Version: x.y.x\n"
               % (app_id, version, size, info.get("title", app_id))).encode()

    os.makedirs(BUILD, exist_ok=True)
    name = "%s_%s_all.ipk" % (app_id, version)
    with open(os.path.join(BUILD, name), "wb") as f:
        f.write(b"!<arch>\n")
        f.write(ar_member("debian-binary", b"2.0\n"))
        f.write(ar_member("control.tar.gz", tar_gz([(".", None), ("./control", control)])))
        f.write(ar_member("data.tar.gz", tar_gz(entries)))
    print("Packaged build/%s (%d KB)" % (name, os.path.getsize(os.path.join(BUILD, name)) // 1024))
    return app_id, name


def install(tv, app_id, name):
    # A running copy would only be brought forward by the launch below, still on the old code.
    tv.close_app(app_id)
    try:
        tv.install_ipk(os.path.join(BUILD, name))
    except RuntimeError as e:
        sys.exit(str(e))
    print("Installed %s." % app_id)
    tv.launch_app(app_id)
    print("Opened it on the TV.")


def uninstall(tv, app_id):
    tv.run("luna-send -n 1 luna://com.webos.applicationManager/closeByAppId '{\"id\":\"%s\"}'" % app_id)
    out = tv.check("luna-send -w 30000 -i luna://com.webos.appInstallService/dev/remove "
                   "'{\"id\":\"%s\",\"subscribe\":true}' | grep -m 1 -E 'removed|failed|errorText'; true"
                   % app_id, timeout=60)
    print("Removed %s." % app_id if "removed" in out else "Remove failed:\n" + out)


def main():
    tv = TV(host_from_args(sys.argv[1:]))
    app_id = json.load(open(os.path.join(APP_DIR, "appinfo.json")))["id"]
    if "--uninstall" in sys.argv:
        uninstall(tv, app_id)
        return
    sync(tv)
    app_id, name = package()
    install(tv, app_id, name)


if __name__ == "__main__":
    main()
