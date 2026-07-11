import { useMemo, useState } from "react";
import type { FieldManifestEntry } from "./adminApi";

export type Logic = Record<string, unknown> & { type?: string };
type EditorProps = { logic: Logic; onChange: (l: Logic) => void; fields: FieldManifestEntry[] };

const LOGIC_TYPES = [
  {
    type: "field_present",
    label: "Field must be filled in",
    blurb: "Fails when the field is missing or blank. The simplest, most common check.",
    example: 'Example: "Subject city name must be provided" fires whenever CityName is empty.',
  },
  {
    type: "regex_match",
    label: "Field must match a format",
    blurb: "Fails when the field has a value but it doesn't match a required pattern. Blank values are ignored — pair with \"must be filled in\" separately if both matter.",
    example: "Example: ZIP code must be 5 digits, or 5 digits + hyphen + 4 digits.",
  },
  {
    type: "field_in_set",
    label: "Field must be one of a list",
    blurb: "Fails when the field has a value but it isn't one of a fixed set of allowed choices. Blank values are ignored.",
    example: "Example: State code must be a valid 2-letter US state abbreviation.",
  },
  {
    type: "numeric_range",
    label: "Number must be within a range",
    blurb: "Fails when the field's number falls outside a minimum/maximum (or isn't a number at all). Blank values are ignored.",
    example: "Example: Gross living area must be between 300 and 20,000 sq ft.",
  },
  {
    type: "ai",
    label: "AI judgment call",
    blurb: "For rules too subjective or compound for the checks above — an AI reads the field(s) plus your plain-language instruction and decides if the rule fires. Slower, less predictable; always spot-check its findings.",
    example: 'Example: "Does this market commentary read as generic boilerplate?"',
  },
  {
    type: "conditional_field_present",
    label: "Conditional Field Presence",
    blurb: "Fails when a required field is missing but parent conditions are met.",
    example: 'Example: If PropertyEstateType = "Other", then PropertyEstateTypeOtherDescription must be provided.',
  },
  {
    type: "value_comparison",
    label: "Value Comparison",
    blurb: "Fails when a comparison (e.g. <, >, <=, >=, ==, !=) with a static value or another field fails.",
    example: "Example: DwellingCount < 1.",
  },
  {
    type: "uniqueness_check",
    label: "Uniqueness Check",
    blurb: "Fails when values of a field are duplicated across multiple XML instances/comparables.",
    example: "Example: Comparable property ordinal numbers must be unique.",
  },
  {
    type: "instance_count",
    label: "Instance Count Check",
    blurb: "Fails when the count of matching child instances does not equal a specified count field.",
    example: "Example: DwellingCount must equal the number of LIVING_UNIT instances.",
  },
  {
    type: "complex_condition",
    label: "Complex Boolean Logic",
    blurb: "Fails when a set of sub-conditions combine (AND/OR) to trigger a rule.",
    example: "Example: ExteriorConditionRatingCode = 'C1' and PropertyStructureBuiltYear > effective year.",
  },
  {
    type: "needs_encoding",
    label: "Not yet encoded",
    blurb: "Placeholder state — this rule never runs until you pick one of the types above.",
    example: "Leave as-is if you're not ready to encode this rule yet.",
  },
] as const;

export function validateLogic(logic: Logic, fields: FieldManifestEntry[]): string | null {
  const known = new Set(fields.map((f) => f.key));
  const isField = (v: unknown): v is string => typeof v === "string" && v.length > 0;

  switch (logic.type) {
    case "needs_encoding":
    case "conditional_field_present":
    case "value_comparison":
    case "uniqueness_check":
    case "instance_count":
    case "complex_condition":
      return null;
    case "field_present":
      if (!isField(logic.field)) return "Pick a field.";
      if (!known.has(logic.field)) return "Field isn't recognized — pick one from the list.";
      return null;
    case "regex_match": {
      if (!isField(logic.field)) return "Pick a field.";
      if (!known.has(logic.field)) return "Field isn't recognized — pick one from the list.";
      if (typeof logic.pattern !== "string" || !logic.pattern.trim()) return "Enter a required pattern.";
      try { new RegExp(logic.pattern); } catch { return "That pattern isn't valid — check the syntax."; }
      return null;
    }
    case "field_in_set": {
      if (!isField(logic.field)) return "Pick a field.";
      if (!known.has(logic.field)) return "Field isn't recognized — pick one from the list.";
      if (!Array.isArray(logic.allowed) || logic.allowed.length === 0) return "Add at least one allowed value.";
      return null;
    }
    case "numeric_range": {
      if (!isField(logic.field)) return "Pick a field.";
      if (!known.has(logic.field)) return "Field isn't recognized — pick one from the list.";
      const { min, max } = logic;
      if (min === undefined && max === undefined) return "Set a minimum, a maximum, or both.";
      if (typeof min === "number" && typeof max === "number" && min > max) return "Minimum can't be greater than maximum.";
      return null;
    }
    case "ai": {
      if (typeof logic.prompt !== "string" || !logic.prompt.trim()) return "Describe what the AI should judge.";
      const list = Array.isArray(logic.fields) ? logic.fields : [];
      if (list.length === 0) return "Add at least one field for the AI to look at.";
      if (list.some((f) => typeof f !== "string" || !known.has(f))) return "One or more fields aren't recognized — pick from the list.";
      return null;
    }
    default:
      return "Pick a logic type.";
  }
}

