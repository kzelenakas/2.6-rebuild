"""UAD 2.6 Collateral Risk Engine.
Mirrors the UAD 3.6 engine.ts's shape: evaluate(xml_bytes) returns findings
for XML-based rules, evaluate_photos(images) for photo-based rules.
"""
from __future__ import annotations
import json
from pathlib import Path
from lxml import etree
from .operators import OPERATORS

def load_rules(path: str | Path | None = None) -> list[dict]:
    path = Path(path) if path else Path(__file__).parent / "rules.json"
    return json.loads(path.read_text(encoding="utf-8"))["rules"]

def evaluate(xml_bytes: bytes, rules: list[dict] | None = None) -> list[dict]:
    """Returns one finding dict per TRIGGERED rule: {rule_id, category,
    severity, description, citation, values}. Rules whose logic.type is
    'needs_encoding' are skipped -- honest about what's actually running."""
    rules = rules if rules is not None else load_rules()
    doc = etree.fromstring(xml_bytes)
    findings = []
    for rule in rules:
        if not rule.get("enabled", True):
            continue
        logic = rule["logic"]
        op = OPERATORS.get(logic["type"])
        if op is None:
            continue
        result = op(logic, doc)
        if result["triggered"]:
            # For field_path, use logic.field or first condition field
            field_path = logic.get("field") or logic.get("lat_field") or logic.get("subject_field") or ""
            if not field_path and "conditions" in logic and logic["conditions"]:
                field_path = logic["conditions"][0].get("field", "")
            findings.append({
                "rule_id": rule["rule_id"],
                "category": rule["category"],
                "severity": rule["severity"],
                "description": rule["description"],
                "citation": rule.get("citation"),
                "values": result["values"],
                "field_path": field_path,
            })
    return findings

_PHOTO_LOGIC_TYPES = {"photo_face_detected", "photo_quality_flag"}

def evaluate_photos(images: dict[str, bytes], rules: list[dict] | None = None) -> list[dict]:
    """Photo rules entry point. Loops (rule x photo) instead of (rule x document)."""
    rules = rules if rules is not None else load_rules()
    findings = []
    for rule in rules:
        if not rule.get("enabled", True):
            continue
        logic = rule["logic"]
        if logic["type"] not in _PHOTO_LOGIC_TYPES:
            continue
        op = OPERATORS.get(logic["type"])
        if op is None:
            continue
        for filename, image_bytes in images.items():
            result = op(logic, image_bytes)
            if result["triggered"]:
                values = dict(result["values"])
                values["photo"] = filename
                findings.append({
                    "rule_id": rule["rule_id"],
                    "category": rule["category"],
                    "severity": rule["severity"],
                    "description": rule["description"],
                    "citation": rule.get("citation"),
                    "values": values,
                })
    return findings