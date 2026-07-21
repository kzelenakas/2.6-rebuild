import fs from "fs";
import path from "path";
import crypto from "crypto";

export const DATA_DIR = process.env.QC_DATA_DIR || path.join(process.cwd(), "data");
export const DATA_DIR_UAD26 = process.env.QC_DATA_DIR_UAD26 || path.join(process.cwd(), "data_uad26");

function ensureDataDir(dataDir: string = DATA_DIR) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function writeJsonAtomic(filePath: string, data: any) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

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

function getSeedSourcePath(): string | null {
  let p = path.join(process.cwd(), "rules", "h1_rules.json");
  if (!fs.existsSync(p)) p = path.join(process.cwd(), "rules", "seed_rules.json");
  return fs.existsSync(p) ? p : null;
}

function getSeedSourceHash(): string | null {
  const p = getSeedSourcePath();
  if (!p) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function getSeedSourcePathUad26(): string | null {
  const p = path.join(process.cwd(), "rules", "uad26_compliance_rules.json");
  return fs.existsSync(p) ? p : null;
}

function getSeedSourceHashUad26(): string | null {
  const p = getSeedSourcePathUad26();
  if (!p) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
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
  appraiser_email?: string | null;
  appraiser_bubble_id?: string | null;
  bubble_order_id?: string | null;
  reviewer_email?: string | null;
  reviewer_requests?: { id: string; text: string; checked: boolean }[];
  has_revision?: boolean;
  revised_filename?: string;
  revised_file_hash?: string;
  revised_created_at?: string;
  revised_schema_version?: string;
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

export function initDatabase() {
  ensureDataDir();

  const rulesPath = path.join(DATA_DIR, "rules.json");
  const seedVersionPath = path.join(DATA_DIR, "rules_seed_version.txt");
  const currentSeedHash = getSeedSourceHash();

  if (fs.existsSync(rulesPath) && fs.existsSync(seedVersionPath)) {
    const storedSeedHash = fs.readFileSync(seedVersionPath, "utf-8").trim();
    if (currentSeedHash && storedSeedHash !== currentSeedHash) {
      console.log("Rule seed source changed since last boot -- reseeding rules.json.");
      seedRules();
    } else {
      try {
        rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
      } catch (e) {
        console.error("Failed to parse rules.json, re-seeding", e);
        seedRules();
      }
    }
  } else {
    seedRules();
  }
  if (currentSeedHash) {
    fs.writeFileSync(seedVersionPath, currentSeedHash, "utf-8");
  }

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

  const usersPath = path.join(DATA_DIR, "users.json");
  if (fs.existsSync(usersPath)) {
    try {
      userPermissions = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse users.json", e);
      userPermissions = [];
    }
  } else {
    userPermissions = [
      {
        email: "kevin.zelenakas@truefootage.tech",
        name: "Kevin Zelenakas",
        role: "admin",
        permissions: ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report", "manage_rules", "manage_profiles", "manage_permissions"]
      },
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

export function initDatabaseUad26() {
  ensureDataDir(DATA_DIR_UAD26);

  const rulesPath = path.join(DATA_DIR_UAD26, "rules.json");
  const seedVersionPath = path.join(DATA_DIR_UAD26, "rules_seed_version.txt");
  const currentSeedHash = getSeedSourceHashUad26();

  if (fs.existsSync(rulesPath) && fs.existsSync(seedVersionPath)) {
    const storedSeedHash = fs.readFileSync(seedVersionPath, "utf-8").trim();
    if (currentSeedHash && storedSeedHash !== currentSeedHash) {
      console.log("UAD 2.6 rule seed source changed since last boot -- reseeding rules.json.");
      seedRulesUad26();
    } else {
      try {
        rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
      } catch (e) {
        console.error("Failed to parse UAD 2.6 rules.json, re-seeding", e);
        seedRulesUad26();
      }
    }
  } else {
    seedRulesUad26();
  }
  if (currentSeedHash) {
    fs.writeFileSync(seedVersionPath, currentSeedHash, "utf-8");
  }

  const profilesPath = path.join(DATA_DIR_UAD26, "profiles.json");
  if (fs.existsSync(profilesPath)) {
    try {
      profiles = JSON.parse(fs.readFileSync(profilesPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse UAD 2.6 profiles.json", e);
      profiles = [];
    }
  } else {
    profiles = [];
  }

  const runsPath = path.join(DATA_DIR_UAD26, "runs.json");
  if (fs.existsSync(runsPath)) {
    try {
      runs = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse UAD 2.6 runs.json", e);
      runs = [];
    }
  } else {
    runs = [];
  }

  const usersPath = path.join(DATA_DIR_UAD26, "users.json");
  if (fs.existsSync(usersPath)) {
    try {
      userPermissions = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse UAD 2.6 users.json", e);
      userPermissions = [];
    }
  } else {
    userPermissions = [
      {
        email: "kevin.zelenakas@truefootage.tech",
        name: "Kevin Zelenakas",
        role: "admin",
        permissions: ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report", "manage_rules", "manage_profiles", "manage_permissions"]
      },
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
    saveUsersToDiskUad26();
  }
}

function seedRules() {
  const sourcePath = getSeedSourcePath();
  if (sourcePath) {
    try {
      const data = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
      rules = (data.rules || []).map((r: any) => ({
        ...r,
        enabled: r.enabled !== undefined ? r.enabled : true,
        updated_at: new Date().toISOString()
      }));
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

function seedRulesUad26() {
  const sourcePath = getSeedSourcePathUad26();
  if (sourcePath) {
    try {
      const data = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
      rules = (data.rules || []).map((r: any) => ({
        ...r,
        enabled: r.enabled !== undefined ? r.enabled : true,
        updated_at: new Date().toISOString()
      }));
      saveRulesToDiskUad26();
    } catch (e) {
      console.error("Error seeding UAD 2.6 rules:", e);
      rules = [];
    }
  } else {
    console.warn("No UAD 2.6 seed rules file found!");
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

export function saveUsersToDisk() {
  ensureDataDir();
  const usersPath = path.join(DATA_DIR, "users.json");
  writeJsonAtomic(usersPath, userPermissions);
}

export function saveUsersToDiskUad26() {
  ensureDataDir(DATA_DIR_UAD26);
  const usersPath = path.join(DATA_DIR_UAD26, "users.json");
  writeJsonAtomic(usersPath, userPermissions);
}

export function saveRulesToDisk() {
  ensureDataDir();
  const rulesPath = path.join(DATA_DIR, "rules.json");
  writeJsonAtomic(rulesPath, rules);

  try {
    const archivesDir = path.join(DATA_DIR, "archives");
    if (!fs.existsSync(archivesDir)) {
      fs.mkdirSync(archivesDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
    const archivePath = path.join(archivesDir, `rules_archive_${timestamp}_v${changeCounter}.json`);
    fs.copyFileSync(rulesPath, archivePath);
    console.log(`[Archive] Rules database archived to ${archivePath}`);
  } catch (err) {
    console.error("Failed to archive rules database:", err);
  }

  changeCounter++;
}

export function saveRulesToDiskUad26() {
  ensureDataDir(DATA_DIR_UAD26);
  const rulesPath = path.join(DATA_DIR_UAD26, "rules.json");
  writeJsonAtomic(rulesPath, rules);

  changeCounter++;
}

export function saveProfilesToDisk() {
  ensureDataDir();
  const profilesPath = path.join(DATA_DIR, "profiles.json");
  writeJsonAtomic(profilesPath, profiles);
}

export function saveProfilesToDiskUad26() {
  ensureDataDir(DATA_DIR_UAD26);
  const profilesPath = path.join(DATA_DIR_UAD26, "profiles.json");
  writeJsonAtomic(profilesPath, profiles);
}

export function saveRunsToDisk() {
  ensureDataDir();
  const runsPath = path.join(DATA_DIR, "runs.json");
  writeJsonAtomic(runsPath, runs);
}

export function saveRunsToDiskUad26() {
  ensureDataDir(DATA_DIR_UAD26);
  const runsPath = path.join(DATA_DIR_UAD26, "runs.json");
  writeJsonAtomic(runsPath, runs);
}

export function getRulesetVersion(): string {
  const activeDefinitions = rules.map(r => ({ ...r, enabled: r.enabled }));
  const digest = canonicalHash(activeDefinitions);
  return `db-v${changeCounter}-${digest.slice(0, 12)}`;
}

export function getRulesetVersionUad26(): string {
  const activeDefinitions = rules.map(r => ({ ...r, enabled: r.enabled }));
  const digest = canonicalHash(activeDefinitions);
  return `db-v${changeCounter}-${digest.slice(0, 12)}`;
}

export function getDataDir(schemaVersion?: string): string {
  if (schemaVersion && schemaVersion.startsWith("UAD_2.6")) {
    return DATA_DIR_UAD26;
  }
  return DATA_DIR;
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
      updated_at: new Date().toISOString(),
      archived: false
    };
    rules.push(existing);
  }
  saveRulesToDisk();
  return existing;
}

export function toggleRule(ruleId: string, enabled: boolean): Rule | null {
  const rule = rules.find(r => r.rule_id === ruleId);
  if (!rule) return null;
  rule.enabled = enabled;
  rule.updated_at = new Date().toISOString();
  saveRulesToDisk();
  return rule;
}

export function archiveRule(ruleId: string): boolean {
  const rule = rules.find(r => r.rule_id === ruleId);
  if (!rule) return false;
  rule.archived = true;
  rule.updated_at = new Date().toISOString();
  saveRulesToDisk();
  return true;
}

export function importRuleset(ruleset: any) {
  const importedRules = ruleset.rules || [];
  for (const ir of importedRules) {
    const idx = rules.findIndex(r => r.rule_id === ir.rule_id);
    if (idx !== -1) {
      rules[idx] = { ...rules[idx], ...ir, updated_at: new Date().toISOString() };
    } else {
      rules.push({ ...ir, updated_at: new Date().toISOString() });
    }
  }
  saveRulesToDisk();
}

export function getProfiles(): Profile[] {
  return profiles;
}

export function getProfile(name: string): Profile | undefined {
  return profiles.find(p => p.name === name);
}

export function upsertProfile(profile: Profile): Profile {
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx !== -1) {
    profiles[idx] = { ...profile, updated_at: new Date().toISOString() };
  } else {
    const newProfile = { ...profile, id: Date.now(), updated_at: new Date().toISOString() };
    profiles.push(newProfile);
    return newProfile;
  }
  saveProfilesToDisk();
  return profiles[idx];
}

export function getRuns(): Run[] {
  return runs;
}

export function getRun(id: string): Run | null {
  return runs.find(r => r.id === id) || null;
}

export function getRunBySchema(id: string, schemaVersion?: string): Run | null {
  const dataDir = getDataDir(schemaVersion);
  const runsPath = path.join(dataDir, "runs.json");

  if (fs.existsSync(runsPath)) {
    try {
      const localRuns: Run[] = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
      return localRuns.find(r => r.id === id) || null;
    } catch (e) {
      console.error("Failed to parse runs.json for getRunBySchema", e);
    }
  }
  return null;
}

export function saveRun(run: Run, schemaVersion?: string) {
  const dataDir = getDataDir(schemaVersion);
  const runsPath = path.join(dataDir, "runs.json");

  let localRuns: Run[] = [];
  if (fs.existsSync(runsPath)) {
    try {
      localRuns = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
    } catch (e) {
      console.error("Failed to parse runs.json", e);
      localRuns = [];
    }
  }

  const existingIdx = localRuns.findIndex(r => r.id === run.id);
  if (existingIdx !== -1) {
    localRuns[existingIdx] = run;
  } else {
    localRuns.push(run);
  }

  writeJsonAtomic(runsPath, localRuns);

  if (!schemaVersion || !schemaVersion.startsWith("UAD_2.6")) {
    const existingIdxMain = runs.findIndex(r => r.id === run.id);
    if (existingIdxMain !== -1) {
      runs[existingIdxMain] = run;
    } else {
      runs.push(run);
    }
  }
}