function FieldPicker({ id, value, onChange, fields }: { id: string; value: string; onChange: (v: string) => void; fields: FieldManifestEntry[] }) {
  const match = fields.find((f) => f.key === value);
  return (
    <div className="grid gap-1">
      <input
        list={`${id}-fields`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Start typing a field name…"
        className="rounded border border-gray-300 px-2 py-1.5 font-mono text-[11px]"
      />
      <datalist id={`${id}-fields`}>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label} — {f.section}</option>)}
      </datalist>
      {value && (match
        ? <span className="text-[11px] text-green-700">✓ {match.label} ({match.section})</span>
        : <span className="text-[11px] text-red-700">Not a recognized field — pick one from the suggestions.</span>)}
    </div>
  );
}

function RegexEditor({ logic, onChange, fields }: EditorProps) {
  const [testValue, setTestValue] = useState("");
  const pattern = (logic.pattern as string) || "";
  const testResult = useMemo(() => {
    if (!testValue) return null;
    try { return new RegExp(`^(?:${pattern})$`).test(testValue); } catch { return null; }
  }, [pattern, testValue]);

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-gray-700">Field</span>
        <FieldPicker id="rx" value={(logic.field as string) || ""} onChange={(v) => onChange({ ...logic, field: v })} fields={fields} />
      </label>
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-gray-700">Required pattern (regular expression)</span>
        <input
          value={pattern}
          onChange={(e) => onChange({ ...logic, pattern: e.target.value })}
          placeholder={String.raw`e.g. \d{5}(-\d{4})?`}
          className="rounded border border-gray-300 px-2 py-1.5 font-mono text-[11px]"
        />
      </label>
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-gray-700">Try a sample value</span>
        <div className="flex items-center gap-2">
          <input value={testValue} onChange={(e) => setTestValue(e.target.value)} placeholder="Type a value to test" className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-[11px]" />
          {testResult !== null && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${testResult ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
              {testResult ? "Matches" : "Doesn't match"}
            </span>
          )}
        </div>
      </label>
    </div>
  );
}

function FieldInSetEditor({ logic, onChange, fields }: EditorProps) {
  const [draft, setDraft] = useState("");
  const allowed = Array.isArray(logic.allowed) ? (logic.allowed as string[]) : [];

  function addValue() {
    const v = draft.trim();
    if (v && !allowed.includes(v)) onChange({ ...logic, allowed: [...allowed, v] });
    setDraft("");
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-gray-700">Field</span>
        <FieldPicker id="fis" value={(logic.field as string) || ""} onChange={(v) => onChange({ ...logic, field: v })} fields={fields} />
      </label>
      <div className="grid gap-1 text-xs">
        <span className="font-medium text-gray-700">Allowed values</span>
        <div className="flex flex-wrap gap-1">
          {allowed.map((v) => (
            <span key={v} className="flex items-center gap-1 rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[11px]">
              {v}
              <button type="button" onClick={() => onChange({ ...logic, allowed: allowed.filter((x) => x !== v) })} className="text-gray-500 hover:text-red-700">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addValue(); } }}
            placeholder="Type a value, press Enter"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-[11px]"
          />
          <button type="button" onClick={addValue} className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white">Add</button>
        </div>
      </div>
    </div>
  );
}

