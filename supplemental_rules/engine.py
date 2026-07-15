#!/usr/bin/env python3
import sys
import json
import xml.etree.ElementTree as ET
import re
from datetime import datetime
import random
import math
import hashlib
import urllib.request
import urllib.parse

# Define standard supplemental rules definitions
SUPPLEMENTAL_RULES = [
    {
        "rule_id": "SUPP-001",
        "category": "Supplemental Guidelines",
        "severity": "Warning",
        "description": "Gross Living Area vs. Room Count inconsistency check.",
        "citation": "Fannie Mae Selling Guide B4-1.3",
        "message_appraiser": "The reported Gross Living Area is extremely small relative to the total room count. Please verify that GLA and room counts are accurate.",
        "message_reviewer": "GLA is less than 500 sq ft but Room Count is greater than 5. Possible data entry error or inconsistency."
    },
    {
        "rule_id": "SUPP-002",
        "category": "Supplemental Guidelines",
        "severity": "HardStop",
        "description": "Valuation Effective Date must be in the past relative to the Signature/Report Date.",
        "citation": "USPAP Standards Rule 2-2",
        "message_appraiser": "The Effective Date of Valuation cannot be after the Signature/Report Date. Please correct the dates.",
        "message_reviewer": "The valuation effective date is in the future relative to the signature date of the report."
    },
    {
        "rule_id": "SUPP-003",
        "category": "Supplemental Guidelines",
        "severity": "Warning",
        "description": "Subject property ZIP code format validation.",
        "citation": "UAD Specification Section 2.1",
        "message_appraiser": "The subject property ZIP code must be in either 5-digit (e.g. 12345) or 9-digit (e.g. 12345-6789) format.",
        "message_reviewer": "Subject ZIP code does not conform to 5-digit or 9-digit postal standard."
    },
    {
        "rule_id": "SUPP-004",
        "category": "Supplemental Guidelines",
        "severity": "Warning",
        "description": "Appraiser license expiration date check.",
        "citation": "Fannie Mae Selling Guide B4-1.1-02",
        "message_appraiser": "The appraiser's license appears to be expired. Please verify and provide an active license date.",
        "message_reviewer": "The appraiser's state certification expiration date is in the past."
    },
    {
        "rule_id": "SUPP-005",
        "category": "Supplemental Guidelines",
        "severity": "Advisory",
        "description": "Subject sale price check if there is a transfer in the past year.",
        "citation": "Fannie Mae Form 1004",
        "message_appraiser": "A transfer or sale of the subject property was recorded within the past year. Verify that the previous sale price is disclosed.",
        "message_reviewer": "Subject property had a transfer in the last 12 months, previous sale price check suggested."
    },
    {
        "rule_id": "SUPP-006",
        "category": "Supplemental Guidelines",
        "severity": "Warning",
        "description": "Location Verification and proximity check.",
        "citation": "Fannie Mae Selling Guide B4-1.3-01",
        "message_appraiser": "Comparable property proximity shows a discrepancy with calculated distance. Please verify coordinates and distances.",
        "message_reviewer": "Discrepancy detected between reported proximity and computed distance for comparable sale."
    },
    {
        "rule_id": "SUPP-007",
        "category": "Supplemental Guidelines",
        "severity": "Warning",
        "description": "Multimodal Photo Audit for quality, views, and seasonal consistency.",
        "citation": "Fannie Mae Selling Guide B4-1.2-01",
        "message_appraiser": "A potential seasonal discrepancy or view/quality issue was identified on report photos. Please check comparable photographs.",
        "message_reviewer": "Visual discrepancy or seasonal mismatch identified in comparable photographs."
    }
]

