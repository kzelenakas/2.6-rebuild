# UAD 3.6 Compliance Rule Engine: JSON Rules Schema

This document outlines the JSON schema, logical operator options, and metadata format used by the UAD 3.6 Quality Control (QC) compliance rule encoder. This specification is designed to be easily copied and pasted into external validation, testing, or development tools.

---

## 1. Top-Level Rule Structure

Each compliance rule is defined as an object containing basic metadata (identifying details, category, severity), standard rule logic, historical or audit metadata, and automated AI audit verification results.

```json
{
  "rule_id": "UAD1001",
  "category": "Subject Property",
  "description": "If AddressLineText is not provided",
  "severity": "HardStop",
  "enabled": true,
  "logic": {
    "type": "field_present",
    "field": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ADDRESS/AddressLineText"
  },
  "citation": "UAD 3.6 Appendix H-1 v1.4, Unique ID 0100.0007, Message ID UAD1001",
  "messages": {
    "reviewer": "Provide the address line for the subject property physical address."
  },
  "h1": {
    "unique_id": "0100.0007",
    "property_affected": "Subject",
    "report_subsection": "{No Subsection}",
    "data_point": "AddressLineText",
    "min_value": "",
    "max_value": "",
    "date_format": "",
    "field_key": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ADDRESS/AddressLineText"
  },
  "ai_verification": {
    "approved": true,
    "score": 0.95,
    "remarks": "The rule logic perfectly mirrors the natural language description to verify the mandatory AddressLineText element presence.",
    "proposed_logic": {
      "type": "field_present",
      "field": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ADDRESS/AddressLineText"
    }
  },
  "updated_at": "2026-07-12T12:55:01.044Z"
}
```

---

## 2. Core Metadata Parameters

| Property Name | Type | Description |
| :--- | :--- | :--- |
| `rule_id` | `string` | Unique identifier code (e.g., `"UAD1001"`). |
| `category` | `string` | Section/functional category (e.g., `"Subject Property"`, `"Neighborhood"`, `"Sales Comparison"`). |
| `description` | `string` | Plain-english description of what triggers the warning/fault. |
| `severity` | `string` | Enforcement severity: `"HardStop"`, `"Warning"`, or `"Advisory"`. |
| `enabled` | `boolean` | Determines whether the rule is executed during an active QC run. |
| `logic` | `object` | The executable block evaluated by the compliance engine. |
| `citation` | `string` | Reference citation from official Fannie Mae/Freddie Mac UAD specifications. |
| `messages` | `object` | Human-readable instructions/messages displayed to the appraiser or reviewer. |
| `h1` | `object` | Mapping information referencing raw Appendix H-1 spreadsheet structures. |
| `ai_verification`| `object` | Instant compliance verification audit report generated during rule authorship. |

---

## 3. Logical Engine Operations (`logic`)

The `logic` object drives execution on appraisal reports. The engine matches the `type` parameter to execute tailored validation checks.

### 3.1 `field_present`
Triggers when a target field is empty, null, or missing.
```json
{
  "type": "field_present",
  "field": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ADDRESS/AddressLineText"
}
```

### 3.2 `regex_match`
Triggers when a populated field **fails** to match the specified regular expression pattern (implicit full-line matching standard).
```json
{
  "type": "regex_match",
  "field": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ADDRESS/PostalCode",
  "pattern": "^\\d{5}(-\\d{4})?$"
}
```

### 3.3 `field_in_set`
Triggers when a populated field **fails** to match one of the values specified in the allowed set.
```json
{
  "type": "field_in_set",
  "field": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/VALUATION_METHOD/ValuationMethodType",
  "allowed": ["CostApproach", "IncomeApproach", "SalesComparisonApproach"]
}
```

### 3.4 `numeric_range`
Triggers when a numeric field is out of bounds (can specify either `min`, `max`, or both). Commas are automatically ignored during execution.
```json
{
  "type": "numeric_range",
  "field": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SITE/SiteAreaSquareFeetNum",
  "min": 1,
  "max": 10000000
}
```

### 3.5 `ai`
Evaluates context dynamically using an LLM model when deterministic rule matching is impossible or excessively complex.
```json
{
  "type": "ai",
  "prompt": "Evaluate whether the contract date is after the signature date of the appraisal.",
  "fields": [
    "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/CONTRACT/ContractDate",
    "subject:VALUATION_ANALYSIS/SIGNATURE/SignatureDate"
  ]
}
```

### 3.6 `conditional_field_present`
Evaluates whether a secondary field is missing conditional upon other pre-requisite field states.
```json
{
  "type": "conditional_field_present",
  "operator": "AND",
  "conditions": [
    {
      "field": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/VALUATION/HasPriorSaleIndicator",
      "value": "true"
    }
  ],
  "required_field": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/VALUATION/PriorSalePrice"
}
```

### 3.7 `value_comparison`
Triggers if an inequality comparison between a field and a comparison value (which can be a static string/number or another field name) is met.
* **Operators supported:** `<`, `>`, `<=`, `>=`, `==`, `!=`
```json
{
  "type": "value_comparison",
  "field": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/VALUATION/AppraisedValue",
  "operator": "<",
  "compare_value": "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/CONTRACT/ContractPrice"
}
```

### 3.8 `uniqueness_check`
Scans XML nodes within a given scope (e.g., `"all_comparable_properties"`) to detect duplicates of a specific XML data field path.
```json
{
  "type": "uniqueness_check",
  "scope": "all_comparable_properties",
  "field": "ADDRESS/AddressLineText"
}
```

### 3.9 `instance_count`
Triggers when the count of specified child elements matching conditions deviates from an expected count parameter.
```json
{
  "type": "instance_count",
  "target_element": "COMPARABLE_PROPERTY",
  "conditions": [
    {
      "field": "Type",
      "value": "Comparable"
    }
  ],
  "field": "subject:VALUATION_ANALYSIS/SALES_COMPARISON/ComparablePropertiesCount",
  "operator": "!="
}
```

---

## 4. AI Verification Report Metadata Structure (`ai_verification`)

Rules populated by the integrated AI compliance review and verification engine include audit scores and human-readable feedback.

```json
{
  "approved": "boolean (true if the logic matches perfectly and passes high-accuracy compliance check)",
  "score": "number (0.0 to 1.0 indicating confidence and accuracy metric)",
  "remarks": "string (professional evaluation, potential gap notes, or verification rationale)",
  "proposed_logic": "object (exact copy of the executable logic structure that was verified)"
}
```
