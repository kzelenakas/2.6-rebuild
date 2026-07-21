"""stdin/stdout entrypoint for UAD 2.6 supplemental rules engine.
Reads one JSON blob from stdin, writes {"findings": [...]} to stdout, always exits 0.
"""
import json
import random
import sys

from . import run_checks

_ID_LOW, _ID_HIGH = 20_000_000, 30_000_000


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        findings = run_checks(payload)

        # Assign unique IDs in 20M+ range
        for f in findings:
            f["id"] = random.randint(_ID_LOW, _ID_HIGH)

        print(json.dumps({"findings": findings}))
    except Exception as e:
        print(json.dumps({"findings": [], "error": str(e)}))


if __name__ == "__main__":
    main()