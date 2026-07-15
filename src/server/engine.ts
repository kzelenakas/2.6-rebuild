import { NormalizedReport } from "./parser";
import { Rule } from "./db";
import { evaluateAiRule } from "./suggester";
import { DOMParser } from "@xmldom/xmldom";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export interface Finding {
  id: number;
  rule_id: string;
  category: string;
  severity: "HardStop" | "Warning" | "Advisory";
  message_appraiser: string;
  message_reviewer: string;
  field_path: string;
  xpath: string | null;
  section: string | null;
  values: Record<string, string | null>;
  citation: string | null;
  appraiser_checked: boolean;
  reviewer_status: string;
  reviewer_note: string | null;
  reviewed_at: string | null;
}

export interface RuleError {
  rule_id: string;
  error_type: string;
  detail: string;
}

export interface RunResult {
  findings: Finding[];
  rule_errors: RuleError[];
}

// Helpers for rule resolution and XML DOM evaluation
function findFieldKey(report: NormalizedReport, fieldNameOrKey: string): string | null {
  if (!fieldNameOrKey) return null;
  if (report.fields[fieldNameOrKey]) return fieldNameOrKey;

  const lowerName = fieldNameOrKey.toLowerCase();
  for (const key of Object.keys(report.fields)) {
    if (key.toLowerCase() === lowerName) return key;
    if (key.toLowerCase().endsWith("/" + lowerName)) return key;
    if (key.toLowerCase().endsWith("@" + lowerName)) return key;
  }
  return null;
}

function getElementsByTagName(node: any, tagName: string): any[] {
  const result: any[] = [];
  function traverse(n: any) {
    if (!n) return;
    if (n.nodeType === 1 && (n.localName === tagName || n.nodeName === tagName)) {
      result.push(n);
    }
    let child = n.firstChild;
    while (child) {
      traverse(child);
      child = child.nextSibling;
    }
  }
  traverse(node);
  return result;
}

function getNodeValue(node: any, path: string): string | null {
  if (!node) return null;
  const parts = path.split("/");
  let current = node;
  for (const part of parts) {
    if (!current) return null;
    if (part.startsWith("@")) {
      const attr = part.slice(1);
      return current.getAttribute ? current.getAttribute(attr) : null;
    }
    let found = null;
    let child = current.firstChild;
    while (child) {
      if (child.nodeType === 1 && (child.localName === part || child.nodeName === part)) {
        found = child;
        break;
      }
      child = child.nextSibling;
    }
    current = found;
  }
  return current ? (current.textContent || null) : null;
}

async function runPythonSupplementalRules(report: NormalizedReport): Promise<Finding[]> {
  return new Promise((resolve) => {
    try {
      // Allow ops to disable the Python engine entirely (e.g. until the photo/geocode
      // analysis is wired to real data) without touching code.
      if (process.env.QC_DISABLE_SUPPLEMENTAL === "1" || process.env.QC_DISABLE_SUPPLEMENTAL === "true") {
        return resolve([]);
      }

      const scriptPath = path.join(process.cwd(), "supplemental_rules", "engine.py");

      if (!fs.existsSync(scriptPath)) {
        console.warn(`Python supplemental rules engine not found at: ${scriptPath}`);
        return resolve([]);
      }

      // Interpreter is configurable: "python3" is absent on many Windows dev machines
      // (where the binary is "python"), which silently skips supplemental rules.
      const pythonBin = process.env.QC_PYTHON_BIN || "python3";
      const pythonProcess = spawn(pythonBin, [scriptPath]);
      let stdoutData = "";
      let stderrData = "";

      const payload = JSON.stringify({
        fields: report.fields,
        xmlString: report.xmlString || "",
        google_maps_api_key: process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "",
        gemini_api_key: process.env.GEMINI_API_KEY || ""
      });

      pythonProcess.stdout.on("data", (data) => {
        stdoutData += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        stderrData += data.toString();
      });

      pythonProcess.on("error", (err) => {
        console.error("Failed to start Python supplemental rules process:", err);
        resolve([]);
      });

      // A failed spawn (e.g. QC_PYTHON_BIN pointing at a binary that doesn't
      // exist -- "python3" vs Windows' "python") surfaces as an 'error' event
      // on the stdin pipe itself, separately from the ChildProcess 'error'
      // event above. Without a listener here, that's an unhandled error event
      // that crashes the entire Node process, not just this one request.
      pythonProcess.stdin.on("error", (err) => {
        console.error("Python supplemental rules process stdin error:", err);
        resolve([]);
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          console.error(`Python supplemental rules process exited with code ${code}. Stderr: ${stderrData}`);
          return resolve([]);
        }

        try {
          const result = JSON.parse(stdoutData.trim());
          if (result.error) {
            console.error("Python supplemental rules engine error:", result.error);
            return resolve([]);
          }
          resolve(result.findings || []);
        } catch (parseErr) {
          console.error("Failed to parse Python supplemental rules output:", parseErr, "Raw output:", stdoutData);
          resolve([]);
        }
      });

      pythonProcess.stdin.write(payload);
      pythonProcess.stdin.end();
    } catch (err) {
      console.error("Error running Python supplemental rules:", err);
      resolve([]);
    }
  });
}