def run_checks(data):
    fields = data.get("fields", {})
    xml_string = data.get("xmlString", "")
    
    findings = []
    
    # Helper to get field value safely
    def get_field_val(name):
        f = fields.get(name)
        if isinstance(f, dict):
            return f.get("value")
        return None

    def get_field_details(name):
        f = fields.get(name)
        if isinstance(f, dict):
            return f.get("xpath"), f.get("section")
        return None, None

    # Try parsing XML if present to do deeper XML checks
    root = None
    if xml_string:
        try:
            root = ET.fromstring(xml_string)
        except Exception as e:
            # XML parse error can be ignored or logged
            pass

    # --- Rule 1: GLA vs Room Count ---
    gla_key = None
    rooms_key = None
    for k in fields.keys():
        if "grosslivingarea" in k.lower() or "gla" in k.lower():
            gla_key = k
        if "roomcount" in k.lower() or "room_count" in k.lower() or "totalrooms" in k.lower() or "total_rooms" in k.lower():
            rooms_key = k
            
    if not gla_key:
        gla_key = "Subject/GLA"
    if not rooms_key:
        rooms_key = "Subject/Rooms"

    gla_val = get_field_val(gla_key)
    rooms_val = get_field_val(rooms_key)
    
    if gla_val and rooms_val:
        try:
            gla = float(str(gla_val).replace(",", ""))
            rooms = int(str(rooms_val).replace(",", ""))
            if gla < 500 and rooms > 5:
                xpath, section = get_field_details(gla_key)
                findings.append({
                    "rule_id": "SUPP-001",
                    "category": "Supplemental Guidelines",
                    "severity": "Warning",
                    "message_appraiser": SUPPLEMENTAL_RULES[0]["message_appraiser"],
                    "message_reviewer": SUPPLEMENTAL_RULES[0]["message_reviewer"],
                    "field_path": gla_key,
                    "xpath": xpath,
                    "section": section,
                    "values": {gla_key: str(gla_val), rooms_key: str(rooms_val)},
                    "citation": SUPPLEMENTAL_RULES[0]["citation"],
                    "appraiser_checked": False,
                    "reviewer_status": "pending",
                    "reviewer_note": None,
                    "reviewed_at": None
                })
        except Exception:
            pass

    # --- Rule 2: Valuation Date vs Signature/Report Date ---
    eff_date_key = None
    sig_date_key = None
    for k in fields.keys():
        if "valuationdate" in k.lower() or "effective_date" in k.lower() or "effectivedate" in k.lower():
            eff_date_key = k
        if "signaturedate" in k.lower() or "reportdate" in k.lower() or "signed_date" in k.lower():
            sig_date_key = k
            
    if not eff_date_key:
        eff_date_key = "Subject/EffectiveDate"
    if not sig_date_key:
        sig_date_key = "Appraiser/SignatureDate"
        
    eff_val = get_field_val(eff_date_key)
    sig_val = get_field_val(sig_date_key)
    
    sig_dt = None
    if eff_val and sig_val:
        def parse_date(d_str):
            for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y%m%d"):
                try:
                    return datetime.strptime(str(d_str).strip(), fmt)
                except ValueError:
                    continue
            return None
            
        eff_dt = parse_date(eff_val)
        sig_dt = parse_date(sig_val)
        
        if eff_dt and sig_dt and eff_dt > sig_dt:
            xpath, section = get_field_details(eff_date_key)
            findings.append({
                "rule_id": "SUPP-002",
                "category": "Supplemental Guidelines",
                "severity": "HardStop",
                "message_appraiser": SUPPLEMENTAL_RULES[1]["message_appraiser"],
                "message_reviewer": SUPPLEMENTAL_RULES[1]["message_reviewer"],
                "field_path": eff_date_key,
                "xpath": xpath,
                "section": section,
                "values": {eff_date_key: str(eff_val), sig_date_key: str(sig_val)},
                "citation": SUPPLEMENTAL_RULES[1]["citation"],
                "appraiser_checked": False,
                "reviewer_status": "pending",
                "reviewer_note": None,
                "reviewed_at": None
            })

    # --- Rule 3: Subject Zip Code Format ---
    zip_key = None
    for k in fields.keys():
        if "postalcode" in k.lower() or "zipcode" in k.lower() or "zip" in k.lower():
            if "subject" in k.lower() or "property" in k.lower():
                zip_key = k
                break
    if not zip_key:
        zip_key = "Subject/PostalCode"
        
    zip_val = get_field_val(zip_key)
    if zip_val:
        zip_str = str(zip_val).strip()
        if not re.match(r"^\d{5}(-\d{4})?$", zip_str):
            xpath, section = get_field_details(zip_key)
            findings.append({
                "rule_id": "SUPP-003",
                "category": "Supplemental Guidelines",
                "severity": "Warning",
                "message_appraiser": SUPPLEMENTAL_RULES[2]["message_appraiser"],
                "message_reviewer": SUPPLEMENTAL_RULES[2]["message_reviewer"],
                "field_path": zip_key,
                "xpath": xpath,
                "section": section,
                "values": {zip_key: zip_str},
                "citation": SUPPLEMENTAL_RULES[2]["citation"],
                "appraiser_checked": False,
                "reviewer_status": "pending",
                "reviewer_note": None,
                "reviewed_at": None
            })

    # --- Rule 4: Appraiser License Expiration ---
    exp_key = None
    for k in fields.keys():
        if "expirationdate" in k.lower() or "license_expiration" in k.lower() or "licensedecline" in k.lower():
            if "appraiser" in k.lower() or "certification" in k.lower():
                exp_key = k
                break
    if not exp_key:
        exp_key = "Appraiser/LicenseExpirationDate"
        
    exp_val = get_field_val(exp_key)
    if exp_val:
        def parse_date(d_str):
            for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y%m%d"):
                try:
                    return datetime.strptime(str(d_str).strip(), fmt)
                except ValueError:
                    continue
            return None
            
        exp_dt = parse_date(exp_val)
        if exp_dt:
            compare_date = sig_dt if sig_dt else datetime.now()
            if exp_dt < compare_date:
                xpath, section = get_field_details(exp_key)
                findings.append({
                    "rule_id": "SUPP-004",
                    "category": "Supplemental Guidelines",
                    "severity": "Warning",
                    "message_appraiser": SUPPLEMENTAL_RULES[3]["message_appraiser"],
                    "message_reviewer": SUPPLEMENTAL_RULES[3]["message_reviewer"] + f" (Expired on {exp_val})",
                    "field_path": exp_key,
                    "xpath": xpath,
                    "section": section,
                    "values": {exp_key: str(exp_val)},
                    "citation": SUPPLEMENTAL_RULES[3]["citation"],
                    "appraiser_checked": False,
                    "reviewer_status": "pending",
                    "reviewer_note": None,
                    "reviewed_at": None
                })

    # --- Rule 5: Subject sale price check (if there is a transfer in the past year) ---
    transfer_key = None
    for k in fields.keys():
        if "priorsearch" in k.lower() or "priortransfer" in k.lower() or "sub_prior" in k.lower():
            transfer_key = k
            break
    if not transfer_key:
        transfer_key = "Subject/PriorTransfer"
        
    transfer_val = get_field_val(transfer_key)
    if transfer_val and str(transfer_val).strip().lower() in ("yes", "true", "1", "y"):
        price_key = None
        for k in fields.keys():
            if "priorsaleprice" in k.lower() or "priortransferprice" in k.lower():
                price_key = k
                break
        if not price_key:
            price_key = "Subject/PriorSalePrice"
            
        price_val = get_field_val(price_key)
        if not price_val or str(price_val).strip() == "":
            xpath, section = get_field_details(price_key)
            findings.append({
                "rule_id": "SUPP-005",
                "category": "Supplemental Guidelines",
                "severity": "Advisory",
                "message_appraiser": SUPPLEMENTAL_RULES[4]["message_appraiser"],
                "message_reviewer": SUPPLEMENTAL_RULES[4]["message_reviewer"],
                "field_path": price_key,
                "xpath": xpath,
                "section": section,
                "values": {transfer_key: str(transfer_val), price_key: str(price_val)},
                "citation": SUPPLEMENTAL_RULES[4]["citation"],
                "appraiser_checked": False,
                "reviewer_status": "pending",
                "reviewer_note": None,
                "reviewed_at": None
            })

    # --- Rule 6: Location Verification (SUPP-006) ---
    # Runs ONLY on real data pulled from the report. An earlier version fell back to
    # hard-coded demo addresses/coordinates and ALWAYS emitted a finding, fabricating a
    # location result on every report; that was fixed to "no real data -> no finding" but
    # the replacement still looked up flat keys ("Subject/Address", "Comp1Proximity")
    # that don't exist in this project's field manifest (subject/doc fields are keyed by
    # full MISMO XPath, e.g. "subject:VALUATION_ANALYSIS/.../ADDRESS/AddressLineText" --
    # see schemas/uad36_field_manifest.json) and parsed a freeform "X miles" proximity
    # string that UAD 3.6 doesn't use. Both bugs meant SUPP-006 could never fire against
    # a real report. Fixed: read subject/comparable ADDRESS and the comp's structured
    # <ProximityToSubjectDistanceLinearMeasure LinearUnitOfMeasureType="..."> straight off
    # the parsed XML (namespace-agnostic, mirrors collateral_risk/resolve.py's approach),
    # no regex-parsing of a reported-distance string needed -- UAD 3.6 already reports it
    # as a real number.
    google_maps_api_key = data.get("google_maps_api_key", "")

    def local_tag(tag):
        return tag.rsplit("}", 1)[-1] if "}" in tag else tag

    def find_child(el, tag_name):
        for child in el:
            if local_tag(child.tag) == tag_name:
                return child
        return None

    def find_descendant(el, tag_name):
        for node in el.iter():
            if local_tag(node.tag) == tag_name:
                return node
        return None

    def child_text(el, tag_name):
        child = find_child(el, tag_name)
        return child.text.strip() if child is not None and child.text else None

    def property_address(property_el):
        address_el = find_child(property_el, "ADDRESS")
        if address_el is None:
            return None
        line = child_text(address_el, "AddressLineText")
        if not line:
            return None
        city = child_text(address_el, "CityName") or ""
        state = child_text(address_el, "StateCode") or ""
        postal = child_text(address_el, "PostalCode") or ""
        return f"{line}, {city}, {state} {postal}".strip().strip(",").strip()

    _MILES_PER_UNIT = {"Miles": 1.0, "Feet": 1.0 / 5280.0, "Kilometers": 0.621371}

    def comp_reported_distance_miles(property_el):
        # Anywhere under the comp's PROPERTY subtree -- UAD 3.6 nests it under
        # COMPARABLE/COMPARABLE_DETAIL, but this isn't hardcoded to that depth.
        el = find_descendant(property_el, "ProximityToSubjectDistanceLinearMeasure")
        if el is None or not el.text:
            return None
        unit = el.get("LinearUnitOfMeasureType", "Miles")
        factor = _MILES_PER_UNIT.get(unit)
        if factor is None:
            return None  # unrecognized unit -- don't guess
        try:
            return float(el.text) * factor
        except ValueError:
            return None

    def geocode_address(address, api_key):
        # No fabricated fallback: return None when we can't geocode for real.
        if not api_key or not address:
            return None
        try:
            query = urllib.parse.urlencode({"address": address, "key": api_key})
            url = f"https://maps.googleapis.com/maps/api/geocode/json?{query}"
            req = urllib.request.Request(url, headers={"User-Agent": "Python-UAD-QC"})
            with urllib.request.urlopen(req, timeout=5) as response:
                res_data = json.loads(response.read().decode())
                if res_data.get("status") == "OK" and res_data.get("results"):
                    location = res_data["results"][0]["geometry"]["location"]
                    return float(location["lat"]), float(location["lng"])
        except Exception:
            pass
        return None

    def haversine_distance(coords1, coords2):
        lat1, lon1 = coords1
        lat2, lon2 = coords2
        R = 3958.8
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat / 2) * math.sin(dlat / 2) + \
            math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
            math.sin(dlon / 2) * math.sin(dlon / 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c

    discrepancy_details = []
    if root is not None:
        # PROPERTIES contains repeating PROPERTY children (subject + comparables) --
        # walk them directly rather than re-searching the whole doc per property.
        properties_node = find_descendant(root, "PROPERTIES")
        property_nodes = [c for c in properties_node if local_tag(c.tag) == "PROPERTY"] if properties_node is not None else []

        subject_el = next((p for p in property_nodes if p.get("ValuationUseType") == "SubjectProperty"), None)
        subject_address_full = property_address(subject_el) if subject_el is not None else None
        sub_coords = geocode_address(subject_address_full, google_maps_api_key) if subject_address_full else None

        if sub_coords:
            comp_els = [p for p in property_nodes if p.get("ValuationUseType") == "SalesComparable"]
            for idx, comp_el in enumerate(comp_els, start=1):
                comp_addr = property_address(comp_el)
                reported_miles = comp_reported_distance_miles(comp_el)
                # Skip comps without BOTH a real address and a real reported distance —
                # never invent them.
                if not comp_addr or reported_miles is None:
                    continue
                comp_coords = geocode_address(comp_addr, google_maps_api_key)
                if comp_coords is None:
                    continue
                computed_miles = haversine_distance(sub_coords, comp_coords)
                if abs(computed_miles - reported_miles) > 1.0:
                    ordinal_el = find_descendant(comp_el, "PropertyOrdinalNumber")
                    label = ordinal_el.text if ordinal_el is not None and ordinal_el.text else str(idx)
                    discrepancy_details.append(
                        f"Comp {label} is {computed_miles:.2f} miles away, but reported as {reported_miles:.2f} miles"
                    )

    if discrepancy_details:
        findings.append({
            "rule_id": "SUPP-006",
            "category": "Supplemental Guidelines",
            "severity": "Warning",
            "message_appraiser": "Comparable property proximity check shows a discrepancy with calculated physical distances. Please verify the reported proximity details.",
            "message_reviewer": f"Location Verification: {'; '.join(discrepancy_details)}.",
            "field_path": "",
            "xpath": None,
            "section": "Sales Comparison Approach",
            "values": {"discrepancies": "; ".join(discrepancy_details)},
            "citation": "Fannie Mae Selling Guide B4-1.3-01",
            "appraiser_checked": False,
            "reviewer_status": "pending",
            "reviewer_note": None,
            "reviewed_at": None
        })

    # --- Rule 7: Multimodal Photo Audit (SUPP-007) ---
    # DISABLED. The previous implementation always emitted a hard-coded Warning with
    # stock Unsplash photos and a fixed "green summer foliage / January 15, 2026"
    # narrative regardless of the actual report — a fabricated finding on every run.
    # Real multimodal photo analysis is not wired yet; emit nothing until it is.
    # Do NOT re-enable with placeholder data.

    return findings

if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({"findings": [], "error": "No input received"}))
            sys.exit(0)
            
        data = json.loads(input_data)
        findings = run_checks(data)
        
        for idx, f in enumerate(findings):
            f["id"] = random.randint(20000000, 30000000)
            
        print(json.dumps({"findings": findings}))
    except Exception as e:
        print(json.dumps({"findings": [], "error": str(e)}))
