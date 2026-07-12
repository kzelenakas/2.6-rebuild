# Supplemental Rules Engine (Python)

This directory contains the **Supplemental Rules Engine** written in Python 3. It is incorporated into the main UAD 3.6 Appraisal QC application as a separate process to preserve the existing file processing pipeline while allowing advanced or highly custom Python-based validations to run.

## Architecture & Data Flow

1. **Trigger**: When an appraisal XML report is uploaded or evaluated, the Node.js backend (`evaluateReport` in `src/server/engine.ts`) runs the standard TypeScript rules engine first.
2. **Process Spawn**: Node.js then spawns a separate Python process to run `python3 supplemental_rules/engine.py`.
3. **Payload Exchange**:
   - **Input**: The Node.js parent process passes a JSON payload containing the parsed normalized field values and the raw XML string to the Python process via standard input (`stdin`).
   - **Output**: The Python process executes its checks, generates findings matching the system's `Finding` interface, and outputs a single JSON response to standard output (`stdout`).
4. **Merge**: The Node.js parent process parses this stdout JSON and merges the supplemental findings into the main findings array returned to the frontend.

## Included Python Rules

Currently, the engine evaluates 5 highly relevant appraisal-specific supplemental checks:

* **SUPP-001 (Warning)**: **Gross Living Area vs. Room Count**: Checks if the GLA is extremely small (< 500 sq ft) while the room count is high (> 5), suggesting a potential data entry error.
* **SUPP-002 (HardStop)**: **Valuation Date vs. Signature/Report Date**: Ensures that the Effective Date of Valuation does not occur in the future relative to the Signature/Report Date.
* **SUPP-003 (Warning)**: **Subject ZIP Code Format**: Validates that the subject property postal code strictly conforms to standard 5-digit or 9-digit US ZIP formats.
* **SUPP-004 (Warning)**: **Appraiser License Expiration**: Compares the appraiser's state certification expiration date against the signature date (or today's date) and flags if it has expired.
* **SUPP-005 (Advisory)**: **Subject Transfer Price Check**: If the property had a prior transfer or sale within the past 12 months, this rule checks if a prior sale price has been disclosed.

## Extending & Modifying Rules

You can add any new custom rules directly to the `run_checks(data)` function in `supplemental_rules/engine.py`. 

### Expected Output Structure

To ensure compatibility with the frontend and export systems, each finding returned by your Python script **must** adhere to this dictionary structure:

```python
findings.append({
    "rule_id": "YOUR-RULE-ID",
    "category": "Supplemental Guidelines",
    "severity": "HardStop" | "Warning" | "Advisory",
    "message_appraiser": "Coaching/instructive message shown to the appraiser",
    "message_reviewer": "Precise audit-grade message shown to the QC reviewer",
    "field_path": "Relevant/Field/Path",
    "xpath": "/ValuationReport/Relevant/XPath",  # Optional (or None)
    "section": "Section Name",                    # Optional (or None)
    "values": {"Field/Path": "Value"},            # Dictionary of checked inputs
    "citation": "E.g., Fannie Mae B4-1.3",        # Optional (or None)
    "appraiser_checked": False,
    "reviewer_status": "pending",
    "reviewer_note": None,
    "reviewed_at": None
})
```

The system automatically assigns unique transaction IDs to each supplemental finding.

## Testing Separately

You can run and test the Python rules engine independently in your shell:

```bash
echo '{"fields": {"Subject/GLA": {"value": "450"}, "Subject/Rooms": {"value": "6"}}}' | python3 supplemental_rules/engine.py
```
