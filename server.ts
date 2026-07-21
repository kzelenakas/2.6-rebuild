import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import AdmZip from "adm-zip";
import { createServer as createViteServer } from "vite";

import {
  initDatabase,
  initDatabaseUad26,
  getRules,
  getRule,
  upsertRule,
  toggleRule,
  archiveRule,
  importRuleset,
  getProfiles,
  getProfile,
  upsertProfile,
  getRuns,
  getRunBySchema,
  saveRun,
  getRulesetVersion,
  saveRulesToDisk,
  DATA_DIR,
  getDataDir,
  getUserPermissions,
  saveUserPermission,
  deleteUserPermission,
  UserPermission
} from "./src/server/db";

import { initParser, parseAndNormalizeXML, getFieldManifest } from "./src/server/parser";
import { initParser26, parseAndNormalizeXML26, getFieldManifest26 } from "./src/server/parser26";
import { evaluateReport } from "./src/server/engine";
import { getEncodingSuggestion, tryHeuristicEncode, callGemini, getInteractiveEncodingSuggestion, verifyRuleEncoding, getGoogleGenAI } from "./src/server/suggester";
import { renderCSV, renderPDF } from "./src/server/exports";
import { uploadsConfigured, createSignedUploadUrl, downloadUploadedObject, deleteUploadedObject } from "./src/server/uploads";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// ponytail: 500MB in-memory cap, not streamed to disk -- fine for this tool's
// low concurrency. Only reached via the direct-multipart fallback (local dev,
// or GCS not configured); Cloud Run's own ~32MB request ceiling makes this
// moot in production, where large files should go through the signed-URL
// upload flow (/api/uploads/init) instead.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// Resolves an uploaded file from either the direct multipart path (req.file)
// or the signed-URL-to-GCS path (req.body.objectPath naming an object this
// server already handed out a write URL for). Returns null if neither is
// present so the caller can 422.
async function resolveUploadedFile(req: express.Request): Promise<{ buffer: Buffer; filename: string; objectPath: string | null } | null> {
  if (req.file) {
    return { buffer: req.file.buffer, filename: req.file.originalname || "upload.xml", objectPath: null };
  }
  const objectPath = req.body && typeof req.body.objectPath === "string" ? req.body.objectPath : null;
  if (!objectPath) return null;
  const filename = (req.body && typeof req.body.filename === "string" && req.body.filename) || "upload.zip";
  const buffer = await downloadUploadedObject(objectPath);
  return { buffer, filename, objectPath };
}

// Delivery photos live under Images/ in the UAD zip alongside the XML and PDF.
// Only needed by the collateral-risk photo rules (CR-105/106/107, disabled pending
// Kevin's sign-off) -- see engine.ts's runPythonCollateralRisk for the enabled-check
// gate before these bytes are actually sent anywhere.
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif"];

function extractZipImages(zip: AdmZip): Record<string, Buffer> {
  const images: Record<string, Buffer> = {};
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    const lower = name.toLowerCase();
    if (lower.startsWith("images/") && IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))) {
      images[name] = entry.getData();
    }
  }
  return images;
}

function getIapEmail(req: express.Request): string {
  const raw = req.headers["x-goog-authenticated-user-email"];
  const header = (Array.isArray(raw) ? raw[0] : raw || "").trim();
  const prefix = "accounts.google.com:";
  return (header.startsWith(prefix) ? header.slice(prefix.length) : header).toLowerCase();
}

function getActiveUser(req: express.Request) {
  // The only two identities this function will ever look up by: (1) IAP's own
  // authenticated-user header, which Cloud Run's ingress guarantees came from a
  // real Google login (no --allow-unauthenticated), or (2) an explicit
  // x-qc-user-email/bubble-id/role assertion from a request that proves it came
  // from a trusted proxy (Bubble) via the QC_PROXY_SECRET shared secret.
  // Everything else -- an unverified header, a query param -- gets the lowest
  // privilege, whatever email string it claims to be, because knowing/guessing a
  // real user's email is trivial and would otherwise grant their real role.
  const proxySecret = process.env.QC_PROXY_SECRET || "";
  const secretHeader = req.headers["x-qc-proxy-secret"];
  const providedSecret = (Array.isArray(secretHeader) ? secretHeader[0] : secretHeader || "").trim();
  const headersTrusted = proxySecret.length > 0 && providedSecret === proxySecret;

  let email: string;
  let bubbleUserId = "";
  let requestedRole = "";

  if (headersTrusted) {
    const emailHeader = req.headers["x-qc-user-email"];
    email = (Array.isArray(emailHeader) ? emailHeader[0] : emailHeader || "").trim().toLowerCase();
    const bubbleIdHeader = req.headers["x-qc-user-bubble-id"];
    bubbleUserId = (Array.isArray(bubbleIdHeader) ? bubbleIdHeader[0] : bubbleIdHeader || "").trim();
    const roleHeader = req.headers["x-qc-role"];
    requestedRole = (Array.isArray(roleHeader) ? roleHeader[0] : roleHeader || "").trim().toLowerCase();
  } else {
    email = getIapEmail(req);
  }

  const users = getUserPermissions();
  let user = users.find(u => {
    if (email && u.email.toLowerCase() === email) return true;
    if (bubbleUserId && u.bubble_user_id === bubbleUserId) return true;
    return false;
  });

  if (user) {
    return {
      email: user.email,
      name: user.name,
      role: user.role,
      bubble_user_id: user.bubble_user_id || "",
      permissions: user.permissions
    };
  }

  const finalRole = (requestedRole === "reviewer" || requestedRole === "admin" || requestedRole === "appraiser")
    ? requestedRole
    : "appraiser";

  const fallbackEmail = email || "guest@example.com";
  const fallbackName = fallbackEmail.split("@")[0];

  return {
    email: fallbackEmail,
    name: fallbackName,
    role: finalRole as "admin" | "reviewer" | "appraiser",
    bubble_user_id: bubbleUserId || "",
    permissions: finalRole === "admin"
      ? ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report", "manage_rules", "manage_profiles", "manage_permissions"]
      : finalRole === "reviewer"
      ? ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report"]
      : ["run_qc", "check_findings", "resolve_requests"]
  };
}

