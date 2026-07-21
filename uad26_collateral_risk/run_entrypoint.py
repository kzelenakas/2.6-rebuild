"""stdin/stdout entrypoint for UAD 2.6 collateral risk engine.
Reads JSON from stdin, writes {"findings": [...]} to stdout, always exits 0.
Maps engine's finding shape to engine.ts's Finding interface.
"""
import base64
import json
import random
import sys

from . import evaluate, evaluate_photos

_ID_LOW, _ID_HIGH = 30_000_000, 40_000_000

# Map collateral-risk severity vocabulary to engine.ts's Finding.severity union
_SEVERITY_MAP = {"Fatal": "HardStop", "Advisory": "Advisory", "Warning": "Warning"}


def _to_finding(raw: dict) -> dict:
    logic_field = raw.get("field_path", "")
    return {
        "id": random.randint(_ID_LOW, _ID_HIGH),
        "rule_id": raw["rule_id"],
        "category": raw["category"],
        "severity": _SEVERITY_MAP.get(raw["severity"], "Warning"),
        "message_appraiser": raw["description"],
        "message_reviewer": raw["description"],
        "field_path": logic_field,
        "xpath": None,
        "section": None,
        "values": raw.get("values", {}),
        "citation": raw.get("citation"),
        "appraiser_checked": False,
        "reviewer_status": "pending",
        "reviewer_note": None,
        "reviewed_at": None,
    }


def _decode_photos(raw: dict) -> dict[str, bytes]:
    photos = raw.get("photos") or {}
    decoded = {}
    for filename, b64 in photos.items():
        try:
            decoded[filename] = base64.b64decode(b64)
        except Exception:
            continue
    return decoded


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        xml_string = payload.get("xmlString") or ""

        findings = evaluate(xml_string.encode("utf-8")) if xml_string else []

        images = _decode_photos(payload)
        if images:
            findings = findings + evaluate_photos(images)

        mapped = [_to_finding(f) for f in findings]
        print(json.dumps({"findings": mapped}))
    except Exception as e:
        print(json.dumps({"findings": [], "error": str(e)}))


if __name__ == "__main__":
    main()