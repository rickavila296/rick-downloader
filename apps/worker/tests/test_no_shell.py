"""Spec §9.1 / §13: no subprocess, os.system, or shell=True anywhere in the worker."""

import re
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "app"

FORBIDDEN = [
    re.compile(r"\bimport\s+subprocess\b"),
    re.compile(r"\bfrom\s+subprocess\b"),
    re.compile(r"\bos\.system\s*\("),
    re.compile(r"\bos\.popen\s*\("),
    re.compile(r"\bos\.exec\w*\s*\("),
    re.compile(r"\bos\.spawn\w*\s*\("),
    re.compile(r"shell\s*=\s*True"),
    re.compile(r"\basyncio\.create_subprocess_\w+"),
]


def test_no_shell_outs_in_worker() -> None:
    offenders: list[str] = []
    for path in APP_DIR.rglob("*.py"):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if any(p.search(line) for p in FORBIDDEN):
                offenders.append(f"{path.relative_to(APP_DIR)}:{lineno}: {line.strip()}")
    assert not offenders, "Shell-outs are forbidden in the worker:\n" + "\n".join(offenders)
