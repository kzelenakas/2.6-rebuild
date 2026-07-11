import fs from "fs";
import path from "path";
import crypto from "crypto";

export const DATA_DIR = process.env.QC_DATA_DIR || path.join(process.cwd(), "data");

// Helper to ensure data dir exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export interface Rule {
  rule_id: string;
  category: string;
  description: string;
  severity: "HardStop" | "Warning" | "Advisory";
  enabled: boolean;
  logic: { type: string; [key: string]: any };
  citation: string | null;
  messages: { appraiser?: string | null; reviewer?: string | null };
  h1?: any;
  updated_at?: string;
  [key: string]: any;
}

export interface Profile {
  id: number;
  name: string;
  description: string;
  disabled_rule_ids: string[];
  archived: boolean;
  updated_at: string;
}

export interface Run {
  id: string;
  filename: string;
  file_hash: string;
  created_at: string;
  schema_version: string;
  ruleset_version: string;
  sign_off_state: string;
  reviewer_name: string | null;
  signed_off_at: string | null;
  counts: Record<string, number>;
  structural_errors: any[];
  findings: any[];
  rule_errors: any[];
  audit_log?: any[];
  // User Specificity and Bubble
  appraiser_email?: string | null;
  appraiser_bubble_id?: string | null;
  bubble_order_id?: string | null;
  reviewer_email?: string | null;
  reviewer_requests?: { id: string; text: string; checked: boolean }[];
  has_revision?: boolean;
  revised_filename?: string;
  revised_file_hash?: string;
  revised_created_at?: string;
  revised_counts?: Record<string, number>;
  revised_structural_errors?: any[];
  revised_findings?: any[];
  revised_rule_errors?: any[];
}

export interface UserPermission {
  email: string;
  bubble_user_id?: string;
  name: string;
  role: "appraiser" | "reviewer" | "admin";
  permissions: string[];
}

let rules: Rule[] = [];
let profiles: Profile[] = [];
let runs: Run[] = [];
let userPermissions: UserPermission[] = [];
let changeCounter = 1;

function canonicalHash(definitions: any[]): string {
  const sorted = [...definitions]
    .map(d => ({
      rule_id: d.rule_id,
      category: d.category,
      description: d.description,
      severity: d.severity,
      enabled: d.enabled,
      logic: d.logic,
      citation: d.citation,
      messages: d.messages,
      h1: d.h1
    }))
    .sort((a, b) => (a.rule_id || "").localeCompare(b.rule_id || ""));
  const payload = JSON.stringify(sorted);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function getRulesetVersion(): string {
  const activeDefinitions = rules.map(r => ({ ...r, enabled: r.enabled }));
  const digest = canonicalHash(activeDefinitions);
  return `db-v${changeCounter}-${digest.slice(0, 12)}`;
}

export function initDatabase() {
  ensureDataDir();

  // Load Rules
  const rulesPath = path.join(DATA_DIR, "rules.json");
  if (fs.existsSync(rulesPath)) {
    try {
      rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse rules.json, re-seeding", e);
      seedRules();
    }
  } else {
    seedRules();
  }

  // Load Profiles
  const profilesPath = path.join(DATA_DIR, "profiles.json");
  if (fs.existsSync(profilesPath)) {
    try {
      profiles = JSON.parse(fs.readFileSync(profilesPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse profiles.json", e);
      profiles = [];
    }
  } else {
    profiles = [];
  }

  // Load Runs
  const runsPath = path.join(DATA_DIR, "runs.json");
  if (fs.existsSync(runsPath)) {
    try {
      runs = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse runs.json", e);
      runs = [];
    }
  } else {
    runs = [];
  }

  // Load User Permissions
  const usersPath = path.join(DATA_DIR, "users.json");
  if (fs.existsSync(usersPath)) {
    try {
      userPermissions = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse users.json", e);
      userPermissions = [];
    }
  } else {
    // seed default permissions
    userPermissions = [
      {
        email: "admin@example.com",
        name: "Default Admin",
        role: "admin",
        permissions: ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report", "manage_rules", "manage_profiles", "manage_permissions"]
      },
      {
        email: "reviewer@example.com",
        name: "Default Reviewer",
        role: "reviewer",
        permissions: ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report"]
      },
      {
        email: "appraiser@example.com",
        name: "Default Appraiser",
        role: "appraiser",
        permissions: ["run_qc", "check_findings", "resolve_requests"]
      }
    ];
    saveUsersToDisk();
  }
}

export function saveUsersToDisk() {
  ensureDataDir();
  const usersPath = path.join(DATA_DIR, "users.json");
  fs.writeFileSync(usersPath, JSON.stringify(userPermissions, null, 2), "utf-8");
}

export function getUserPermissions(): UserPermission[] {
  return userPermissions;
}

export function saveUserPermission(user: UserPermission): UserPermission {
  const existingIdx = userPermissions.findIndex(u => u.email.toLowerCase() === user.email.toLowerCase());
  if (existingIdx !== -1) {
    userPermissions[existingIdx] = user;
  } else {
    userPermissions.push(user);
  }
  saveUsersToDisk();
  return user;
}

export function deleteUserPermission(email: string): boolean {
  const initialLen = userPermissions.length;
  userPermissions = userPermissions.filter(u => u.email.toLowerCase() !== email.toLowerCase());
  if (userPermissions.length < initialLen) {
    saveUsersToDisk();
    return true;
  }
  return false;
}

function seedRules() {
  let sourcePath = path.join(process.cwd(), "rules", "h1_rules.json");
  if (!fs.existsSync(sourcePath)) {
    sourcePath = path.join(process.cwd(), "rules", "seed_rules.json");
  }

  if (fs.existsSync(sourcePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
      rules = (data.rules || []).map((r: any) => ({
        ...r,
        enabled: r.enabled !== undefined ? r.enabled : true,
        updated_at: new Date().toISOString()
      }));
      // Perform backfill
      backfillH1Metadata(data.rules || []);
      saveRulesToDisk();
    } catch (e) {
      console.error("Error seeding rules:", e);
      rules = [];
    }
  } else {
    console.warn("No seed rules file found!");
    rules = [];
  }
}

function backfillH1Metadata(sourceRules: any[]) {
  const byId = new Map(sourceRules.map(r => [r.rule_id, r]));
  let backfilledCount = 0;
  for (const rule of rules) {
    if ((rule.logic || {}).type !== "needs_encoding") continue;
    const source = byId.get(rule.rule_id);
    if (!source) continue;
    const newH1 = source.h1 || {};
    const oldH1 = rule.h1 || {};
    const merged = { ...newH1, ...oldH1 };
    if (JSON.stringify(merged) !== JSON.stringify(oldH1)) {
      rule.h1 = merged;
      rule.updated_at = new Date().toISOString();
      backfilledCount++;
    }
  }
  if (backfilledCount > 0) {
    console.log(`Backfilled H1 metadata for ${backfilledCount} rules.`);
  }
}

export function saveRulesToDisk() {
  ensureDataDir();
  const rulesPath = path.join(DATA_DIR, "rules.json");
  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2), "utf-8");
  changeCounter++;
}

export function saveProfilesToDisk() {
  ensureDataDir();
  const profilesPath = path.join(DATA_DIR, "profiles.json");
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), "utf-8");
}

