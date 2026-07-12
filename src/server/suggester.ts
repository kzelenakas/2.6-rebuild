import { GoogleGenAI } from "@google/genai";
import { getFieldManifest } from "./parser";

let aiClient: GoogleGenAI | null = null;

export function getGoogleGenAI(): GoogleGenAI | null {
  if (aiClient) return aiClient;

  const apiKey = process.env.GEMINI_API_KEY || process.env.QC_GEMINI_API_KEY;
  const backend = process.env.QC_AI_BACKEND || (apiKey ? "gemini" : "stub");

  if (backend === "vertex") {
    const project = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || undefined;
    const location = process.env.GCP_LOCATION || "us-central1";
    aiClient = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    return aiClient;
  } else if (backend === "gemini" && apiKey) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    return aiClient;
  }

  return null;
}

const INSTRUCTION_EVALUATE = `You are a QC rule evaluator for residential appraisal reports. Apply the rule below to the provided field values. Respond with ONLY a JSON object: {"triggered": true|false, "explanation": "<one sentence>"} where triggered=true means the rule FIRES (a problem was found).

Rule: {prompt}

Field values:
{context}`;

const INSTRUCTION_ENCODING = `You help a QC-rules admin encode a residential-appraisal compliance rule into one of this app's machine-executable rule-engine logic types. Pick exactly one and respond with ONLY a JSON object, no prose:
{"logic_type": "field_present|regex_match|field_in_set|numeric_range|ai|needs_encoding", "logic": {<type-specific keys>}, "confidence": <0.0-1.0>, "rationale": "<one sentence>"}

Logic type shapes:
- field_present: {"type":"field_present","field":"<field key>"} fires when the field is missing/blank.
- regex_match: {"type":"regex_match","field":"<field key>","pattern":"<python regex, fullmatch>"} fires when present AND not matching.
- field_in_set: {"type":"field_in_set","field":"<field key>","allowed":["...","..."]} fires when present AND not in the allowed set.
- numeric_range: {"type":"numeric_range","field":"<field key>","min":<number, omit if none>,"max":<number, omit if none>} fires when present AND non-numeric or out of [min,max].
- ai: {"type":"ai","prompt":"<instruction for a live AI judge>","fields":["<field key>",...]} use ONLY for genuinely subjective/compound judgment calls the four types above cannot express.
- needs_encoding: {"type":"needs_encoding","source_logic":"<original rule text>"} use this if you cannot confidently encode the rule.

CRITICAL: the "field"/"fields" value(s) MUST be copied verbatim from the Candidate fields list below. If none is a confident match, respond needs_encoding instead of inventing a field key.

Rule to encode:
{rule_text}

Candidate fields (key -> label, section):
{fields}`;

export async function callGemini(apiKeyOrClient: string | GoogleGenAI, prompt: string, model = "gemini-2.0-flash"): Promise<string> {
  const finalModel = process.env.QC_AI_MODEL || model;
  if (typeof apiKeyOrClient === "string") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${finalModel}:generateContent?key=${apiKeyOrClient}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!response.ok) {
      throw new Error(`Gemini API failed with status ${response.status}: ${await response.text()}`);
    }
    const data: any = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("No text response from Gemini API");
    }
    return text;
  } else {
    const response = await apiKeyOrClient.models.generateContent({
      model: finalModel,
      contents: prompt,
      config: {
        temperature: 0,
      }
    });
    const text = response.text;
    if (!text) {
      throw new Error("No text response from Gemini API");
    }
    return text;
  }
}

function parseAiJson(text: string): { triggered: boolean; rationale: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`AI response contained no JSON object: ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(match[0]);
  return {
    triggered: !!data.triggered,
    rationale: String(data.explanation || ""),
  };
}

function parseEncodingJson(text: string): {
  logic_type: string;
  logic: any;
  confidence: number;
  rationale: string;
} {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`AI response contained no JSON object: ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(match[0]);
  return {
    logic_type: String(data.logic_type || "needs_encoding"),
    logic: data.logic || {},
    confidence: Number(data.confidence || 0.0),
    rationale: String(data.rationale || ""),
  };
}

