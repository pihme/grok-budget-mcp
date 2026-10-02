#!/usr/bin/env python3
"""Release grok-budget-mcp from Conventional Commits (same scheme as fregoli).

Runs in CI after the tests passed on a push to main.

Tag: grok-budget-mcp/vX.Y.Z
Commit type chooses the bump: feat -> minor, fix/perf -> patch,
feat!/fix! or a "BREAKING CHANGE:" footer -> major. While the version is
0.x, a breaking change bumps the minor version instead (SemVer: anything may
change before 1.0.0). Only commits that touch the shipped code count:
src/, package.json, package-lock.json, tsconfig.json.

The release:
  1. writes the new version into package.json / package-lock.json and pushes
     "chore(release): grok-budget-mcp vX.Y.Z [skip ci]" to main (skipped when
     package.json already carries the version). chore(release) is not
     releasable and pushes made with GITHUB_TOKEN start no workflow runs, so
     this cannot loop;
  2. builds dist/ and packs it with `npm pack` (grok-budget-mcp-X.Y.Z.tgz);
  3. creates the GitHub release with the tag on that commit, notes listing
     the releasable commits, and the tarball attached. Nothing is published
     to npm.

Dry run: python3 .github/scripts/release.py --dry-run
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from typing import List, Optional, Tuple

NAME = "grok-budget-mcp"
TAG_PREFIX = NAME + "/v"
PATHS = ["src/", "package.json", "package-lock.json", "tsconfig.json"]
RELEASE_SUBJECT = "chore(release): " + NAME + " v{ver} [skip ci]"
BOT = ("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com")


def run(args: List[str], check: bool = True) -> str:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.stdout.strip():
        print(r.stdout.rstrip())
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").rstrip()
        if err:
            print(err, file=sys.stderr)
        if check:
            raise SystemExit(f"command failed ({r.returncode}): {' '.join(args)}")
    return (r.stdout or "").strip()


def quiet(args: List[str]) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout.strip()


def last_tag() -> Optional[str]:
    out = quiet(["git", "tag", "-l", TAG_PREFIX + "*", "--sort=-v:refname"])
    tags = [t for t in out.splitlines() if t]
    return tags[0] if tags else None


def parse_semver(tag: str) -> Tuple[int, int, int]:
    raw = tag[len(TAG_PREFIX):] if tag.startswith(TAG_PREFIX) else tag
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)", raw)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else (0, 0, 0)


def bump(ver: Tuple[int, int, int], kind: str) -> Tuple[int, int, int]:
    major, minor, patch = ver
    if kind == "major" and major == 0:
        kind = "minor"  # pre-1.0: breaking changes bump the minor version
    if kind == "major":
        return (major + 1, 0, 0)
    if kind == "minor":
        return (major, minor + 1, 0)
    return (major, minor, patch + 1)


def commit_kind(subject: str, body: str) -> Optional[str]:
    if re.search(r"^BREAKING[ -]CHANGE:", body, re.M) or re.match(r"^\w+(\([^)]+\))?!:", subject):
        return "major"
    m = re.match(r"^(\w+)(\([^)]+\))?:", subject)
    if not m:
        return None
    if m.group(1) == "feat":
        return "minor"
    if m.group(1) in ("fix", "perf"):
        return "patch"
    return None


def releasable(since: Optional[str]) -> List[Tuple[str, str, str]]:
    """(kind, subject, short sha) for every releasable commit since the tag, oldest first."""
    rng = f"{since}..HEAD" if since else "HEAD"
    out = quiet(["git", "log", "--reverse", rng, "--format=%h%x1f%s%x1f%b%x1e", "--"] + PATHS)
    rows = []
    for rec in out.split("\x1e"):
        rec = rec.strip()
        if not rec:
            continue
        sha, subj, body = (rec.split("\x1f") + ["", ""])[:3]
        kind = commit_kind(subj.strip(), body)
        if kind:
            rows.append((kind, subj.strip(), sha))
    return rows


def strongest(kinds: List[str]) -> Optional[str]:
    for k in ("major", "minor", "patch"):
        if k in kinds:
            return k
    return None


def notes(rows: List[Tuple[str, str, str]], ver: str, prev: Optional[str]) -> str:
    groups = [("major", "Breaking changes"), ("minor", "Features"), ("patch", "Fixes")]
    out = [] if prev else ["First release.", ""]
    for kind, title in groups:
        items = [f"- {s} ({h})" for k, s, h in rows if k == kind]
        if items:
            out += [f"### {title}", ""] + items + [""]
    asset = f"{NAME}-{ver}.tgz"
    out += ["### Install", "",
            f"Prebuilt package (needs Node.js 22+): download `{asset}` below, then `npm install -g ./{asset}`.",
            "Or build from source as described in the README. Not published to npm.", ""]
    if prev:
        repo = os.environ.get("GITHUB_REPOSITORY", "pihme/" + NAME)
        out.append(f"Full diff: https://github.com/{repo}/compare/{prev}...{TAG_PREFIX}{ver}")
    return "\n".join(out).strip() + "\n"


def package_version() -> str:
    return json.load(open("package.json"))["version"]


def main() -> int:
    dry = "--dry-run" in sys.argv or os.environ.get("RELEASE_DRY_RUN") == "1"
    prev = last_tag()
    rows = releasable(prev)
    kind = strongest([k for k, _, _ in rows])
    if not kind:
        print(f"{NAME}: no releasable commits since {prev or 'start'}")
        return 0
    nxt = "{}.{}.{}".format(*bump(parse_semver(prev) if prev else (0, 0, 0), kind))
    tag = TAG_PREFIX + nxt
    print(f"{NAME}: {prev or '0.0.0'} -> {tag} ({kind}, {len(rows)} commit(s))")
    body = notes(rows, nxt, prev)
    if dry:
        print(body)
        return 0

    head = quiet(["git", "rev-parse", "HEAD"])
    sha = os.environ.get("GITHUB_SHA") or head
    if sha != head:
        raise SystemExit(f"checkout {head} is not the tested commit {sha}")
    remote = quiet(["git", "ls-remote", "origin", "refs/heads/main"]).split()[0]
    if remote != sha:
        print(f"main moved on ({remote[:7]}); the run for the newer commit will release")
        return 0

    if package_version() != nxt:
        run(["npm", "version", nxt, "--no-git-tag-version"])
        run(["git", "-c", f"user.name={BOT[0]}", "-c", f"user.email={BOT[1]}",
             "commit", "-m", RELEASE_SUBJECT.format(ver=nxt), "--", "package.json", "package-lock.json"])
        run(["git", "push", "origin", "HEAD:refs/heads/main"])  # fails (no release) if main moved meanwhile
        sha = quiet(["git", "rev-parse", "HEAD"])

    run(["npm", "ci"])
    os.makedirs("release-out", exist_ok=True)
    run(["npm", "pack", "--pack-destination", "release-out"])  # prepare builds dist/ first
    asset = os.path.join("release-out", f"{NAME}-{nxt}.tgz")
    if not os.path.exists(asset):
        raise SystemExit(f"missing {asset}")
    run(["gh", "release", "create", tag, "--target", sha, "--title", f"{NAME} {nxt}",
         "--notes", body, asset])
    return 0


if __name__ == "__main__":
    sys.exit(main())