async function runPythonCollateralRisk(report: NormalizedReport): Promise<Finding[]> {
  return new Promise((resolve) => {
    try {
      if (process.env.QC_DISABLE_COLLATERAL_RISK === "1" || process.env.QC_DISABLE_COLLATERAL_RISK === "true") {
        return resolve([]);
      }

      const packageDir = path.join(process.cwd(), "collateral_risk");

      if (!fs.existsSync(packageDir)) {
        console.warn(`Python collateral risk engine not found at: ${packageDir}`);
        return resolve([]);
      }

      // run_entrypoint.py uses relative imports (part of the collateral_risk package),
      // so it must run as a module (-m) from repo root, not as a direct script path.
      const pythonBin = process.env.QC_PYTHON_BIN || "python3";
      const pythonProcess = spawn(pythonBin, ["-m", "collateral_risk.run_entrypoint"], { cwd: process.cwd() });
      let stdoutData = "";
      let stderrData = "";

      const payload = JSON.stringify({
        fields: report.fields,
        xmlString: report.xmlString || "",
        google_maps_api_key: process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "",
        gemini_api_key: process.env.GEMINI_API_KEY || ""
      });

      pythonProcess.stdout.on("data", (data) => {
        stdoutData += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        stderrData += data.toString();
      });

      pythonProcess.on("error", (err) => {
        console.error("Failed to start Python collateral risk process:", err);
        resolve([]);
      });

      // See the matching comment in runPythonSupplementalRules above: a
      // failed spawn surfaces as a separate 'error' event on the stdin pipe,
      // which crashes the whole process if nothing listens for it here.
      pythonProcess.stdin.on("error", (err) => {
        console.error("Python collateral risk process stdin error:", err);
        resolve([]);
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          console.error(`Python collateral risk process exited with code ${code}. Stderr: ${stderrData}`);
          return resolve([]);
        }

        try {
          const result = JSON.parse(stdoutData.trim());
          if (result.error) {
            console.error("Python collateral risk engine error:", result.error);
            return resolve([]);
          }
          resolve(result.findings || []);
        } catch (parseErr) {
          console.error("Failed to parse Python collateral risk output:", parseErr, "Raw output:", stdoutData);
          resolve([]);
        }
      });

      pythonProcess.stdin.write(payload);
      pythonProcess.stdin.end();
    } catch (err) {
      console.error("Error running Python collateral risk engine:", err);
      resolve([]);
    }
  });
}