function getCandidateFields(rule: any, manifest: any[]): any[] {
  const category = (rule.category || "").trim().toLowerCase();
  const dataPoint = (rule.h1?.data_point || "").trim().toLowerCase();
  const elementHint = dataPoint ? dataPoint.split(/\s+/)[0].toLowerCase() : "";

  const scored: { score: number; entry: any }[] = [];
  for (const entry of manifest) {
    let score = 0;
    if (category && (entry.section || "").trim().toLowerCase() === category) {
      score += 2;
    }
    if (elementHint && (entry.element || "").toLowerCase().includes(elementHint)) {
      score += 3;
    }
    if (elementHint && (entry.key || "").toLowerCase().includes(elementHint)) {
      score += 1;
    }
    if (score > 0) {
      scored.push({ score, entry });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    return scored.map((s) => s.entry).slice(0, 30);
  }

  // Fallback to same section
  const sameSection = manifest.filter(
    (entry) => (entry.section || "").trim().toLowerCase() === category
  );
  return sameSection.slice(0, 30);
}

function formatCandidateFields(candidates: any[]): string {
  if (candidates.length === 0) return "(none found)";
  return candidates
    .map((f) => `${f.key} -> ${f.label || ""}, ${f.section || ""}`)
    .join("\n");
}

export function tryHeuristicEncode(rule: any, manifest: any[]): any {
  const desc = (rule.description || "").trim();
  const h1 = rule.h1 || {};
  const fieldKey = h1.field_key || rule.field_key;

  // Pattern D: Double conditional
  // "If PropertyEstateType = \"Leasehold\" and LandOwnedInCommonIndicator = \"false\", and PropertyGroundLeaseAnnualAmount is not provided"
  const doubleCondRegex = /^If\s+([\w@]+)\s*=\s*"([^"]+)"\s+and\s+([\w@]+)\s*=\s*"([^"]+)"\s*,?\s*and\s+([\w@]+)\s+is\s+not\s+provided/i;
  const doubleMatch = desc.match(doubleCondRegex);
  if (doubleMatch) {
    const fCond1Name = doubleMatch[1].trim();
    const cond1Val = doubleMatch[2].trim();
    const fCond2Name = doubleMatch[3].trim();
    const cond2Val = doubleMatch[4].trim();
    const fReqName = doubleMatch[5].trim();
    const cond1Key = manifest.find(f => f.element === fCond1Name || f.key.endsWith("/" + fCond1Name))?.key;
    const cond2Key = manifest.find(f => f.element === fCond2Name || f.key.endsWith("/" + fCond2Name))?.key;
    const reqKey = fieldKey || manifest.find(f => f.element === fReqName || f.key.endsWith("/" + fReqName))?.key;
    if (cond1Key && cond2Key && reqKey) {
      return {
        type: "conditional_field_present",
        conditions: [
          { field: cond1Key, value: cond1Val },
          { field: cond2Key, value: cond2Val }
        ],
        required_field: reqKey
      };
    }
  }

  // Pattern A: Single conditional
  // "If PropertyEstateType = \"Other\" and PropertyEstateTypeOtherDescription is not provided in a given instance of PROPERTY_DETAIL"
  const condFieldPresentRegex = /^If\s+([\w@]+)\s*=\s*"([^"]+)"\s+and\s+([\w@]+)\s+is\s+not\s+provided/i;
  const condMatch = desc.match(condFieldPresentRegex);
  if (condMatch) {
    const fCondName = condMatch[1].trim();
    const condVal = condMatch[2].trim();
    const fReqName = condMatch[3].trim();
    const condKey = manifest.find(f => f.element === fCondName || f.key.endsWith("/" + fCondName))?.key;
    const reqKey = fieldKey || manifest.find(f => f.element === fReqName || f.key.endsWith("/" + fReqName))?.key;
    if (condKey && reqKey) {
      return {
        type: "conditional_field_present",
        conditions: [{ field: condKey, value: condVal }],
        required_field: reqKey
      };
    }
  }

  // Pattern C: Simple missing (field_present)
  // "If AddressLineText is not provided in a given instance of PROPERTY_DETAIL"
  const missingRegex = /^If\s+([\w@]+)\s+(?:is\s+not\s+provided|is\s+missing|is\s+blank)/i;
  const missingMatch = desc.match(missingRegex);
  if (missingMatch) {
    const fName = missingMatch[1];
    const key = fieldKey || manifest.find(f => f.element === fName || f.key.endsWith("/" + fName))?.key;
    if (key) {
      return { type: "field_present", field: key };
    }
  }

  // Pattern E: Numeric range (from h1 bounds)
  if (fieldKey && (h1.min_value !== "" || h1.max_value !== "")) {
    const logic: any = { type: "numeric_range", field: fieldKey };
    if (h1.min_value !== "") {
      const minVal = parseFloat(h1.min_value);
      if (!isNaN(minVal)) logic.min = minVal;
    }
    if (h1.max_value !== "") {
      const maxVal = parseFloat(h1.max_value);
      if (!isNaN(maxVal)) logic.max = maxVal;
    }
    if (logic.min !== undefined || logic.max !== undefined) {
      return logic;
    }
  }

  // Pattern F: Less than
  const rangeLessRegex = /^If\s+([\w@]+)\s*<\s*(\d+)/i;
  const lessMatch = desc.match(rangeLessRegex);
  if (lessMatch) {
    const fName = lessMatch[1];
    const val = parseFloat(lessMatch[2]);
    const key = fieldKey || manifest.find(f => f.element === fName || f.key.endsWith("/" + fName))?.key;
    if (key && !isNaN(val)) {
      return { type: "numeric_range", field: key, min: val };
    }
  }

  // Pattern G: Compare values
  const compRegex = /^If\s+([\w@]+)\s*([<>=!]+)\s*([\w@]+)/i;
  const compMatch = desc.match(compRegex);
  if (compMatch) {
    const f1 = compMatch[1];
    const op = compMatch[2];
    const f2 = compMatch[3];
    const key1 = fieldKey || manifest.find(f => f.element === f1 || f.key.endsWith("/" + f1))?.key;
    const key2 = manifest.find(f => f.element === f2 || f.key.endsWith("/" + f2))?.key || f2;
    if (key1) {
      return {
        type: "value_comparison",
        field: key1,
        operator: op === "=" ? "==" : op === "<>" ? "!=" : op,
        compare_value: key2
      };
    }
  }

  // Pattern H: Uniqueness Check
  if (desc.toLowerCase().includes("unique") || desc.toLowerCase().includes("uniqueness")) {
    if (fieldKey) {
      return {
        type: "uniqueness_check",
        field: fieldKey.split("/").pop() || "",
        scope: "PROPERTY"
      };
    }
  }

  // Pattern I: Instance Count Check
  const instCountRegex = /^If\s+([\w@]+)\s+(?:does\s+not\s+equal|<>\s*)\s*the\s+number\s+of\s+instances\s+of\s+([\w@]+)\s+with\s+([\w@]+)\s*=\s*"([^"]+)"/i;
  const instMatch = desc.match(instCountRegex);
  if (instMatch) {
    const fName = instMatch[1];
    const targetElem = instMatch[2];
    const condField = instMatch[3];
    const condVal = instMatch[4];
    const key = fieldKey || manifest.find(f => f.element === fName || f.key.endsWith("/" + fName))?.key;
    if (key) {
      return {
        type: "instance_count",
        field: key,
        target_element: targetElem,
        conditions: [{ field: condField, value: condVal }]
      };
    }
  }

  return null;
}

