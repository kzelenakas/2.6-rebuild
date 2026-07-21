"""Operator vocabulary for the UAD 2.6 collateral-risk ruleset. Adapted for
MISMO v2.6 (VALUATION_RESPONSE root) field paths. Mirrors the 3.6 operators
but uses UAD 2.6 resolve functions."""
from __future__ import annotations
from datetime import date, datetime
from typing import Callable
from .resolve import resolve, resolve_doc, subject_node, comparable_nodes, listing_nodes, resolve_attribute

class Finding(dict):
    """triggered: bool, values: dict -- plain dict subclass."""

def _first(vals: list[str]) -> str | None:
    return vals[0] if vals else None

def _resolve_subject_field(doc, field_path: str) -> list[str]:
    node = subject_node(doc)
    if node is None:
        return []
    if "/@" in field_path or field_path.startswith("@"):
        return resolve_attribute(node, field_path)
    return resolve(node, field_path)

def _resolve_comparable_field(doc, field_path: str, comp_index: int = 0) -> list[str]:
    comps = comparable_nodes(doc)
    if comp_index < len(comps):
        node = comps[comp_index]
        if "/@" in field_path or field_path.startswith("@"):
            return resolve_attribute(node, field_path)
        return resolve(node, field_path)
    return []

def _resolve_listing_field(doc, field_path: str) -> list[str]:
    listings = listing_nodes(doc)
    if listings:
        node = listings[0]
        if "/@" in field_path or field_path.startswith("@"):
            return resolve_attribute(node, field_path)
        return resolve(node, field_path)
    return []

def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None

def field_in_set(logic: dict, doc) -> Finding:
    val = _first(_resolve_subject_field(doc, logic["field"]))
    if val is None or val == "":
        return Finding(triggered=False, values={})
    mode = logic.get("mode", "flag_if_not_in")
    is_member = val in logic["allowed"]
    triggered = is_member if mode == "flag_if_in" else not is_member
    return Finding(triggered=triggered, values={logic["field"]: val})

def numeric_range(logic: dict, doc) -> Finding:
    val = _first(_resolve_subject_field(doc, logic["field"]))
    if val is None or val == "":
        return Finding(triggered=False, values={})
    try:
        num = float(str(val).replace(",", ""))
    except ValueError:
        return Finding(triggered=True, values={logic["field"]: val})
    lo, hi = logic.get("min"), logic.get("max")
    out = (lo is not None and num < lo) or (hi is not None and num > hi)
    return Finding(triggered=out, values={logic["field"]: val})

def date_field_compare(logic: dict, doc) -> Finding:
    a = _parse_date(_first(_resolve_subject_field(doc, logic["field"])))
    b = _parse_date(_first(_resolve_subject_field(doc, logic["compare_field"])))
    if a is None or b is None:
        return Finding(triggered=False, values={})
    op = logic["operator"]
    triggered = {">": a > b, "<": a < b, ">=": a >= b, "<=": a <= b}[op]
    return Finding(triggered=triggered, values={logic["field"]: str(a), logic["compare_field"]: str(b)})

def value_comparison(logic: dict, doc) -> Finding:
    a = _first(_resolve_subject_field(doc, logic["field"]))
    b_field = logic.get("compare_field")
    b = _first(_resolve_subject_field(doc, b_field)) if b_field else logic.get("compare_value")
    if a is None or b is None:
        return Finding(triggered=False, values={})
    try:
        a, b = float(a), float(b)
    except ValueError:
        return Finding(triggered=False, values={})
    op = logic["operator"]
    if op == "ratio_gt":
        triggered = b != 0 and abs(a - b) / abs(b) > logic["threshold"]
    else:
        triggered = {">": a > b, "<": a < b, ">=": a >= b, "<=": a <= b,
                     "==": a == b, "!=": a != b}[op]
    return Finding(triggered=triggered, values={logic["field"]: str(a)})

def conditional_field_present(logic: dict, doc) -> Finding:
    for cond in logic["conditions"]:
        val = _first(_resolve_subject_field(doc, cond["field"]))
        ok = (val is not None and val != "") if cond.get("required") else (val == cond.get("value"))
        if not ok:
            return Finding(triggered=False, values={})
    target = _first(_resolve_subject_field(doc, logic["required_field"]))
    missing = target is None or str(target).strip() == ""
    return Finding(triggered=missing, values={logic["required_field"]: target})

def commentary_category_present(logic: dict, doc) -> Finding:
    """Check if a VALUATION_COMMENTARY entry of required category exists.
    Triggers when absent (the risk condition is the missing commentary)."""
    cats = resolve_doc(doc, logic["category_field"])
    return Finding(triggered=logic["category_value"] not in cats, values={"categories_found": ",".join(cats)})

def conditional(logic: dict, doc) -> Finding:
    def cond_true(cond):
        val = _first(_resolve_subject_field(doc, cond["field"]))
        text = "" if val is None else val
        if "equals" in cond:
            return text == cond["equals"]
        if "not_equals" in cond:
            return text != cond["not_equals"]
        return False
    if not any(all(cond_true(c) for c in group) for group in logic.get("if_any", [])):
        return Finding(triggered=False, values={})
    then = logic["then"]
    return OPERATORS[then["type"]](then, doc)

def geo_proximity(logic: dict, doc) -> Finding:
    """Subject-to-adverse-influence distance via a live POI lookup.
    Subject coordinates are not NPI/confidential (Kevin, 2026-07-10)."""
    from . import poi

    lat_s = _first(_resolve_subject_field(doc, logic["lat_field"]))
    lon_s = _first(_resolve_subject_field(doc, logic["lon_field"]))
    if lat_s is None or lon_s is None:
        return Finding(triggered=False, values={})
    try:
        lat, lon = float(lat_s), float(lon_s)
    except ValueError:
        return Finding(triggered=False, values={})
    distance = poi.nearest_distance_ft(
        lat, lon, logic["category"], radius_m=logic.get("radius_m", 500)
    )
    if distance is None:
        return Finding(triggered=False, values={})
    triggered = distance <= logic["threshold_ft"]
    return Finding(triggered=triggered, values={
        "distance_ft": round(distance, 1), "category": logic["category"],
        "threshold_ft": logic["threshold_ft"],
    })

def photo_face_detected(logic: dict, image_bytes: bytes) -> Finding:
    """Phase 3: detects presence of a face-shaped region only (no recognition)."""
    from . import photo
    faces = photo.detect_faces(image_bytes)
    return Finding(triggered=bool(faces), values={"face_count": len(faces)})

def photo_quality_flag(logic: dict, image_bytes: bytes) -> Finding:
    """Phase 2: flags photos too dark or too blurry to evaluate.
    logic["check"] selects "dark" or "blurry"."""
    from . import photo
    quality = photo.assess_quality(image_bytes)
    check = logic["check"]
    triggered = quality["is_dark"] if check == "dark" else quality["is_blurry"]
    return Finding(triggered=triggered, values={
        "mean_brightness": quality["mean_brightness"],
        "laplacian_variance": quality["laplacian_variance"],
    })


OPERATORS: dict[str, Callable[[dict, object], Finding]] = {
    "field_in_set": field_in_set,
    "numeric_range": numeric_range,
    "date_field_compare": date_field_compare,
    "value_comparison": value_comparison,
    "conditional_field_present": conditional_field_present,
    "commentary_category_present": commentary_category_present,
    "conditional": conditional,
    "geo_proximity": geo_proximity,
    "photo_face_detected": photo_face_detected,
    "photo_quality_flag": photo_quality_flag,
}