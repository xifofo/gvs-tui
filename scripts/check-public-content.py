#!/usr/bin/env python3
"""Reject live gateway credentials and personal paths without printing values."""
import argparse
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
LIVE_KEY = re.compile(rb"\b(?:sk|yk)_live_[A-Za-z0-9_.-]{12,}")
USER_PATH = re.compile(rb"(?:[A-Za-z]:[\\/]+Users[\\/]+|/Users/)([A-Za-z0-9._-]+)")
EXAMPLE_USERS = {b"example", b"user", b"test", b"runner", b"a"}
GATEWAY = re.compile(rb"(?:TUNNEL_URL|PROBE_HOST|cfg\.host)[^\n]*?['\"]((?:https?|wss?)://[^'\"\s]+)")


def git(*args, input=None):
    return subprocess.check_output(["git", *args], cwd=ROOT, input=input)


def issues(data):
    if b"\0" in data[:8192]:
        return
    for number, line in enumerate(data.splitlines(), 1):
        if LIVE_KEY.search(line):
            yield number, "live gateway credential"
        if any(m[1].lower() not in EXAMPLE_USERS for m in USER_PATH.finditer(line)):
            yield number, "personal home directory"
        for match in GATEWAY.finditer(line):
            try:
                host = urlsplit(match[1].decode()).hostname or ""
            except (ValueError, UnicodeError):
                host = ""
            if host not in {"localhost", "127.0.0.1"} and not host.endswith((".example", ".invalid", ".test", ".example.com")):
                yield number, "hardcoded gateway endpoint"


def history():
    objects = {}
    for row in git("rev-list", "--objects", "--all").splitlines():
        oid, _, name = row.partition(b" ")
        objects[oid] = name.decode(errors="replace") or "<commit or tag>"
    info = git("cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)", input=b"\n".join(objects) + b"\n")
    with subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        for row in info.splitlines():
            oid, kind, size = row.split()
            # Large bundled media executables are outside this source-content guard.
            if kind not in {b"blob", b"commit", b"tag"} or int(size) > 10_000_000:
                continue
            process.stdin.write(oid + b"\n")
            process.stdin.flush()
            header = process.stdout.readline().split()
            data = process.stdout.read(int(header[2]))
            process.stdout.read(1)
            yield f"{oid.decode()[:12]}:{objects[oid]}", data
        process.stdin.close()


def working_tree():
    for name in set(git("ls-files", "-c", "-o", "--exclude-standard", "-z").split(b"\0")) - {b""}:
        path = ROOT / name.decode()
        if path.is_file() and not path.is_symlink() and path.stat().st_size <= 10_000_000:
            yield str(path.relative_to(ROOT)), path.read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="also inspect every reachable Git revision")
    args = parser.parse_args()
    findings = 0
    checked = 0
    sources = [working_tree()]
    if args.history:
        sources.append(history())
    for source in sources:
        for name, data in source:
            checked += 1
            for line, reason in issues(data):
                findings += 1
                print(f"{name}:{line}: {reason}")
    print(f"Public content check: {checked} objects/files, {findings} findings")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