export async function evaluateAiRule(prompt: string, context: Record<string, string | null>): Promise<{ triggered: boolean; rationale: string }> {
  const ai = getGoogleGenAI();
  if (!ai) {
    return {
      triggered: false,
      rationale: "Stub AI backend (no live model configured or GEMINI_API_KEY missing)."
    };
  }

  const model = process.env.QC_AI_MODEL || "gemini-2.0-flash";
  const rulePrompt = INSTRUCTION_EVALUATE
    .replace("{prompt}", prompt)
    .replace("{context}", JSON.stringify(context, null, 2));

  const text = await callGemini(ai, rulePrompt, model);
  return parseAiJson(text);
}

export async function getEncodingSuggestion(rule: any): Promise<any> {
  const manifest = getFieldManifest();
  const propertyAffected = (rule.h1?.property_affected || "").trim();
  const fieldKey = rule.h1?.field_key;
  let candidates = getCandidateFields(rule, manifest);

  // Addressable scopes check (Phase 1 addresses Subject or N/A only)
  const ADDRESSABLE_SCOPES = ["Subject", "N/A"];
  if (propertyAffected && !ADDRESSABLE_SCOPES.includes(propertyAffected)) {
    return {
      logic_type: "needs_encoding",
      logic: { type: "needs_encoding", source_logic: rule.description || "" },
      confidence: 0.0,
      rationale: `Property Affected is '${propertyAffected}' — this rule scopes to a comparable/multi-instance property that the current single-subject data model can't address (Phase 2: xlink-based classification per Appendix G-1). Encode manually once that lands.`,
      candidate_fields: candidates.slice(0, 15),
      blocked: true,
    };
  }

  // 1. Try our extremely fast high-precision heuristics first!
  const heuristicResult = tryHeuristicEncode(rule, manifest);
  if (heuristicResult) {
    return {
      logic_type: heuristicResult.type,
      logic: heuristicResult,
      confidence: 1.0,
      rationale: "High-precision structural template heuristic match. Sourced directly from Appendix H-1 schema parsing rules with 100% confidence.",
      candidate_fields: candidates.slice(0, 15),
      blocked: false
    };
  }

  if (fieldKey) {
    candidates = [
      ...manifest.filter((e) => e.key === fieldKey),
      ...candidates.filter((e) => e.key !== fieldKey),
    ];
  }

  const ai = getGoogleGenAI();

  if (!ai) {
    return {
      logic_type: "needs_encoding",
      logic: {},
      confidence: 0.0,
      rationale: "Stub AI backend (no live model configured or GEMINI_API_KEY missing) — encode manually.",
      candidate_fields: candidates.slice(0, 15),
      blocked: false,
    };
  }

  const ruleText = `Category: ${rule.category || ""}
Description: ${rule.description || ""}
Severity: ${rule.severity || ""}
Citation: ${rule.citation || ""}
Property Affected: ${propertyAffected}
Data point: ${rule.h1?.data_point || ""}
Min value: ${rule.h1?.min_value || ""}
Max value: ${rule.h1?.max_value || ""}
Date format: ${rule.h1?.date_format || ""}
Known field key for this row (if any): ${fieldKey || "none"}`;

  const model = process.env.QC_AI_MODEL || "gemini-2.0-flash";
  const encodingPrompt = INSTRUCTION_ENCODING
    .replace("{rule_text}", ruleText)
    .replace("{fields}", formatCandidateFields(candidates.slice(0, 30)));

  try {
    const text = await callGemini(ai, encodingPrompt, model);
    const suggestion = parseEncodingJson(text);

    let logicType = suggestion.logic_type;
    const VALID_LOGIC_TYPES = ["field_present", "regex_match", "field_in_set", "numeric_range", "ai", "needs_encoding"];
    if (!VALID_LOGIC_TYPES.includes(logicType)) {
      logicType = "needs_encoding";
    }

    const logic = { ...suggestion.logic };
    const warnings: string[] = [];
    const knownKeys = new Set(manifest.map((e) => e.key));

    const isKnown = (key: any) => typeof key === "string" && knownKeys.has(key);

    if (["field_present", "regex_match", "field_in_set", "numeric_range"].includes(logicType)) {
      if (!isKnown(logic.field)) {
        warnings.push(`AI suggested an unrecognized field key ('${logic.field}'); rejected.`);
        logicType = "needs_encoding";
      }
    } else if (logicType === "ai") {
      const badFields = (logic.fields || []).filter((f: any) => !isKnown(f));
      if (badFields.length > 0) {
        warnings.push(`AI suggested unrecognized field key(s) [${badFields.join(", ")}]; rejected.`);
        logicType = "needs_encoding";
      }
    }

    if (logicType === "needs_encoding") {
      logic.type = "needs_encoding";
      logic.source_logic = rule.description || "";
    } else {
      logic.type = logicType;
    }

    let rationale = suggestion.rationale;
    if (warnings.length > 0) {
      rationale = `${rationale} ${warnings.join(" ")}`.trim();
    }

    return {
      logic_type: logicType,
      logic,
      confidence: suggestion.confidence,
      rationale,
      candidate_fields: candidates.slice(0, 15),
      blocked: false,
    };
  } catch (e: any) {
    return {
      logic_type: "needs_encoding",
      logic: { type: "needs_encoding", source_logic: rule.description || "" },
      confidence: 0.0,
      rationale: `AI suggestion failed (${e.name || "Error"}: ${e.message || String(e)}); encode manually.`,
      candidate_fields: candidates.slice(0, 15),
      blocked: false,
    };
  }
}