function getRole(req: express.Request): string {
  return getActiveUser(req).role;
}

function requireReviewer(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = getActiveUser(req);
  if (user.role !== "reviewer" && user.role !== "admin") {
    res.status(403).json({ error: "Reviewer or Admin role required" });
    return;
  }
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = getActiveUser(req);
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin role required" });
    return;
  }
  next();
}

// A role check alone ("is this a reviewer/admin") is not the same as an
// ownership check ("does this run belong to this appraiser") -- an appraiser
// role must only ever reach runs attributed to them. Runs with no appraiser
// attribution at all (legacy/unassigned) stay visible to any role, matching
// the tolerance already used by the runs-list self-filter.
function canAccessRun(
  user: { role: string; email: string; bubble_user_id: string },
  run: { appraiser_email?: string | null; appraiser_bubble_id?: string | null }
): boolean {
  if (user.role === "reviewer" || user.role === "admin") return true;
  if (!run.appraiser_email && !run.appraiser_bubble_id) return true;
  if (run.appraiser_email && user.email && run.appraiser_email.toLowerCase() === user.email.toLowerCase()) return true;
  if (run.appraiser_bubble_id && user.bubble_user_id && run.appraiser_bubble_id === user.bubble_user_id) return true;
  return false;
}

async function startServer() {
  // Initialize subsystems
  initDatabase();
  initDatabaseUad26();
  initParser();
  initParser26();

  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // Determine schema version from env (defaults to 3.6)
  const SCHEMA_VERSION = process.env.QC_SCHEMA_VERSION || "3.6";
  const IS_UAD26 = SCHEMA_VERSION === "2.6";
  const SCHEMA_VERSION_LABEL = IS_UAD26 ? "UAD_2.6_GSE_v1.0" : "GSE_UAD_3.6.0_v1.3";

  // --- API Routes ---

  // Meta status
  app.get("/api/meta", (req, res) => {
    try {
      const activeRules = getRules("enabled");
      res.json({
        schema_version: SCHEMA_VERSION_LABEL,
        ruleset_version: getRulesetVersion(),
        rule_count: getRules("all").length,
        active_rule_count: activeRules.length,
        profiles: getProfiles().map(p => p.name),
        commit: process.env.GIT_COMMIT || "dev",
        environment: process.env.GCP_PROJECT || "local"
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Direct-to-storage upload handshake: for files large enough to risk Cloud
  // Run's ~32MB request ceiling, the client PUTs straight to GCS with this
  // signed URL, then calls POST /api/runs with the returned objectPath
  // instead of a multipart body. 404s (uploadsConfigured() false) in any
  // environment without QC_UPLOAD_BUCKET set -- the client falls back to the
  // direct multipart upload in that case.
  app.post("/api/uploads/init", async (req, res) => {
    try {
      if (!uploadsConfigured()) {
        res.status(404).json({ error: "Direct-to-storage upload is not configured in this environment" });
        return;
      }
      const filename = String(req.body?.filename || "upload");
      const result = await createSignedUploadUrl(filename);
      if (!result) {
        res.status(500).json({ error: "Failed to create signed upload URL" });
        return;
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Upload / evaluate runs
  app.post("/api/runs", upload.single("file"), async (req, res) => {
    try {
      const uploaded = await resolveUploadedFile(req).catch((err: any) => {
        res.status(422).json({ error: `Failed to retrieve uploaded file: ${err.message}` });
        return null;
      });
      if (!uploaded) {
        if (!res.headersSent) res.status(422).json({ error: "No file uploaded" });
        return;
      }

      let xmlBuffer: Buffer;
      let images: Record<string, Buffer> = {};
      const filename = uploaded.filename;

      if (filename.toLowerCase().endsWith(".zip")) {
        try {
          const zip = new AdmZip(uploaded.buffer);
          const xmlEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith(".xml"));
          if (!xmlEntry) {
            res.status(422).json({ error: "No XML report file found inside the uploaded ZIP archive." });
            return;
          }
          xmlBuffer = xmlEntry.getData();
          images = extractZipImages(zip);
        } catch (zipErr: any) {
          res.status(422).json({ error: `Failed to extract ZIP archive: ${zipErr.message}` });
          return;
        }
      } else {
        xmlBuffer = uploaded.buffer;
      }

      const xmlString = xmlBuffer.toString("utf-8");

      // Auto-detect schema: UAD 2.6 uses VALUATION_RESPONSE root, UAD 3.6 uses MESSAGE
      const isUAD26 = xmlString.includes("<VALUATION_RESPONSE") || xmlString.includes("<VALUATION_RESPONSE ");
      const { normalized, structural_errors } = isUAD26
        ? parseAndNormalizeXML26(xmlString, filename)
        : parseAndNormalizeXML(xmlString, filename);
      normalized.images = images;

      // Determine active rules profile
      const profileName = req.query.profile as string | undefined;
      let activeRules = getRules("enabled");
      let profileTag = "";
      if (profileName) {
        const prof = getProfile(profileName);
        if (prof) {
          const disabled = new Set(prof.disabled_rule_ids);
          activeRules = activeRules.filter(r => !disabled.has(r.rule_id));
          profileTag = `+${prof.name}`;
        }
      }

      const rulesetVersion = getRulesetVersion() + profileTag;
      const evaluation = await evaluateReport(normalized, activeRules, isUAD26 ? "2.6" : "3.6");

      // Compute findings counts
      const counts: Record<string, number> = { HardStop: 0, Warning: 0, Advisory: 0 };
      for (const f of evaluation.findings) {
        counts[f.severity] = (counts[f.severity] || 0) + 1;
      }

      const runId = crypto.randomUUID();
      const fileHash = crypto.createHash("sha256").update(xmlBuffer).digest("hex");

      const currentUser = getActiveUser(req);
      const appraiserEmail = req.headers["x-qc-appraiser-email"] as string || (currentUser.role === "appraiser" ? currentUser.email : null);
      const appraiserBubbleId = req.headers["x-qc-appraiser-bubble-id"] as string || (currentUser.role === "appraiser" ? currentUser.bubble_user_id : null);
      const bubbleOrderId = req.headers["x-qc-bubble-order-id"] as string || null;

      const run = {
        id: runId,
        filename,
        file_hash: fileHash,
        created_at: new Date().toISOString(),
        schema_version: isUAD26 ? "UAD_2.6_GSE_v1.0" : "GSE_UAD_3.6.0_v1.3",
        ruleset_version: rulesetVersion,
        sign_off_state: "in_review",
        reviewer_name: null,
        signed_off_at: null,
        counts,
        structural_errors,
        findings: evaluation.findings,
        rule_errors: evaluation.rule_errors,
        audit_log: [] as any[],
        appraiser_email: appraiserEmail,
        appraiser_bubble_id: appraiserBubbleId,
        bubble_order_id: bubbleOrderId,
        reviewer_requests: []
      };

      // Retain original upload
      const filesDir = path.join(getDataDir(run.schema_version), "files", runId);
      fs.mkdirSync(filesDir, { recursive: true });
      fs.writeFileSync(path.join(filesDir, filename), uploaded.buffer);

      saveRun(run, run.schema_version);
      if (uploaded.objectPath) await deleteUploadedObject(uploaded.objectPath);
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Upload revised report for a run (return-to-appraiser workflow)
  app.post("/api/runs/:runId/revision", upload.single("file"), async (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      if (!canAccessRun(getActiveUser(req), run)) {
        res.status(403).json({ error: "Not authorized for this run" });
        return;
      }

      const uploaded = await resolveUploadedFile(req).catch((err: any) => {
        res.status(422).json({ error: `Failed to retrieve uploaded file: ${err.message}` });
        return null;
      });
      if (!uploaded) {
        if (!res.headersSent) res.status(422).json({ error: "No file uploaded" });
        return;
      }

      let xmlBuffer: Buffer;
      let images: Record<string, Buffer> = {};
      const filename = uploaded.filename;

      if (filename.toLowerCase().endsWith(".zip")) {
        try {
          const zip = new AdmZip(uploaded.buffer);
          const xmlEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith(".xml"));
          if (!xmlEntry) {
            res.status(422).json({ error: "No XML report file found inside the uploaded ZIP archive." });
            return;
          }
          xmlBuffer = xmlEntry.getData();
          images = extractZipImages(zip);
        } catch (zipErr: any) {
          res.status(422).json({ error: `Failed to extract ZIP archive: ${zipErr.message}` });
          return;
        }
      } else {
        xmlBuffer = uploaded.buffer;
      }

      const xmlString = xmlBuffer.toString("utf-8");

      // Auto-detect schema for revision
      const isUAD26Rev = xmlString.includes("<VALUATION_RESPONSE") || xmlString.includes("<VALUATION_RESPONSE ");
      const { normalized, structural_errors } = isUAD26Rev
        ? parseAndNormalizeXML26(xmlString, filename)
        : parseAndNormalizeXML(xmlString, filename);
      normalized.images = images;

      // Evaluate revision with original or current ruleset
      const activeRules = getRules("enabled");
      const evaluation = await evaluateReport(normalized, activeRules, isUAD26Rev ? "2.6" : "3.6");

      const counts: Record<string, number> = { HardStop: 0, Warning: 0, Advisory: 0 };
      for (const f of evaluation.findings) {
        counts[f.severity] = (counts[f.severity] || 0) + 1;
      }

      const fileHash = crypto.createHash("sha256").update(xmlBuffer).digest("hex");

      // Update the run fields
      run.has_revision = true;
      run.revised_filename = filename;
      run.revised_file_hash = fileHash;
      run.revised_created_at = new Date().toISOString();
      run.revised_schema_version = isUAD26Rev ? "UAD_2.6_GSE_v1.0" : "GSE_UAD_3.6.0_v1.3";
      run.revised_counts = counts;
      run.revised_structural_errors = structural_errors;
      run.revised_findings = evaluation.findings;
      run.revised_rule_errors = evaluation.rule_errors;
      
      // Mark state as revised_in_review so the reviewer sees a revision has landed
      run.sign_off_state = "revised_in_review";

      // Save revision file to disk
      const filesDir = path.join(getDataDir(run.revised_schema_version || run.schema_version), "files", run.id);
      fs.mkdirSync(filesDir, { recursive: true });
      fs.writeFileSync(path.join(filesDir, `revised_${filename}`), uploaded.buffer);

      // Add audit log entry
      if (!run.audit_log) run.audit_log = [];
      run.audit_log.push({
        action: "revision_uploaded",
        timestamp: new Date().toISOString(),
        filename
      });

      saveRun(run, run.schema_version);
      if (uploaded.objectPath) await deleteUploadedObject(uploaded.objectPath);
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // List runs
  app.get("/api/runs", (req, res) => {
    try {
      const currentUser = getActiveUser(req);

      // An appraiser can never widen their own view via query params -- only
      // reviewer/admin may filter by an arbitrary appraiser identity. Without
      // this, an appraiser (or an unauthenticated guest, who is also the
      // lowest-privilege "appraiser" role) could list any other appraiser's
      // runs just by passing their email/bubble id on the query string.
      const canFilterByOther = currentUser.role === "reviewer" || currentUser.role === "admin";
      const filterEmail = canFilterByOther ? (req.query.appraiser_email as string || req.query.user_email as string || "") : "";
      const filterBubbleId = canFilterByOther ? (req.query.bubble_user_id as string || "") : "";
      const filterOrderId = canFilterByOther ? (req.query.bubble_order_id as string || "") : "";

      let runsList = getRuns();

      if (filterEmail) {
        runsList = runsList.filter(r => r.appraiser_email?.toLowerCase() === filterEmail.toLowerCase());
      }
      if (filterBubbleId) {
        runsList = runsList.filter(r => r.appraiser_bubble_id === filterBubbleId);
      }
      if (filterOrderId) {
        runsList = runsList.filter(r => r.bubble_order_id === filterOrderId);
      }

      if (currentUser.role === "appraiser") {
        runsList = runsList.filter(r =>
          !r.appraiser_email ||
          r.appraiser_email.toLowerCase() === currentUser.email.toLowerCase() ||
          (currentUser.bubble_user_id && r.appraiser_bubble_id === currentUser.bubble_user_id)
        );
      }

      const summaries = runsList
        .map(r => ({
          id: r.id,
          filename: r.filename,
          file_hash: r.file_hash,
          created_at: r.created_at,
          schema_version: r.schema_version,
          ruleset_version: r.ruleset_version,
          sign_off_state: r.sign_off_state,
          reviewer_name: r.reviewer_name,
          counts: r.counts,
          appraiser_email: r.appraiser_email,
          appraiser_bubble_id: r.appraiser_bubble_id,
          bubble_order_id: r.bubble_order_id
        }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      res.json(summaries);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Get run details
  app.get("/api/runs/:runId", (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      if (!canAccessRun(getActiveUser(req), run)) {
        res.status(403).json({ error: "Not authorized for this run" });
        return;
      }
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Serve the original or revised report PDF (extracted from the retained
  // upload) for in-app preview. Filenames used below always come from the
  // server-stored run record, never from the request, so there's no path
  // traversal or header-injection surface here.
  app.get("/api/runs/:runId/file", (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      if (!canAccessRun(getActiveUser(req), run)) {
        res.status(403).json({ error: "Not authorized for this run" });
        return;
      }

      const version = req.query.version === "revised" ? "revised" : "original";
      if (version === "revised" && !run.has_revision) {
        res.status(404).json({ error: "No revision on file for this run" });
        return;
      }

      const dataDir = getDataDir(run.schema_version);
      const filesDir = path.join(dataDir, "files", run.id);
      const targetFilename = version === "revised" ? `revised_${run.revised_filename}` : run.filename;
      const filePath = path.join(filesDir, targetFilename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "Stored report file not found on disk" });
        return;
      }

      const rawBuffer = fs.readFileSync(filePath);
      let pdfBuffer: Buffer | null = null;

      if (targetFilename.toLowerCase().endsWith(".pdf")) {
        pdfBuffer = rawBuffer;
      } else if (targetFilename.toLowerCase().endsWith(".zip")) {
        const zip = new AdmZip(rawBuffer);
        const pdfEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith(".pdf"));
        pdfBuffer = pdfEntry ? pdfEntry.getData() : null;
      }

      if (!pdfBuffer) {
        res.status(404).json({ error: "No PDF found in the uploaded report — an XML-only upload has no document to preview" });
        return;
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${version}-report.pdf"`);
      res.send(pdfBuffer);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Appraiser check finding
  app.post("/api/runs/:runId/findings/:findingId/check", (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      if (!canAccessRun(getActiveUser(req), run)) {
        res.status(403).json({ error: "Not authorized for this run" });
        return;
      }

      const findingId = parseInt(req.params.findingId, 10);
      const finding = run.findings.find(f => f.id === findingId);
      if (!finding) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }

      const role = getRole(req);
      const checked = !!req.body.checked;
      finding.appraiser_checked = checked;

      if (!run.audit_log) run.audit_log = [];
      run.audit_log.push({
        actor_role: role,
        action: "finding_check",
        detail: `finding ${findingId} (${finding.rule_id}) checked=${checked}`,
        created_at: new Date().toISOString()
      });

      saveRun(run, run.schema_version);
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Reviewer evaluate finding
  app.post("/api/runs/:runId/findings/:findingId/review", requireReviewer, (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }

      const findingId = parseInt(req.params.findingId, 10);
      const finding = run.findings.find(f => f.id === findingId);
      if (!finding) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }

      const role = getRole(req);
      const { status, note } = req.body;

      const reviewChoices: Record<string, string[]> = {
        HardStop: ["resolved", "fail"],
        Warning: ["pass", "fail", "conditional_pass"],
        Advisory: ["acknowledged"]
      };

      const allowed = reviewChoices[finding.severity] || [];
      if (!allowed.includes(status)) {
        res.status(422).json({
          error: `Status '${status}' not allowed for ${finding.severity} findings. Allowed: ${allowed.join(", ")}`
        });
        return;
      }

      if (status === "conditional_pass" && !String(note || "").trim()) {
        res.status(422).json({ error: "Conditional pass requires a reviewer comment" });
        return;
      }

      finding.reviewer_status = status;
      finding.reviewer_note = note || null;
      finding.reviewed_at = new Date().toISOString();

      if (!run.audit_log) run.audit_log = [];
      run.audit_log.push({
        actor_role: role,
        action: "finding_review",
        detail: `finding ${findingId} (${finding.rule_id}) status=${status}${note ? ` note=${note}` : ""}`,
        created_at: new Date().toISOString()
      });

      saveRun(run, run.schema_version);
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Sign off run
  app.post("/api/runs/:runId/sign-off", requireReviewer, (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }

      const role = getRole(req);
      const currentUser = getActiveUser(req);
      const { state, reviewer } = req.body;

      if (!["signed_off", "returned", "in_review", "sent_to_appraiser"].includes(state)) {
        res.status(422).json({ error: "state must be signed_off, returned, in_review, or sent_to_appraiser" });
        return;
      }

      run.sign_off_state = state;
      run.reviewer_name = reviewer || currentUser.name || null;
      run.signed_off_at = new Date().toISOString();
      if (currentUser.role === "reviewer" || currentUser.role === "admin") {
        run.reviewer_email = currentUser.email;
      }

      if (!run.audit_log) run.audit_log = [];
      run.audit_log.push({
        actor_role: role,
        action: "sign_off",
        detail: `state=${state} reviewer=${reviewer || ""}`,
        created_at: new Date().toISOString()
      });

      saveRun(run, run.schema_version);
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Add reviewer custom request
  app.post("/api/runs/:runId/reviewer-requests", (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      if (!canAccessRun(getActiveUser(req), run)) {
        res.status(403).json({ error: "Not authorized for this run" });
        return;
      }

      const { text } = req.body;
      if (!text || !text.trim()) {
        res.status(422).json({ error: "Request text cannot be empty" });
        return;
      }

      if (!run.reviewer_requests) {
        run.reviewer_requests = [];
      }

      const requestItem = {
        id: crypto.randomUUID(),
        text: text.trim(),
        checked: false
      };

      run.reviewer_requests.push(requestItem);

      if (!run.audit_log) run.audit_log = [];
      run.audit_log.push({
        actor_role: getRole(req),
        action: "add_reviewer_request",
        detail: `Added custom request: "${requestItem.text}"`,
        created_at: new Date().toISOString()
      });

      saveRun(run, run.schema_version);
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Check/uncheck reviewer custom request
  app.post("/api/runs/:runId/reviewer-requests/:requestId/check", (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      if (!canAccessRun(getActiveUser(req), run)) {
        res.status(403).json({ error: "Not authorized for this run" });
        return;
      }

      if (!run.reviewer_requests) {
        run.reviewer_requests = [];
      }

      const { requestId } = req.params;
      const { checked } = req.body;

      const item = run.reviewer_requests.find(r => r.id === requestId);
      if (!item) {
        res.status(404).json({ error: "Request item not found" });
        return;
      }

      item.checked = !!checked;

      if (!run.audit_log) run.audit_log = [];
      run.audit_log.push({
        actor_role: getRole(req),
        action: "check_reviewer_request",
        detail: `Checked custom request "${item.text}" checked=${checked}`,
        created_at: new Date().toISOString()
      });

      saveRun(run, run.schema_version);
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Delete reviewer custom request
  app.delete("/api/runs/:runId/reviewer-requests/:requestId", requireReviewer, (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }

      if (!run.reviewer_requests) {
        run.reviewer_requests = [];
      }

      const { requestId } = req.params;
      const itemIndex = run.reviewer_requests.findIndex(r => r.id === requestId);
      if (itemIndex === -1) {
        res.status(404).json({ error: "Request item not found" });
        return;
      }

      const text = run.reviewer_requests[itemIndex].text;
      run.reviewer_requests.splice(itemIndex, 1);

      if (!run.audit_log) run.audit_log = [];
      run.audit_log.push({
        actor_role: getRole(req),
        action: "delete_reviewer_request",
        detail: `Deleted custom request: "${text}"`,
        created_at: new Date().toISOString()
      });

      saveRun(run, run.schema_version);
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // GET all users
  app.get("/api/admin/users", requireAdmin, (req, res) => {
    try {
      res.json(getUserPermissions());
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // POST create/update user
  app.post("/api/admin/users", requireAdmin, (req, res) => {
    try {
      const { email, bubble_user_id, name, role, permissions } = req.body;
      if (!email || !email.trim()) {
        res.status(422).json({ error: "Email is required" });
        return;
      }
      if (!role || !["appraiser", "reviewer", "admin"].includes(role)) {
        res.status(422).json({ error: "Invalid role specified" });
        return;
      }

      const finalPermissions = permissions && Array.isArray(permissions) ? permissions : (
        role === "admin"
          ? ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report", "manage_rules", "manage_profiles", "manage_permissions"]
          : role === "reviewer"
          ? ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report"]
          : ["run_qc", "check_findings", "resolve_requests"]
      );

      const savedUser = saveUserPermission({
        email: email.trim().toLowerCase(),
        bubble_user_id: bubble_user_id ? String(bubble_user_id).trim() : undefined,
        name: name ? name.trim() : email.split("@")[0],
        role,
        permissions: finalPermissions
      });

      res.json(savedUser);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // DELETE a user permission
  app.delete("/api/admin/users/:email", requireAdmin, (req, res) => {
    try {
      const { email } = req.params;
      const success = deleteUserPermission(email);
      if (!success) {
        res.status(404).json({ error: "User permission mapping not found" });
        return;
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // GET active user info
  app.get("/api/users/me", (req, res) => {
    try {
      res.json(getActiveUser(req));
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Audit log
  app.get("/api/runs/:runId/audit", requireReviewer, (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      res.json(run.audit_log || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Export runs
  app.get("/api/runs/:runId/export", (req, res) => {
    try {
      const run = getRunBySchema(req.params.runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      if (!canAccessRun(getActiveUser(req), run)) {
        res.status(403).json({ error: "Not authorized for this run" });
        return;
      }

      const format = String(req.query.format || "csv").toLowerCase();
      const mode = String(req.query.mode || "appraiser").toLowerCase();

      if (format !== "csv" && format !== "pdf") {
        res.status(422).json({ error: "format must be csv or pdf" });
        return;
      }

      if (mode !== "appraiser" && mode !== "reviewer") {
        res.status(422).json({ error: "mode must be appraiser or reviewer" });
        return;
      }

      let runToRender = run;
      if (req.query.revision === "true" && run.has_revision) {
        runToRender = {
          ...run,
          filename: run.revised_filename || run.filename,
          file_hash: run.revised_file_hash || run.file_hash,
          created_at: run.revised_created_at || run.created_at,
          counts: run.revised_counts || run.counts,
          structural_errors: run.revised_structural_errors || run.structural_errors,
          findings: run.revised_findings || run.findings,
          rule_errors: run.revised_rule_errors || run.rule_errors,
        };
      }

      // Sanitize: the filename comes from the upload, so strip anything that could
      // break out of the quoted Content-Disposition header (quotes, CR/LF, path seps).
      const stem = (String(runToRender.filename).split(".")[0].replace(/[^a-zA-Z0-9._-]/g, "_")) || "report";

      if (format === "csv") {
        const csvContent = renderCSV(runToRender, mode);
        res.setHeader("Content-Disposition", `attachment; filename="qc_${stem}_${mode}.csv"`);
        res.contentType("text/csv");
        res.send(csvContent);
      } else {
        const pdfHtml = renderPDF(runToRender, mode);
        res.setHeader("Content-Disposition", `attachment; filename="qc_${stem}_${mode}.html"`);
        res.contentType("text/html");
        res.send(pdfHtml);
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // --- ADMIN Routes ---

  // List rules
  app.get("/api/admin/rules", requireAdmin, (req, res) => {
    try {
      const status = String(req.query.status || "all");
      if (!["all", "enabled", "needs_encoding"].includes(status)) {
        res.status(422).json({ error: "status must be all, enabled, or needs_encoding" });
        return;
      }
      res.json(getRules(status));
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Get single rule
  app.get("/api/admin/rules/:ruleId", requireAdmin, (req, res) => {
    try {
      const rule = getRule(req.params.ruleId);
      if (!rule) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      res.json(rule);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Upsert rule
  app.put("/api/admin/rules/:ruleId", requireAdmin, async (req, res) => {
    try {
      const ruleData = req.body;
      ruleData.rule_id = req.params.ruleId;
      
      // Automatic AI review and verification before implementing
      const report = await verifyRuleEncoding(
        ruleData.description || "",
        ruleData.logic || {},
        ruleData.category || "General",
        ruleData.severity || "Warning"
      );
      ruleData.ai_verification = report;

      const updated = upsertRule(ruleData);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Verify proposed rule logic
  app.post("/api/admin/rules/verify", requireAdmin, async (req, res) => {
    try {
      const { description, logic, category, severity } = req.body;
      if (!description) {
        res.status(422).json({ error: "description is required" });
        return;
      }
      const report = await verifyRuleEncoding(description, logic || {}, category || "General", severity || "Warning");
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Toggle rule
  app.post("/api/admin/rules/:ruleId/toggle", requireAdmin, (req, res) => {
    try {
      const enabled = !!req.body.enabled;
      const updated = toggleRule(req.params.ruleId, enabled);
      if (!updated) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Archive rule
  app.post("/api/admin/rules/:ruleId/archive", requireAdmin, (req, res) => {
    try {
      if (!archiveRule(req.params.ruleId)) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      res.json({ archived: req.params.ruleId });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Suggest encoding
  app.post("/api/admin/rules/:ruleId/suggest", requireAdmin, async (req, res) => {
    try {
      const rule = getRule(req.params.ruleId);
      if (!rule) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      const suggestion = await getEncodingSuggestion(rule);
      res.json(suggestion);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Interactive AI suggestion
  app.post("/api/admin/rules/:ruleId/interactive-suggest", requireAdmin, async (req, res) => {
    try {
      const rule = getRule(req.params.ruleId);
      if (!rule) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      const { answers, customFeedback } = req.body;
      const suggestion = await getInteractiveEncodingSuggestion(rule, answers, customFeedback);
      res.json(suggestion);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Batch auto-encode rules (Heuristic-first + Optional AI fallback)
  app.post("/api/admin/rules/batch-encode", requireAdmin, async (req, res) => {
    try {
      const mode = req.body.mode || "heuristic_only"; // "heuristic_only" or "heuristic_and_ai"
      const limit = parseInt(req.body.limit || "50", 10);

      const allRules = getRules("all");
      const unencoded = allRules.filter(r => (r.logic || {}).type === "needs_encoding");
      const manifest = getFieldManifest();

      let updated = 0;
      let heuristicCount = 0;
      let aiCount = 0;
      let failed = 0;

      for (const rule of unencoded) {
        // Try heuristic first
        const heur = tryHeuristicEncode(rule, manifest);
        if (heur) {
          // Mutate in place (rules from getRules are live store references) and
          // persist once after the loop — calling upsertRule per rule rewrote the
          // whole rules.json and wrote a fresh archive copy on every iteration.
          rule.logic = heur;
          rule.updated_at = new Date().toISOString();
          updated++;
          heuristicCount++;
        } else if (mode === "heuristic_and_ai") {
          // Stop if we hit the limit for AI calls in this batch
          if (aiCount >= limit) {
            continue;
          }

          try {
            const ai = getGoogleGenAI();
            if (ai) {
              const suggestion = await getEncodingSuggestion(rule);
              if (suggestion && suggestion.logic_type !== "needs_encoding" && !suggestion.blocked) {
                rule.logic = suggestion.logic;
                rule.updated_at = new Date().toISOString();
                updated++;
                aiCount++;
              } else {
                failed++;
              }
            } else {
              failed++;
            }
          } catch (err) {
            failed++;
          }
        }
      }

      // Single persist for the whole batch (one file write + one archive copy).
      if (updated > 0) {
        saveRulesToDisk();
      }

      res.json({
        total_needs_encoding: unencoded.length,
        processed: heuristicCount + aiCount + failed,
        updated,
        heuristic_count: heuristicCount,
        ai_count: aiCount,
        failed_count: failed
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Suggest new rules from guideline revisions data
  app.post("/api/admin/rules/suggest-from-revisions", requireAdmin, async (req, res) => {
    try {
      const { revisionsText } = req.body;
      if (!revisionsText || !revisionsText.trim()) {
        res.status(422).json({ error: "Revisions text is required" });
        return;
      }

      const ai = getGoogleGenAI();
      if (!ai) {
        res.status(400).json({ error: "AI backend is not configured. Live AI Rule Suggestion requires a configured GEMINI_API_KEY or Vertex AI setup." });
        return;
      }

      const manifest = getFieldManifest();
      const fieldsSample = manifest.slice(0, 40).map(f => `${f.key} (${f.label}, section: ${f.section})`).join("\n");

      const prompt = `You are an expert GSE UAD 3.6 Quality Control administrator. Analyze the following guidelines/revisions text and extract 1 to 5 potential automated compliance rules that should be added to our Quality Control engine.

For each rule, define:
1. rule_id: A unique identifier starting with "UADNEW" followed by 4 digits (e.g. UADNEW0001, UADNEW0002).
2. category: The appraisal section or area (e.g., "Subject Property", "Ownership Rights", "Improvements").
3. description: A clear, concise condition starting with "If " explaining what fires the compliance rule (e.g., "If GrossLivingArea < 500").
4. severity: Either "HardStop" (critical compliance issues), "Warning" (lender requirements), or "Advisory" (informational).
5. messages: An object with "appraiser" (polite coaching message) and "reviewer" (audit style message) strings.
6. logic: The exact JSON machine-executable shape, using candidate fields when possible. Pick one type from:
   - field_present: {"type": "field_present", "field": "<field_key>"}
   - regex_match: {"type": "regex_match", "field": "<field_key>", "pattern": "<regex>"}
   - field_in_set: {"type": "field_in_set", "field": "<field_key>", "allowed": ["A", "B"]}
   - numeric_range: {"type": "numeric_range", "field": "<field_key>", "min": <num>, "max": <num>}
   - value_comparison: {"type": "value_comparison", "field": "<field_key>", "operator": "<op>", "compare_value": "<val>"}

Here are some candidate fields from the GSE UAD 3.6 data model:
${fieldsSample}

Respond with ONLY a JSON array of these rule suggestions. No markdown code blocks, no prose, no introduction.

Revisions Guidelines Text:
${revisionsText}
`;

      const model = process.env.QC_AI_MODEL || "gemini-1.5-flash";
      const responseText = await callGemini(ai, prompt, model);

      let cleanText = responseText.trim();
      if (cleanText.startsWith("```")) {
        // remove code blocks if returned
        cleanText = cleanText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      }

      const suggestions = JSON.parse(cleanText);
      res.json({ suggestions });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Fields manifest
  app.get("/api/admin/fields", requireAdmin, (req, res) => {
    try {
      res.json(getFieldManifest());
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Rules export
  app.get("/api/admin/export", requireAdmin, (req, res) => {
    try {
      res.json({
        name: "qc-rules-export",
        rules: getRules("all")
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Rules import
  app.post("/api/admin/import", requireAdmin, (req, res) => {
    try {
      const { ruleset, replace } = req.body;
      importRuleset(ruleset);
      res.json({ imported: 1 });
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // List profiles
  app.get("/api/admin/profiles", requireAdmin, (req, res) => {
    try {
      res.json(getProfiles());
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Create/update profile
  app.post("/api/admin/profiles", requireAdmin, (req, res) => {
    try {
      const { name, description, disabled_rule_ids } = req.body;
      if (!name || !name.trim()) {
        res.status(422).json({ error: "Profile name required" });
        return;
      }
      const profile = upsertProfile({ id: Date.now(), name: name.trim(), description: description || "", disabled_rule_ids: disabled_rule_ids || [], archived: false, updated_at: new Date().toISOString() });
      res.json(profile);
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Multer throws (via next(err)) instead of returning normally when a direct
  // multipart upload exceeds the fileSize limit above -- without this handler
  // that becomes an unhandled 500 instead of a clear, actionable 413.
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large for direct upload. Large reports should use the direct-to-storage upload path." });
      return;
    }
    next(err);
  });

  // --- Vite Dev Middleware / Static Assets serving ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: path.join(process.cwd(), "frontend")
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "frontend", "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
