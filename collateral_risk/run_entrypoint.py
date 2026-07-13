"""stdin/stdout entrypoint for engine.ts's runPythonCollateralRisk(), mirroring
supplemental_rules/engine.py's contract exactly (see engine.ts:93-162): read one
JSON blob from stdin, write {"findings": [...]} to stdout, always exit 0.

This package's evaluate() returns a thinner shape than engine.ts's Finding
interface expects -- {rule_id, category, severity, description, citation, values}
vs. Finding's message_appraiser/message_reviewer/field_path/xpath/section. This
maps honestly rather than fabricating data the ruleset doesn't have:
- message_appraiser/message_reviewer: this package has one description per rule,
  not separate appraiser/reviewer wording (unlike the H-1 ruleset) -- reuse it for
  both rather than inventing distinct text nobody's reviewed.
- field_path: pulled from the rule's logic.field/lat_field when present, else
  empty string -- there's no single-field concept for e.g. geo_proximity rules.
- xpath/section: this ruleset never captured these (no per-rule Excel/audit
  metadata like H-1 has) -- null is the honest value, not a placeholder to fill
  in later with a guess.

IDs use a 30000000-40000000 random range, distinct from supplemental_rules'
20000000-30000000 (engine.py:427-428), so the two Python engines' findings
never collide when merged into the same array (engine.ts:518-523).
"""
import json
import random
import sys

from . import evaluate

_ID_LOW, _ID_HIGH = 30_000_000, 40_000_000

# rules.json's severity vocabulary ("Advisory", "Fatal") doesn't match engine.ts's
# Finding.severity union ("HardStop" | "Warning" | "Advisory") -- Fatal is this
# ruleset's most-severe/blocking tier, same role as HardStop plays in the main app.
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


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        xml_string = payload.get("xmlString") or ""
        if not xml_string:
            print(json.dumps({"findings": []}))
            return

        findings = evaluate(xml_string.encode("utf-8"))
        mapped = [_to_finding(f) for f in findings]
        print(json.dumps({"findings": mapped}))
    except Exception as e:  # never let a Python exception surface as a crash/non-zero exit
        print(json.dumps({"findings": [], "error": str(e)}))


if __name__ == "__main__":
    main()