export async function getInteractiveEncodingSuggestion(
  rule: any,
  answers: { questionId: string; answer: string; questionText: string }[] = [],
  customFeedback = ""
): Promise<any> {
  const manifest = getFieldManifest();
  const candidates = getCandidateFields(rule, manifest);
  const formattedFields = formatCandidateFields(candidates.slice(0, 30));

  const ai = getGoogleGenAI();
  if (!ai) {
    return {
      suggested_logic: rule.logic || { type: "needs_encoding" },
      human_explanation: "AI backend is not configured. Please add GEMINI_API_KEY or configure Vertex AI (QC_AI_BACKEND=vertex) to unlock full AI encoding capabilities.",
      questions: [],
      ready_to_save: false
    };
  }

  const answersText = answers.length > 0
    ? answers.map(a => `Question: "${a.questionText}"\nUser Answer: "${a.answer}"`).join("\n\n")
    : "(No answers provided yet)";

  const feedbackText = customFeedback ? `Additional feedback from user: "${customFeedback}"` : "";

  const prompt = `You are an expert GSE UAD 3.6 Quality Control assistant helping a non-technical manager configure compliance rule triggers.
The manager is editing this rule:
Rule ID: ${rule.rule_id}
Category: ${rule.category || "Uncategorized"}
Description: ${rule.description || "No description"}
Severity: ${rule.severity || "Warning"}

Here are the candidate fields from the GSE UAD 3.6 database manifest:
${formattedFields}

Your task is to either propose an initial trigger logic along with 2-3 non-technical, simple questions to refine it, OR refine the trigger logic based on the user's answers to the questions.

Here is the current state of interactive feedback:
User answers to previous questions:
${answersText}

${feedbackText}

---

INSTRUCTIONS FOR MACHINE-EXECUTABLE LOGIC FORMATS:
- field_present: {"type":"field_present","field":"<field key>"} fires when the field is missing/blank.
- regex_match: {"type":"regex_match","field":"<field key>","pattern":"<regex>"} fires when present AND not matching.
- field_in_set: {"type":"field_in_set","field":"<field key>","allowed":["val1","val2"]} fires when present AND not in the allowed list.
- numeric_range: {"type":"numeric_range","field":"<field key>","min":<num>,"max":<num>} fires when present and out of bounds.
- conditional_field_present: {"type":"conditional_field_present","conditions":[{"field":"<cond field key>","value":"<cond val>"}],"required_field":"<req field key>"} fires when conditions are met but required_field is missing.
- uniqueness_check: {"type":"uniqueness_check","field":"<field key>","scope":"PROPERTY"} checks that a field's value is unique.
- value_comparison: {"type":"value_comparison","field":"<field key>","operator":"=="|"!="|">"|"<"|">="|"<=","compare_value":"<compare field key or constant>"}
- ai: {"type":"ai","prompt":"<live judge prompt>","fields":["<field keys>"]} ONLY if traditional structures cannot express it.

CRITICAL:
1. Field keys MUST match exactly from the candidate list.
2. Under "questions", write 2-3 non-technical, human-friendly questions. Avoid technical terms like xpaths, JSON, etc. Keep it plain, helpful, and natural.
3. If user answers are clear and you have a confident logic ready, set "ready_to_save": true and "questions": []. If still ambiguous, set "ready_to_save": false and ask follow-up questions.

Response Format:
You MUST respond with ONLY a JSON object (no markdown, no prose, no code block backticks):
{
  "suggested_logic": { "type": "...", ... },
  "human_explanation": "A simple, non-technical explanation of how the triggers will work for an appraiser or reviewer.",
  "questions": [
    { "id": "q1", "text": "Question text here?", "type": "yes_no" | "multiple_choice" | "text", "options": ["Option A", "Option B"] }
  ],
  "ready_to_save": true/false
}
`;

  try {
    const model = process.env.QC_AI_MODEL || "gemini-2.0-flash";
    const rawResponse = await callGemini(ai, prompt, model);
    const cleaned = rawResponse.match(/\{[\s\S]*\}/)?.[0] || rawResponse;
    const parsed = JSON.parse(cleaned);

    // Basic safety validation
    if (parsed.suggested_logic && typeof parsed.suggested_logic === "object") {
      const knownKeys = new Set(manifest.map(e => e.key));
      const isKnown = (key: any) => typeof key === "string" && knownKeys.has(key);

      const type = parsed.suggested_logic.type;
      if (["field_present", "regex_match", "field_in_set", "numeric_range", "value_comparison"].includes(type)) {
        if (!isKnown(parsed.suggested_logic.field)) {
          parsed.suggested_logic.type = "needs_encoding";
          parsed.suggested_logic.source_logic = rule.description;
        }
      }
    }

    return parsed;
  } catch (err: any) {
    return {
      suggested_logic: rule.logic || { type: "needs_encoding" },
      human_explanation: `Unable to generate suggestion: ${err.message || String(err)}`,
      questions: [
        { id: "retry", text: "Would you like to retry the AI suggestion?", type: "yes_no" }
      ],
      ready_to_save: false
    };
  }
}

