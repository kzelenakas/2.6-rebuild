import { getUserHeaders } from "./api";

// Send the acting user's real identity (email + role from localStorage). A bare
// "X-QC-Role: admin" header no longer grants admin server-side after the auth fix —
// the request must resolve to a real admin in users.json (or carry the proxy secret),
// so the admin panel only works for a genuine admin.
const ADMIN: Record<string, string> = { ...getUserHeaders(), "X-QC-Role": "admin" };

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // Server error responses use { error: "..." }; fall back to detail/statusText.
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body.error === "string" ? body.error
      : typeof body.detail === "string" ? body.detail
      : "Request failed";
    throw new Error(msg);
  }
  return res.json();
}

export interface AdminRule {
  rule_id: string;
  category: string;
  description: string;
  severity: "HardStop" | "Warning" | "Advisory";
  enabled: boolean;
  logic: Record<string, unknown> & { type?: string };
  citation?: string | null;
  messages?: { appraiser?: string | null; reviewer?: string | null };
  [key: string]: unknown;
}

export interface Profile {
  id: number;
  name: string;
  description: string;
  disabled_rule_ids: string[];
}

export interface FieldManifestEntry {
  key: string;
  scope: string;
  xpath_dir: string;
  element: string;
  label: string;
  section: string;
}

export interface EncodingSuggestion {
  logic_type: string;
  logic: Record<string, unknown> & { type?: string };
  confidence: number;
  rationale: string;
  candidate_fields: FieldManifestEntry[];
  blocked: boolean;
}

export async function listAdminRules(status: string): Promise<AdminRule[]> {
  return handle(await fetch(`/api/admin/rules?status=${status}`, { headers: ADMIN }));
}

export async function saveRule(rule: AdminRule): Promise<AdminRule> {
  return handle(await fetch(`/api/admin/rules/${encodeURIComponent(rule.rule_id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify(rule),
  }));
}

export async function toggleRule(ruleId: string, enabled: boolean): Promise<AdminRule> {
  return handle(await fetch(`/api/admin/rules/${encodeURIComponent(ruleId)}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify({ enabled }),
  }));
}

export async function archiveRule(ruleId: string): Promise<void> {
  await handle(await fetch(`/api/admin/rules/${encodeURIComponent(ruleId)}/archive`, {
    method: "POST", headers: ADMIN,
  }));
}

export async function suggestEncoding(ruleId: string): Promise<EncodingSuggestion> {
  return handle(await fetch(`/api/admin/rules/${encodeURIComponent(ruleId)}/suggest`, {
    method: "POST", headers: ADMIN,
  }));
}

export interface InteractiveEncodingResponse {
  suggested_logic: Record<string, any>;
  human_explanation: string;
  questions: {
    id: string;
    text: string;
    type: "yes_no" | "multiple_choice" | "text";
    options?: string[];
  }[];
  ready_to_save: boolean;
}

export async function interactiveSuggestEncoding(
  ruleId: string,
  answers: { questionId: string; answer: string; questionText: string }[],
  customFeedback?: string
): Promise<InteractiveEncodingResponse> {
  return handle(await fetch(`/api/admin/rules/${encodeURIComponent(ruleId)}/interactive-suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify({ answers, customFeedback }),
  }));
}

export async function listFields(): Promise<FieldManifestEntry[]> {
  return handle(await fetch("/api/admin/fields", { headers: ADMIN }));
}

export async function listProfiles(): Promise<Profile[]> {
  return handle(await fetch("/api/admin/profiles", { headers: ADMIN }));
}

export async function saveProfile(name: string, description: string, disabledRuleIds: string[]): Promise<Profile> {
  return handle(await fetch("/api/admin/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify({ name, description, disabled_rule_ids: disabledRuleIds }),
  }));
}

export async function exportRuleset(): Promise<unknown> {
  return handle(await fetch("/api/admin/export", { headers: ADMIN }));
}

export async function importRuleset(ruleset: unknown, replace: boolean): Promise<{ imported: number }> {
  return handle(await fetch("/api/admin/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify({ ruleset, replace }),
  }));
}

export interface BatchEncodeResult {
  total_needs_encoding: number;
  processed: number;
  updated: number;
  heuristic_count: number;
  ai_count: number;
  failed_count: number;
}

export async function batchEncodeRules(mode: "heuristic_only" | "heuristic_and_ai", limit = 50): Promise<BatchEncodeResult> {
  return handle(await fetch("/api/admin/rules/batch-encode", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify({ mode, limit }),
  }));
}

export interface RuleSuggestion {
  rule_id: string;
  category: string;
  description: string;
  severity: "HardStop" | "Warning" | "Advisory";
  messages: { appraiser: string; reviewer: string };
  logic: Record<string, any>;
}

export async function suggestFromRevisions(revisionsText: string): Promise<{ suggestions: RuleSuggestion[] }> {
  return handle(await fetch("/api/admin/rules/suggest-from-revisions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify({ revisionsText }),
  }));
}

export interface VerificationReport {
  approved: boolean;
  score: number;
  remarks: string;
  proposed_logic: Record<string, unknown> & { type?: string };
}

export async function verifyRule(
  description: string,
  logic: Record<string, unknown> & { type?: string },
  category: string,
  severity: string
): Promise<VerificationReport> {
  return handle(await fetch("/api/admin/rules/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify({ description, logic, category, severity }),
  }));
}