export async function evaluateReport(
  report: NormalizedReport,
  activeRules: Rule[]
): Promise<RunResult> {
  const findings: Finding[] = [];
  const rule_errors: RuleError[] = [];
  // Sequential IDs: stable within a run and collision-free. Random IDs risked two
  // findings sharing an id, which would make a reviewer's check/review land on the
  // wrong finding. Python supplemental findings use a separate 20M+ range.
  let findingSeq = 1;

  // If the XML did not parse at all, every field is null and evaluating rules would
  // fire a flood of false "missing field" findings. Skip evaluation; the structural
  // error surfaced by the parser already tells the user the file is malformed.
  if (report.parse_failed) {
    return {
      findings: [],
      rule_errors: [{
        rule_id: "*",
        error_type: "parse_failed",
        detail: "XML did not parse; rule evaluation skipped. See structural errors."
      }]
    };
  }

  // Parse DOM document if raw xmlString is present
  let doc: any = null;
  if (report.xmlString) {
    try {
      doc = new DOMParser().parseFromString(report.xmlString, "text/xml");
    } catch (e) {
      // ignore parsing errors
    }
  }

  for (const rule of activeRules) {
    if (!rule.enabled) continue;

    const logicType = rule.logic?.type || "";
    let triggered = false;
    let values: Record<string, string | null> = {};

    try {
      if (logicType === "field_present") {
        const fieldKey = rule.logic.field;
        const val = report.fields[fieldKey]?.value;
        const isMissing = val === null || val === undefined || String(val).trim() === "";
        triggered = isMissing;
        values[fieldKey] = val || null;
      } else if (logicType === "regex_match") {
        const fieldKey = rule.logic.field;
        const val = report.fields[fieldKey]?.value;
        if (val !== null && val !== undefined && String(val).trim() !== "") {
          const pattern = rule.logic.pattern;
          const isFullmatch = pattern.startsWith("^") && pattern.endsWith("$");
          const regex = new RegExp(isFullmatch ? pattern : `^(?:${pattern})$`);
          const isOk = regex.test(String(val));
          triggered = !isOk;
          values[fieldKey] = val;
        }
      } else if (logicType === "field_in_set") {
        const fieldKey = rule.logic.field;
        const val = report.fields[fieldKey]?.value;
        if (val !== null && val !== undefined && String(val).trim() !== "") {
          const allowed = rule.logic.allowed || [];
          const isInSet = allowed.includes(String(val));
          triggered = !isInSet;
          values[fieldKey] = val;
        }
      } else if (logicType === "numeric_range") {
        const fieldKey = rule.logic.field;
        const val = report.fields[fieldKey]?.value;
        if (val !== null && val !== undefined && String(val).trim() !== "") {
          const cleanVal = String(val).replace(/,/g, "");
          const num = parseFloat(cleanVal);
          if (isNaN(num)) {
            triggered = true;
            values[fieldKey] = val;
          } else {
            const min = rule.logic.min;
            const max = rule.logic.max;
            const outOfRange = (min !== undefined && num < min) || (max !== undefined && num > max);
            triggered = outOfRange;
            values[fieldKey] = val;
          }
        }
      } else if (logicType === "ai") {
        const prompt = String(rule.logic.prompt || "").trim();
        const fields = rule.logic.fields || [];
        const context: Record<string, string | null> = {};
        for (const k of fields) {
          context[k] = report.fields[k]?.value || null;
        }

        try {
          const aiRes = await evaluateAiRule(prompt, context);
          triggered = aiRes.triggered;
          values = { ...context };
          if (triggered && aiRes.rationale) {
            values["ai_rationale"] = aiRes.rationale;
          }
        } catch (e: any) {
          rule_errors.push({
            rule_id: rule.rule_id,
            error_type: "ai_error",
            detail: `${e.name || "Error"}: ${e.message || String(e)}`
          });
          continue;
        }
      } else if (logicType === "conditional_field_present") {
        const conds = rule.logic.conditions || [];
        const op = (rule.logic.operator || "AND").toUpperCase();
        let conditionsMet = true;

        // Per-condition operator (">","<",">=","<=","!=", default "=="/equality)
        // for things like "LivingUnitCount > 0" that a plain equality/required
        // check can't express -- alongside the existing value/values/required
        // shapes.
        const isMet = (cond: any) => {
          const fullKey = findFieldKey(report, cond.field);
          if (!fullKey) return false;
          const val = report.fields[fullKey]?.value;
          const valStr = val !== null && val !== undefined ? String(val).trim() : "";

          if (cond.required) {
            return valStr !== "";
          }

          const condOp = cond.operator || "==";
          if (condOp !== "==" && condOp !== "=") {
            const numVal = parseFloat(valStr);
            const numCompare = parseFloat(String(cond.value));
            if (isNaN(numVal) || isNaN(numCompare)) return false;
            switch (condOp) {
              case ">": return numVal > numCompare;
              case "<": return numVal < numCompare;
              case ">=": return numVal >= numCompare;
              case "<=": return numVal <= numCompare;
              case "!=": return numVal !== numCompare;
            }
          }

          if (cond.value !== undefined) {
            if (Array.isArray(cond.value)) {
              return cond.value.map((v: any) => String(v).trim().toLowerCase()).includes(valStr.toLowerCase());
            }
            return valStr.toLowerCase() === String(cond.value).trim().toLowerCase();
          }
          return false;
        };

        // conditions can be a flat array (existing shape: single AND/OR across
        // all of them, via `operator`) or an array of arrays -- groups, each
        // AND'd internally and OR'd against each other -- for descriptions
        // like "(A and B) or (C and D and E)" that a single flat operator
        // can't represent. Flattening these into one bag with one operator
        // (the pre-2026-07-14 behavior) silently turned compound conditions
        // into "any single atom matches", firing on cases the source rule
        // never intended (e.g. UAD1103-1106/1113/1159 requiring
        // manufactured-home fields on a plain site-built dwelling, because
        // ImprovementType=Dwelling alone satisfied an OR across everything).
        const isGrouped = conds.length > 0 && Array.isArray(conds[0]);
        const flatConds: any[] = isGrouped ? conds.flat() : conds;

        if (conds.length > 0) {
          if (isGrouped) {
            conditionsMet = (conds as any[][]).some((group) => group.every((c) => isMet(c)));
          } else if (op === "OR") {
            conditionsMet = conds.some((c: any) => isMet(c));
          } else {
            conditionsMet = conds.every((c: any) => isMet(c));
          }
        }

        if (conditionsMet) {
          const reqField = rule.logic.required_field;
          const reqKey = findFieldKey(report, reqField);
          const reqVal = reqKey ? report.fields[reqKey]?.value : null;
          const isMissing = reqVal === null || reqVal === undefined || String(reqVal).trim() === "";
          triggered = isMissing;
          values[reqField] = reqVal || null;

          for (const c of flatConds) {
            const fKey = findFieldKey(report, c.field);
            if (fKey) values[c.field] = report.fields[fKey]?.value;
          }
        }
      } else if (logicType === "value_comparison") {
        const fieldKey = findFieldKey(report, rule.logic.field);
        if (fieldKey) {
          const val = report.fields[fieldKey]?.value;
          const valStr = val !== null && val !== undefined ? String(val).trim() : "";
          if (valStr !== "") {
            const rawCompareVal = rule.logic.compare_value;
            const compareFieldKey = typeof rawCompareVal === "string" ? findFieldKey(report, rawCompareVal) : null;
            const compareValStr = compareFieldKey ? (report.fields[compareFieldKey]?.value || "") : String(rawCompareVal);

            const num1 = parseFloat(valStr.replace(/,/g, ""));
            const num2 = parseFloat(compareValStr.replace(/,/g, ""));
            const isNumeric = !isNaN(num1) && !isNaN(num2);
            const op = rule.logic.operator || "==";

            if (isNumeric) {
              if (op === "<") triggered = num1 < num2;
              else if (op === ">") triggered = num1 > num2;
              else if (op === "<=") triggered = num1 <= num2;
              else if (op === ">=") triggered = num1 >= num2;
              else if (op === "==" || op === "=") triggered = num1 === num2;
              else if (op === "!=" || op === "<>") triggered = num1 !== num2;
            } else {
              if (op === "==" || op === "=") triggered = valStr.toLowerCase() === compareValStr.toLowerCase();
              else if (op === "!=" || op === "<>") triggered = valStr.toLowerCase() !== compareValStr.toLowerCase();
            }

            values[rule.logic.field] = val;
            if (compareFieldKey) {
              values[rawCompareVal] = compareValStr;
            } else {
              values["compare_value"] = String(rawCompareVal);
            }
          }
        }
      } else if (logicType === "uniqueness_check") {
        if (doc) {
          const field = rule.logic.field || "";
          const scope = rule.logic.scope || "";
          
          let elements: any[] = [];
          let pathInsideElement = "";
          
          if (scope === "all_comparable_properties") {
            const allProps = getElementsByTagName(doc, "PROPERTY");
            elements = allProps.filter(p => p.getAttribute("ValuationUseType") !== "SubjectProperty");
            pathInsideElement = field;
          } else if (scope) {
            elements = getElementsByTagName(doc, scope);
            pathInsideElement = field;
          }
          
          if (elements.length > 0) {
            const valuesSeen = new Set<string>();
            const duplicates = new Set<string>();
            for (const elem of elements) {
              const val = getNodeValue(elem, pathInsideElement) || elem.getAttribute(pathInsideElement);
              if (val) {
                const valClean = val.trim().toLowerCase();
                if (valuesSeen.has(valClean)) {
                  duplicates.add(val);
                }
                valuesSeen.add(valClean);
              }
            }
            triggered = duplicates.size > 0;
            if (triggered) {
              values["duplicates"] = Array.from(duplicates).join(", ");
            }
          }
        }
      } else if (logicType === "instance_count") {
        if (doc) {
          const targetElement = rule.logic.target_element;
          const conds = rule.logic.conditions || [];
          
          const allElems = getElementsByTagName(doc, targetElement);
          let matchCount = 0;
          
          for (const elem of allElems) {
            let isMatch = true;
            for (const cond of conds) {
              const val = getNodeValue(elem, cond.field) || elem.getAttribute(cond.field);
              const valStr = val !== null && val !== undefined ? String(val).trim().toLowerCase() : "";
              if (cond.value !== undefined) {
                if (valStr !== String(cond.value).trim().toLowerCase()) {
                  isMatch = false;
                  break;
                }
              }
            }
            if (isMatch) matchCount++;
          }
          
          const compareField = rule.logic.field;
          const reqKey = findFieldKey(report, compareField);
          const reqVal = reqKey ? report.fields[reqKey]?.value : null;
          
          if (reqVal !== null && reqVal !== undefined && String(reqVal).trim() !== "") {
            const expectedCount = parseInt(String(reqVal).replace(/,/g, ""), 10);
            if (!isNaN(expectedCount)) {
              triggered = expectedCount !== matchCount;
              values[compareField] = String(reqVal);
              values["actual_instance_count"] = String(matchCount);
            }
          }
        }
      } else if (logicType === "complex_condition") {
        const conds = rule.logic.conditions || [];
        const op = (rule.logic.operator || "AND").toUpperCase();
        const evalResults: boolean[] = [];

        for (const cond of conds) {
          const fKey = findFieldKey(report, cond.field);
          if (fKey) {
            const val = report.fields[fKey]?.value;
            const valStr = val !== null && val !== undefined ? String(val).trim() : "";
            const compareVal = String(cond.compare_value).trim();
            const condOp = cond.operator || "==";

            const num1 = parseFloat(valStr.replace(/,/g, ""));
            const num2 = parseFloat(compareVal.replace(/,/g, ""));
            const isNumeric = !isNaN(num1) && !isNaN(num2);
            
            let condTriggered = false;
            if (isNumeric) {
              if (condOp === "<") condTriggered = num1 < num2;
              else if (condOp === ">") condTriggered = num1 > num2;
              else if (condOp === "<=") condTriggered = num1 <= num2;
              else if (condOp === ">=") condTriggered = num1 >= num2;
              else if (condOp === "==" || condOp === "=") condTriggered = num1 === num2;
              else if (condOp === "!=" || condOp === "<>") condTriggered = num1 !== num2;
            } else {
              if (condOp === "==" || condOp === "=") condTriggered = valStr.toLowerCase() === compareVal.toLowerCase();
              else if (condOp === "!=" || condOp === "<>") condTriggered = valStr.toLowerCase() !== compareVal.toLowerCase();
            }
            evalResults.push(condTriggered);
            values[cond.field] = val;
          } else {
            evalResults.push(false);
          }
        }

        if (evalResults.length > 0) {
          if (op === "OR") {
            triggered = evalResults.some(r => r);
          } else {
            triggered = evalResults.every(r => r);
          }
        }
      } else if (logicType === "needs_encoding") {
        continue;
      } else {
        rule_errors.push({
          rule_id: rule.rule_id,
          error_type: "unsupported_logic",
          detail: `Unknown logic type: '${logicType}'`
        });
        continue;
      }
    } catch (e: any) {
      rule_errors.push({
        rule_id: rule.rule_id,
        error_type: "execution_error",
        detail: `${e.name || "Error"}: ${e.message || String(e)}`
      });
      continue;
    }

    if (triggered) {
      const fieldPath = String(
        rule.logic.field || 
        rule.logic.required_field || 
        (rule.logic.fields && rule.logic.fields[0]) || 
        ""
      );
      const resolvedFieldKey = findFieldKey(report, fieldPath) || fieldPath;
      const normalizedField = report.fields[resolvedFieldKey];
      const appraiserMsg = rule.messages?.appraiser || rule.messages?.reviewer || rule.description || "";
      const reviewerMsg = rule.messages?.reviewer || rule.messages?.appraiser || rule.description || "";

      findings.push({
        id: findingSeq++,
        rule_id: rule.rule_id,
        category: rule.category || "",
        severity: rule.severity || "Warning",
        message_appraiser: appraiserMsg,
        message_reviewer: reviewerMsg,
        field_path: resolvedFieldKey,
        xpath: normalizedField ? normalizedField.xpath : null,
        section: normalizedField ? normalizedField.section : null,
        values,
        citation: rule.citation || null,
        appraiser_checked: false,
        reviewer_status: "pending",
        reviewer_note: null,
        reviewed_at: null
      });
    }
  }

  try {
    const supplementalFindings = await runPythonSupplementalRules(report);
    findings.push(...supplementalFindings);
  } catch (err) {
    console.error("Error adding supplemental findings:", err);
  }

  try {
    const collateralRiskFindings = await runPythonCollateralRisk(report);
    findings.push(...collateralRiskFindings);
  } catch (err) {
    console.error("Error adding collateral risk findings:", err);
  }

  return { findings, rule_errors };
}