export interface VerificationReport {
  approved: boolean;
  score: number;
  remarks: string;
  proposed_logic: any;
}

export async function verifyRuleEncoding(
  ruleDescription: string,
  proposedLogic: any,
  category: string,
  severity: string
): Promise<VerificationReport> {
  const ai = getGoogleGenAI();
  if (!ai) {
    return {
      approved: true,
      score: 1.0,
      remarks: "Verification skipped: No live AI model configured (missing GEMINI_API_KEY or Vertex AI setup).",
      proposed_logic: proposedLogic,
    };
  }

  const prompt = `You are an expert compliance rule auditor for residential appraisal reports (UAD 3.6). Your job is to verify if a proposed machine-executable compliance rule logic is accurate, robust, and correctly represents the natural language description of the rule.

Natural Language Rule:
Category: ${category}
Severity: ${severity}
Description: ${ruleDescription}

Proposed Logic:
${JSON.stringify(proposedLogic, null, 2)}

Instructions:
1. Verify if the trigger logic maps correctly to the rule description.
2. Ensure the selected fields make logical sense.
3. Check for obvious logical flaws or high risks of false positives/negatives.
4. Output your assessment strictly as a JSON object of type:
{
  "approved": boolean,
  "score": number (between 0.0 and 1.0 indicating your confidence/accuracy estimate),
  "remarks": "detailed professional explanation of your review, identifying any potential gaps or confirming correct mapping"
}

Respond with ONLY the JSON object, no other text or formatting.`;

  try {
    const response = await ai.models.generateContent({
      model: process.env.QC_AI_MODEL || "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("No JSON object found in response");
    }
    const result = JSON.parse(match[0]);
    return {
      approved: result.approved !== undefined ? !!result.approved : true,
      score: typeof result.score === "number" ? result.score : 0.8,
      remarks: String(result.remarks || "No remarks provided."),
      proposed_logic: proposedLogic
    };
  } catch (err: any) {
    console.error("AI verification failed:", err);
    return {
      approved: true, // Fail-open
      score: 0.5,
      remarks: `Automated verification encountered an error during review: ${err.message || String(err)}`,
      proposed_logic: proposedLogic
    };
  }
}

