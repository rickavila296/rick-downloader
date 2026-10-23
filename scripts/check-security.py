#!/usr/bin/env python3
"""Security audit script (spec §9.1, §13).
Fails with non-zero exit code if subprocess, os.system, os.popen, or shell=True
appears in apps/worker.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKER_APP = REPO_ROOT / "apps" / "worker" / "app"

FORBIDDEN_PATTERNS = [
    re.compile(r"\bimport\s+subprocess\b"),
    re.compile(r"\bfrom\s+subprocess\b"),
    re.compile(r"\bos\.system\s*\("),
    re.compile(r"\bos\.popen\s*\("),
    re.compile(r"\bos\.exec\w*\s*\("),
    re.compile(r"\bos\.spawn\w*\s*\("),
    re.compile(r"shell\s*=\s*True"),
    re.compile(r"\basyncio\.create_subprocess_\w+"),
]


def audit_worker_code() -> int:
    print(f"Auditing Python files in {WORKER_APP} for forbidden subprocess/shell calls...")
    violations: list[str] = []

    if not WORKER_APP.exists():
        print(f"ERROR: Directory {WORKER_APP} not found.")
        return 1

    py_files = list(WORKER_APP.rglob("*.py"))
    for file_path in py_files:
        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception as e:
            print(f"ERROR reading {file_path}: {e}")
            continue

        for lineno, line in enumerate(content.splitlines(), start=1):
            for pattern in FORBIDDEN_PATTERNS:
                if pattern.search(line):
                    rel = file_path.relative_to(REPO_ROOT)
                    violations.append(f"{rel}:{lineno}: {line.strip()}")

    if violations:
        print("\n[FAILED] Forbidden shell/subprocess operations detected:")
        for v in violations:
            print(f"  - {v}")
        return 1

    print(f"[PASSED] All {len(py_files)} worker files clean. Zero shell-outs or subprocess calls.")
    return 0


if __name__ == "__main__":
    sys.exit(audit_worker_code())