export function saveRunsToDisk() {
  ensureDataDir();
  const runsPath = path.join(DATA_DIR, "runs.json");
  fs.writeFileSync(runsPath, JSON.stringify(runs, null, 2), "utf-8");
}

// RULES CRUD
export function getRules(status: string = "all"): Rule[] {
  return rules.filter(r => {
    if (r.archived) return false;
    const logicType = (r.logic || {}).type;
    if (status === "enabled" && !r.enabled) return false;
    if (status === "needs_encoding" && logicType !== "needs_encoding") return false;
    return true;
  });
}

export function getRule(ruleId: string): Rule | null {
  const r = rules.find(r => r.rule_id === ruleId);
  if (!r || r.archived) return null;
  return r;
}

export function upsertRule(ruleData: any): Rule {
  let existing = rules.find(r => r.rule_id === ruleData.rule_id);
  if (existing) {
    Object.assign(existing, ruleData);
    existing.updated_at = new Date().toISOString();
    existing.archived = false;
  } else {
    existing = {
      ...ruleData,
      enabled: ruleData.enabled !== undefined ? ruleData.enabled : true,
      archived: false,
      updated_at: new Date().toISOString()
    };
    rules.push(existing);
  }
  saveRulesToDisk();
  return existing;
}

export function toggleRule(ruleId: string, enabled: boolean): Rule | null {
  const r = rules.find(r => r.rule_id === ruleId);
  if (!r || r.archived) return null;
  r.enabled = enabled;
  r.updated_at = new Date().toISOString();
  saveRulesToDisk();
  return r;
}

export function archiveRule(ruleId: string): boolean {
  const r = rules.find(r => r.rule_id === ruleId);
  if (!r) return false;
  r.archived = true;
  r.enabled = false;
  r.updated_at = new Date().toISOString();
  saveRulesToDisk();
  return true;
}

export function importRuleset(data: any, replace: boolean): number {
  if (replace) {
    rules.forEach(r => {
      r.archived = true;
      r.enabled = false;
    });
  }

  let count = 0;
  const importedRules = data.rules || [];
  for (const definition of importedRules) {
    let row = rules.find(r => r.rule_id === definition.rule_id);
    if (!row) {
      row = { ...definition };
      rules.push(row);
    } else {
      Object.assign(row, definition);
    }
    row.enabled = definition.enabled !== undefined ? definition.enabled : true;
    row.archived = false;
    row.updated_at = new Date().toISOString();
    count++;
  }
  saveRulesToDisk();
  return count;
}

// PROFILES CRUD
export function getProfiles(): Profile[] {
  return profiles.filter(p => !p.archived);
}

export function getProfile(name: string): Profile | null {
  return profiles.find(p => p.name === name && !p.archived) || null;
}

export function upsertProfile(name: string, description: string, disabledRuleIds: string[]): Profile {
  let existing = profiles.find(p => p.name === name);
  if (existing) {
    existing.description = description;
    existing.disabled_rule_ids = disabledRuleIds;
    existing.archived = false;
    existing.updated_at = new Date().toISOString();
  } else {
    existing = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      name,
      description,
      disabled_rule_ids: disabledRuleIds,
      archived: false,
      updated_at: new Date().toISOString()
    };
    profiles.push(existing);
  }
  saveProfilesToDisk();
  return existing;
}

// RUNS CRUD
export function getRuns(): Run[] {
  return runs;
}

export function getRun(id: string): Run | null {
  return runs.find(r => r.id === id) || null;
}

export function saveRun(run: Run) {
  const existingIdx = runs.findIndex(r => r.id === run.id);
  if (existingIdx !== -1) {
    runs[existingIdx] = run;
  } else {
    runs.push(run);
  }
  saveRunsToDisk();
}