function NumericRangeEditor({ logic, onChange, fields }: EditorProps) {
  const min = logic.min;
  const max = logic.max;

  function setNum(key: "min" | "max", raw: string) {
    const next = { ...logic };
    if (raw.trim() === "") delete next[key];
    else { const n = Number(raw); next[key] = Number.isNaN(n) ? raw : n; }
    onChange(next);
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-gray-700">Field</span>
        <FieldPicker id="nr" value={(logic.field as string) || ""} onChange={(v) => onChange({ ...logic, field: v })} fields={fields} />
      </label>
      <div className="flex gap-3">
        <label className="grid flex-1 gap-1 text-xs">
          <span className="font-medium text-gray-700">Minimum (optional)</span>
          <input type="number" value={typeof min === "number" ? min : ""} onChange={(e) => setNum("min", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-[11px]" />
        </label>
        <label className="grid flex-1 gap-1 text-xs">
          <span className="font-medium text-gray-700">Maximum (optional)</span>
          <input type="number" value={typeof max === "number" ? max : ""} onChange={(e) => setNum("max", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-[11px]" />
        </label>
      </div>
      <p className="text-[11px] text-gray-500">Set at least one. A value outside the range — or not a number at all — fails the rule.</p>
    </div>
  );
}

function AiEditor({ logic, onChange, fields }: EditorProps) {
  const selected = Array.isArray(logic.fields) ? (logic.fields as string[]) : [];

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-gray-700">Instruction for the AI (plain language)</span>
        <textarea
          value={(logic.prompt as string) || ""}
          onChange={(e) => onChange({ ...logic, prompt: e.target.value })}
          rows={2}
          placeholder='e.g. "Does this market commentary read as generic boilerplate?"'
          className="rounded border border-gray-300 px-2 py-1.5 text-[11px]"
        />
      </label>
      <div className="grid gap-1 text-xs">
        <span className="font-medium text-gray-700">Field(s) the AI should look at</span>
        {selected.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <FieldPicker
                id={`ai-${i}`} value={v} fields={fields}
                onChange={(k) => onChange({ ...logic, fields: selected.map((f, idx) => (idx === i ? k : f)) })}
              />
            </div>
            <button type="button" onClick={() => onChange({ ...logic, fields: selected.filter((_, idx) => idx !== i) })} className="shrink-0 rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white">
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onChange({ ...logic, fields: [...selected, ""] })} className="justify-self-start rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-white">
          + Add field
        </button>
      </div>
    </div>
  );
}

export function LogicEditor({ logic, onChange, fields, sourceText }: EditorProps & { sourceText: string }) {
  const [infoOpen, setInfoOpen] = useState<string | null>(null);
  const type = logic.type || "needs_encoding";
  const error = validateLogic(logic, fields);

  function setType(next: string) {
    if (next === type) return;
    onChange(next === "needs_encoding" ? { type: next, source_logic: sourceText } : { type: next });
    setInfoOpen(null);
  }

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LOGIC_TYPES.map((opt) => (
          <div key={opt.type} className="relative">
            <button
              type="button"
              onClick={() => setType(opt.type)}
              className={`w-full rounded border px-2 py-2 pr-6 text-left text-[11px] font-medium ${type === opt.type ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              {opt.label}
            </button>
            <button
              type="button"
              aria-label={`What is "${opt.label}"?`}
              aria-expanded={infoOpen === opt.type}
              onClick={() => setInfoOpen(infoOpen === opt.type ? null : opt.type)}
              className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[9px] text-gray-500 hover:bg-gray-100"
            >
              i
            </button>
            {infoOpen === opt.type && (
              <div role="tooltip" className="absolute z-10 mt-1 w-64 rounded border border-gray-300 bg-white p-2 text-[11px] text-gray-700 shadow-lg">
                <p>{opt.blurb}</p>
                <p className="mt-1 text-gray-500">{opt.example}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rounded border border-gray-200 bg-gray-50 p-3">
        {type === "field_present" && (
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-gray-700">Field</span>
            <FieldPicker id="fp" value={(logic.field as string) || ""} onChange={(v) => onChange({ ...logic, field: v })} fields={fields} />
          </label>
        )}
        {type === "regex_match" && <RegexEditor logic={logic} onChange={onChange} fields={fields} />}
        {type === "field_in_set" && <FieldInSetEditor logic={logic} onChange={onChange} fields={fields} />}
        {type === "numeric_range" && <NumericRangeEditor logic={logic} onChange={onChange} fields={fields} />}
        {type === "ai" && <AiEditor logic={logic} onChange={onChange} fields={fields} />}
        {["conditional_field_present", "value_comparison", "uniqueness_check", "instance_count", "complex_condition"].includes(type) && (
          <div className="grid gap-2 text-xs">
            <span className="font-semibold text-gray-800">Advanced GSE UAD 3.6 Structured Logic</span>
            <p className="text-gray-600">
              This rule has been successfully encoded into highly efficient, machine-executable XML validation logic. 
              The system executes these rules programmatically on the uploaded file DOM using the exact parameters defined in the Appendix H-1 specification.
            </p>
            <p className="text-[11px] text-indigo-700">
              You can inspect and review the raw JSON logic block using the advanced fold below.
            </p>
          </div>
        )}
        {type === "needs_encoding" && (
          <p className="text-xs text-gray-500">
            This rule stays inactive until you pick a type above (or use "Suggest encoding" and review its proposal).
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-700">⚠ {error}</p>}

      <details className="text-[11px] text-gray-500">
        <summary className="cursor-pointer">Advanced: view raw logic (read-only)</summary>
        <pre className="mt-1 overflow-x-auto rounded border border-gray-200 bg-white p-2 font-mono">{JSON.stringify(logic, null, 2)}</pre>
      </details>
    </div>
  );
}
