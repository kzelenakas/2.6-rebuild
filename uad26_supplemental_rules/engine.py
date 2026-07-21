#!/usr/bin/env python3
"""
UAD 2.6 Supplemental Rules Engine
Adapted from supplemental_rules/engine.py for MISMO v2.6 (VALUATION_RESPONSE root)
"""
import sys
import json
import xml.etree.ElementTree as ET
import re
from datetime import datetime
import urllib.request
import urllib.parse
import math

# Define standard supplemental rules for UAD 2.6
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

    # Try parsing XML if present for deeper XML checks
    root = None
    if xml_string:
        try:
            root = ET.fromstring(xml_string)
        except Exception:
            pass

    # --- Rule 1: GLA vs Room Count (UAD 2.6 field keys) ---
    # UAD 2.6 field keys contain "GrossLivingArea" or "GLA" for subject
    # and "TotalRoomCount", "TotalBedroomCount", "TotalBathroomCount" for rooms
    gla_key = None
    rooms_key = None
    for k in fields.keys():
        kl = k.lower()
        if ("grosslivingarea" in kl or "gla" in kl) and "subject" in kl:
            gla_key = k
        if "totalroomcount" in kl and "subject" in kl:
            rooms_key = k
            
    if not gla_key:
        gla_key = "subject:/VALUATION_RESPONSE/PROPERTY/STRUCTURE/@GrossLivingAreaSquareFeetCount"
    if not rooms_key:
        rooms_key = "subject:/VALUATION_RESPONSE/PROPERTY/STRUCTURE/@TotalRoomCount"

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
    # UAD 2.6: VALUATION/@AppraisalEffectiveDate, REPORT/@AppraiserReportSignedDate
    eff_date_key = None
    sig_date_key = None
    for k in fields.keys():
        kl = k.lower()
        if "appraisaleffectivedate" in kl or "effectivedate" in kl:
            if "valuation" in kl:
                eff_date_key = k
        if "appraiserreportsigneddate" in kl or "signaturedate" in kl or "signeddate" in kl:
            sig_date_key = k
            
    if not eff_date_key:
        eff_date_key = "doc:/VALUATION_RESPONSE/VALUATION/@AppraisalEffectiveDate"
    if not sig_date_key:
        sig_date_key = "doc:/VALUATION_RESPONSE/REPORT/@AppraiserReportSignedDate"
        
    eff_val = get_field_val(eff_date_key)
    sig_val = get_field_val(sig_date_key)
    
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
        kl = k.lower()
        if ("postalcode" in kl or "zipcode" in kl or "zip" == kl.split("@")[-1]) and "subject" in kl:
            zip_key = k
            break
    if not zip_key:
        zip_key = "subject:/VALUATION_RESPONSE/PROPERTY/@_PostalCode"
        
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
        kl = k.lower()
        if ("expirationdate" in kl or "license_expiration" in kl) and ("appraiser" in kl or "certification" in kl):
            exp_key = k
            break
    if not exp_key:
        exp_key = "doc:/VALUATION_RESPONSE/PARTIES/APPRAISER/APPRAISER_LICENSE/@_ExpirationDate"
        
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

    # --- Rule 5: Subject sale price check (if transfer in past year) ---
    # UAD 2.6: LISTING_HISTORY/@ListedWithinPreviousYearIndicator, SALES_CONTRACT/@_Amount
    transfer_key = None
    for k in fields.keys():
        kl = k.lower()
        if "listedwithinpreviousyear" in kl:
            transfer_key = k
            break
    if not transfer_key:
        transfer_key = "subject:/VALUATION_RESPONSE/PROPERTY/LISTING_HISTORY/@ListedWithinPreviousYearIndicator"
        
    transfer_val = get_field_val(transfer_key)
    if transfer_val and str(transfer_val).strip().lower() in ("yes", "true", "1", "y"):
        price_key = None
        for k in fields.keys():
            kl = k.lower()
            if "priorsaleprice" in kl or "priortransferprice" in kl:
                price_key = k
                break
        if not price_key:
            price_key = "subject:/VALUATION_RESPONSE/PROPERTY/SALES_CONTRACT/@_Amount"
            
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
    # UAD 2.6 structure: VALUATION_RESPONSE/VALUATION_METHODS/SALES_COMPARISON/COMPARABLE_SALE/LOCATION
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
        address_el = find_child(property_el, "LOCATION")
        if address_el is None:
            return None
        line = child_text(address_el, "PropertyStreetAddress")
        if not line:
            return None
        city = child_text(address_el, "PropertyCity") or ""
        state = child_text(address_el, "PropertyState") or ""
        postal = child_text(address_el, "PropertyPostalCode") or ""
        return f"{line}, {city}, {state} {postal}".strip().strip(",").strip()

    _MILES_PER_UNIT = {"Miles": 1.0, "Feet": 1.0 / 5280.0, "Kilometers": 0.621371}

    def comp_reported_distance_miles(property_el):
        el = find_descendant(property_el, "ProximityToSubjectDescription")
        if el is None or not el.text:
            return None
        # UAD 2.6 stores proximity as text description like "0.5 miles"
        # Try to parse numeric value
        import re
        match = re.search(r"([\d.]+)", el.text)
        if not match:
            return None
        try:
            return float(match.group(1))
        except ValueError:
            return None

    def geocode_address(address, api_key):
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
        # Find subject PROPERTY
        subject_el = None
        for prop in root.iter():
            if local_tag(prop.tag) == "PROPERTY":
                # Check if this is subject (first PROPERTY or has no PropertySequenceIdentifier)
                seq_id = prop.get("_SequenceIdentifier") or prop.get("PropertySequenceIdentifier")
                if not seq_id or seq_id in ("0", "1"):
                    subject_el = prop
                    break
        
        subject_address_full = property_address(subject_el) if subject_el is not None else None
        sub_coords = geocode_address(subject_address_full, google_maps_api_key) if subject_address_full else None

        if sub_coords:
            # Find COMPARABLE_SALE elements
            comp_els = []
            for comp in root.iter():
                if local_tag(comp.tag) == "COMPARABLE_SALE":
                    comp_els.append(comp)
            
            for idx, comp_el in enumerate(comp_els, start=1):
                comp_addr = property_address(comp_el)
                reported_miles = comp_reported_distance_miles(comp_el)
                if not comp_addr or reported_miles is None:
                    continue
                comp_coords = geocode_address(comp_addr, google_maps_api_key)
                if comp_coords is None:
                    continue
                computed_miles = haversine_distance(sub_coords, comp_coords)
                if abs(computed_miles - reported_miles) > 1.0:
                    # Try to get comp label from PropertySequenceIdentifier
                    label = comp_el.get("PropertySequenceIdentifier", str(idx))
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
    # DISABLED - requires real multimodal analysis, not placeholder data
    # Do NOT re-enable with placeholder data

    return findings

if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({"findings": [], "error": "No input received"}))
            sys.exit(0)
            
        data = json.loads(input_data)
        findings = run_checks(data)
        
        # Assign random IDs in 20M+ range to avoid collision with JS findings
        import random
        for idx, f in enumerate(findings):
            f["id"] = random.randint(20000000, 30000000)
            
        print(json.dumps({"findings": findings}))
    except Exception as e:
        print(json.dumps({"findings": [], "error": str(e)}))