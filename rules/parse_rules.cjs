const fs = require("fs");
const path = require("path");

function findShortField(text, h1Key) {
  if (h1Key) {
    const parts = h1Key.split("/");
    return parts[parts.length - 1];
  }
  return null;
}

function parseRule(rule) {
  const sourceLogic = rule.logic?.source_logic || rule.description || "";
  const h1Key = rule.h1?.field_key;
  const shortField = findShortField(sourceLogic, h1Key);

  // 1. If it is a field presence or simple conditional presence
  if (sourceLogic.toLowerCase().includes("is not provided")) {
    // Extract conditions and required field
    // Usually "If <conditions>, and <field> is not provided" or "If <conditions> and <field> is not provided"
    const isNotProvidedIndex = sourceLogic.toLowerCase().indexOf("is not provided");
    let condPart = "";
    if (isNotProvidedIndex !== -1) {
      // Find the "If " start
      let startIdx = sourceLogic.toLowerCase().indexOf("if ");
      if (startIdx === -1) startIdx = 0;
      else startIdx += 3;
      condPart = sourceLogic.substring(startIdx, isNotProvidedIndex).trim();
      // Strip trailing "and <field>", ", and <field>"
      condPart = condPart.replace(/,?\s+and\s+[a-zA-Z_@0-9]+$/, "").trim();
      condPart = condPart.replace(/^\(/, "").replace(/\)$/, "").trim();
    }

    // Now parse conditions in condPart
    const conditions = [];
    let operator = "AND";
    if (condPart) {
      if (condPart.toLowerCase().includes(" or ")) {
        operator = "OR";
      }
      
      // Parse individual conditions like Field = "Value" or Field = Value
      const condRegex = /([a-zA-Z_@0-9]+)\s*(?:=|<>\s*""|!=)\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z_0-9]+))/g;
      let match;
      while ((match = condRegex.exec(condPart)) !== null) {
        const fieldName = match[1];
        const val = match[2] || match[3] || match[4] || "";
        conditions.push({ field: fieldName, value: val });
      }

      // Support field is provided condition e.g. "LicenseExpirationDate for PartyRoleType = Appraiser"
      // or check for and/or with empty values
      if (conditions.length === 0) {
        // Fallback or simpler parsing
        const simpleMatch = condPart.match(/([a-zA-Z_@0-9]+)\s*=\s*(.*)/);
        if (simpleMatch) {
          conditions.push({ field: simpleMatch[1], value: simpleMatch[2].replace(/"/g, "") });
        }
      }
    }

    if (conditions.length > 0 && h1Key) {
      return {
        type: "conditional_field_present",
        conditions,
        operator,
        required_field: h1Key
      };
    }
  }

  // 2. Comparison Operations like If DwellingCount < 1
  const compMatch = sourceLogic.match(/If\s+([a-zA-Z_@0-9]+)\s*(<|>|<=|>=|==|!=|<>)\s*([0-9a-zA-Z_]+)/i);
  if (compMatch && h1Key) {
    let op = compMatch[2];
    if (op === "<>") op = "!=";
    const compareValRaw = compMatch[3];
    const numVal = parseFloat(compareValRaw);
    return {
      type: "value_comparison",
      operator: op,
      field: h1Key,
      compare_value: isNaN(numVal) ? compareValRaw : numVal
    };
  }

  // 3. Uniqueness checks like Comparable # must be unique
  if (sourceLogic.toLowerCase().includes("must be unique") && h1Key) {
    return {
      type: "uniqueness_check",
      field: h1Key,
      scope: "all_comparable_properties"
    };
  }

  // Default fallback if we cannot parse automatically
  return null;
}

const h1Path = path.join(__dirname, "h1_rules.json");
if (fs.existsSync(h1Path)) {
  const data = JSON.parse(fs.readFileSync(h1Path, "utf8"));
  let converted = 0;
  data.rules.forEach(r => {
    if (r.logic?.type === "needs_encoding") {
      const parsed = parseRule(r);
      if (parsed) {
        r.logic = parsed;
        r.enabled = true; // Enable the successfully converted rules!
        r.updated_at = new Date().toISOString();
        converted++;
      }
    }
  });
  console.log(`Parsed and converted ${converted} rules out of ${data.rules.length}.`);
  if (converted > 0) {
    fs.writeFileSync(path.join(__dirname, "h1_rules.json"), JSON.stringify(data, null, 2), "utf8");
    console.log("Updated h1_rules.json successfully.");
  }
} else {
  console.error("Rules file not found at", h1Path);
}
