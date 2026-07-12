import { useEffect, useMemo, useState, useRef } from "react";
import { AdminPanel } from "./AdminPanel";
import { PDFPreview } from "./components/PDFPreview";
import { SupplementalAnalytics } from "./components/SupplementalAnalytics";
import {
  checkFinding, getRun, listRuns, reviewFinding, signOff, uploadReport,
  addReviewerRequest, checkReviewerRequest, deleteReviewerRequest, uploadRevision
} from "./api";
import { FindingCard, SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_STYLE } from "./FindingCard";
import type { Finding, Mode, Run, RunSummary, Severity } from "./types";

type AppMode = Mode | "admin";

const SIGN_OFF_LABEL: Record<string, string> = {
  in_review: "In review",
  signed_off: "Signed off",
  returned: "Returned to appraiser",
  sent_to_appraiser: "Sent to appraiser",
};

export default function App() {
  const [run, setRun] = useState<Run | null>(null);
  const [appMode, setAppMode] = useState<AppMode>("appraiser");
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null);
  const [activePage, setActivePage] = useState<"dashboard" | "review">("dashboard");
  const [rightTab, setRightTab] = useState<"form" | "supplemental">("form");

  const activeFinding = useMemo(() => {
    if (!run || selectedFindingId === null) return null;
    return run.findings.find((f) => f.id === selectedFindingId) || null;
  }, [run, selectedFindingId]);

  useEffect(() => {
    if (run && run.findings && run.findings.length > 0) {
      setSelectedFindingId(run.findings[0].id);
    } else {
      setSelectedFindingId(null);
    }
  }, [run?.id]);

  // Side-by-side comparison state & sync scrolling refs
  const [showComparison, setShowComparison] = useState(false);
  const originalRef = useRef<HTMLDivElement>(null);
  const revisedRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);

  const handleScroll = (source: "original" | "revised") => {
    if (isScrolling.current) return;
    isScrolling.current = true;
    const srcEl = source === "original" ? originalRef.current : revisedRef.current;
    const destEl = source === "original" ? revisedRef.current : originalRef.current;
    if (srcEl && destEl) {
      destEl.scrollTop = srcEl.scrollTop;
    }
    setTimeout(() => {
      isScrolling.current = false;
    }, 50);
  };

  const comparisonData = useMemo(() => {
    if (!run || !run.has_revision) return null;
    const origFindings = run.findings || [];
    const revFindings = run.revised_findings || [];

    const getFindingKey = (f: Finding) => `${f.rule_id}::${f.xpath || ""}`;

    const origKeys = new Set(origFindings.map((f: Finding) => getFindingKey(f)));
    const revKeys = new Set(revFindings.map((f: Finding) => getFindingKey(f)));

    // Resolved: in original but not in revised
    const resolved = origFindings.filter((f: Finding) => !revKeys.has(getFindingKey(f)));

    // New: in revised but not in original
    const added = revFindings.filter((f: Finding) => !origKeys.has(getFindingKey(f)));

    // Persistent: in both original and revised
    const persistentOrig = origFindings.filter((f: Finding) => revKeys.has(getFindingKey(f)));
    const persistentRev = revFindings.filter((f: Finding) => origKeys.has(getFindingKey(f)));

    return {
      resolved,
      added,
      persistentOrig,
      persistentRev,
    };
  }, [run]);
  const mode: Mode = appMode === "admin" ? "reviewer" : appMode;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [reviewerName, setReviewerName] = useState("");

  // Simulated Identity State
  const [simEmail, setSimEmail] = useState(localStorage.getItem("qc_user_email") || "appraiser@example.com");
  const [simBubbleId, setSimBubbleId] = useState(localStorage.getItem("qc_user_bubble_id") || "bubble-appraiser-123");
  const [simRole, setSimRole] = useState(localStorage.getItem("qc_user_role") || "appraiser");

  // New checklist item text input state
  const [newRequestText, setNewRequestText] = useState("");
  
  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [meta, setMeta] = useState<{
    schema_version: string;
    ruleset_version: string;
    rule_count: number;
    active_rule_count: number;
    profiles: string[];
  } | null>(null);

  // Custom simulation identity helper
  function updateSimulatedIdentity(email: string, bubbleId: string, role: string) {
    localStorage.setItem("qc_user_email", email);
    localStorage.setItem("qc_user_bubble_id", bubbleId);
    localStorage.setItem("qc_user_role", role);
    setSimEmail(email);
    setSimBubbleId(bubbleId);
    setSimRole(role);
    setAppMode(role as AppMode);
    
    // Auto populate reviewer name if they change to reviewer
    if (role === "reviewer" && !reviewerName) {
      setReviewerName(email.split("@")[0].toUpperCase());
    }
    
    // Clear current run on identity change to prevent mismatched state
    setRun(null);
    setActivePage("dashboard");
    setSelectedFindingId(null);
    
    // Trigger history refresh for the newly active user scope
    listRuns().then(setHistory).catch(() => {});
  }

  async function loadMeta() {
    try {
      const res = await fetch("/api/meta");
      if (res.ok) {
        setMeta(await res.json());
      }
    } catch {
      /* ignore */
    }
  }

  async function refreshHistory() {
    try {
      setHistory(await listRuns());
    } catch {
      /* backend not up yet */
    }
  }

  useEffect(() => {
    // Set initial defaults if not present
    if (!localStorage.getItem("qc_user_role")) {
      localStorage.setItem("qc_user_role", "appraiser");
    }
    if (!localStorage.getItem("qc_user_email")) {
      localStorage.setItem("qc_user_email", "appraiser@example.com");
    }
    if (!localStorage.getItem("qc_user_bubble_id")) {
      localStorage.setItem("qc_user_bubble_id", "bubble-appraiser-123");
    }
    setAppMode((localStorage.getItem("qc_user_role") || "appraiser") as AppMode);
    refreshHistory();
    loadMeta();
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      // Capture appraiser fields for mapping back to the Bubble integration context
      const appraiserEmail = simRole === "appraiser" ? simEmail : undefined;
      const appraiserBubbleId = simRole === "appraiser" ? simBubbleId : undefined;
      const bubbleOrderId = simRole === "appraiser" ? `ORDER-${Math.floor(100000 + Math.random() * 900000)}` : undefined;

      setRun(await uploadReport(file, selectedProfile || undefined, appraiserEmail, appraiserBubbleId, bubbleOrderId));
      await refreshHistory();
      setActivePage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCheck(finding: Finding, checked: boolean) {
    if (!run) return;
    setRun(await checkFinding(run.id, finding.id, checked, mode));
  }

  async function onReview(finding: Finding, status: string, note: string | null) {
    if (!run) return;
    setRun(await reviewFinding(run.id, finding.id, status, note, mode));
    await refreshHistory();
  }

  async function onSignOff(state: string) {
    if (!run) return;
    setError(null);
    try {
      setRun(await signOff(run.id, state, reviewerName.trim() || null, mode));
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Reviewer checklists action handlers
  async function onAddReviewerRequest(text: string) {
    if (!run || !text.trim()) return;
    setError(null);
    try {
      setRun(await addReviewerRequest(run.id, text.trim()));
      setNewRequestText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onToggleReviewerRequest(requestId: string, checked: boolean) {
    if (!run) return;
    setError(null);
    try {
      setRun(await checkReviewerRequest(run.id, requestId, checked));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeleteReviewerRequest(requestId: string) {
    if (!run) return;
    setError(null);
    try {
      setRun(await deleteReviewerRequest(run.id, requestId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const grouped = useMemo(() => {
    if (!run) return [];
    const byCategory = new Map<string, Finding[]>();
    for (const f of run.findings) {
      byCategory.set(f.category, [...(byCategory.get(f.category) ?? []), f]);
    }
    return [...byCategory.entries()].map(([category, findings]) => ({
      category,
      findings: [...findings].sort(
        (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
      ),
    }));
  }, [run]);

  const actionable = run?.findings.filter((f) => f.severity !== "Advisory") ?? [];
  const addressed = actionable.filter((f) => f.appraiser_checked).length;

  if (showComparison && run && run.has_revision) {
    return (
      <div className="fixed inset-0 bg-[#12131a] text-gray-100 flex flex-col z-50 font-sans">
        {/* Comparison Header */}
        <header className="bg-[#1f212a] border-b border-gray-800 px-6 py-4 flex items-center justify-between shadow-md">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-indigo-400 font-extrabold text-xs uppercase tracking-wider flex items-center gap-1">
                <span>✦</span> Side-by-Side Revision Audit
              </span>
              <span className="text-[10px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 rounded px-2 py-0.5">
                Baseline vs Appraiser Revision
              </span>
            </div>
            <h1 className="text-base font-bold tracking-tight text-white flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-gray-400 font-normal text-xs">Original Report:</span> 
              <span className="text-white text-xs font-mono">{run.filename}</span> 
              <span className="text-indigo-400">➔</span> 
              <span className="text-gray-400 font-normal text-xs">Revised Report:</span> 
              <span className="text-emerald-400 text-xs font-mono">{run.revised_filename}</span>
            </h1>
          </div>
          <button
            onClick={() => setShowComparison(false)}
            className="rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3.5 py-2 text-xs transition cursor-pointer shadow-xs"
          >
            ✕ Close Side-by-Side Compare
          </button>
        </header>

        {/* Comparison Dashboard (Summary of differences) */}
        <div className="bg-[#1a1b24] px-6 py-3 border-b border-gray-800 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs shadow-inner">
          <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-lg p-2.5 flex flex-col justify-center">
            <span className="text-[9px] uppercase font-bold text-emerald-400 tracking-wider">Fixed / Resolved Issues</span>
            <span className="text-base font-black text-emerald-400 mt-0.5">{comparisonData?.resolved.length || 0} Issues Fixed</span>
          </div>
          <div className="bg-rose-950/20 border border-rose-900/40 rounded-lg p-2.5 flex flex-col justify-center">
            <span className="text-[9px] uppercase font-bold text-rose-400 tracking-wider">Still Unresolved (Persistent)</span>
            <span className="text-base font-black text-rose-400 mt-0.5">{comparisonData?.persistentRev.length || 0} Issues Pending</span>
          </div>
          <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-2.5 flex flex-col justify-center">
            <span className="text-[9px] uppercase font-bold text-amber-400 tracking-wider">New Warnings Triggered</span>
            <span className="text-base font-black text-amber-400 mt-0.5">{comparisonData?.added.length || 0} New Triggers</span>
          </div>
          <div className="flex items-center sm:justify-end text-left sm:text-right text-[11px] text-gray-400 italic">
            💡 Synchronized scrolling is active. Scroll on either pane to scan modifications simultaneously.
          </div>
        </div>

        {/* Side-by-Side Scroll Panels */}
        <div className="flex-1 flex flex-col sm:flex-row overflow-hidden bg-[#12131a]">
          {/* Left Panel: Original */}
          <div 
            ref={originalRef}
            onScroll={() => handleScroll("original")}
            className="flex-1 overflow-y-auto p-6 space-y-5 border-r border-gray-800"
          >
            <div className="border-b border-gray-800 pb-2 mb-2 flex items-center justify-between">
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-rose-400">Baseline QC Version</span>
                <div className="text-xs font-bold text-white mt-0.5 font-mono">{run.filename}</div>
              </div>
              <span className="text-[10px] text-gray-400 font-mono">Run: {new Date(run.created_at).toLocaleTimeString()}</span>
            </div>

            {/* Counts */}
            <div className="grid grid-cols-3 gap-2">
              {["HardStop", "Warning", "Advisory"].map((s) => (
                <div key={s} className="bg-gray-900/40 rounded-lg border border-gray-800/80 p-2 text-center">
                  <div className="text-sm font-black text-white">{run.counts[s as Severity] ?? 0}</div>
                  <div className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">{s}s</div>
                </div>
              ))}
            </div>

            {/* Findings */}
            <div className="space-y-3 pt-2">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">ORIGINAL COMPLIANCE FINDINGS</h3>
              
              {/* Resolved items first */}
              {comparisonData?.resolved.map((f: any) => (
                <div key={f.id} className="rounded-lg border border-emerald-500/25 bg-emerald-950/5 p-3.5 space-y-1.5 transition">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-extrabold uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                      ✓ Resolved & Fixed
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{f.rule_id}</span>
                  </div>
                  <p className="text-xs text-gray-100 font-bold leading-snug">{f.message_reviewer || f.message_appraiser}</p>
                  {f.section && (
                    <div className="text-[9px] text-gray-400 font-mono bg-[#1a1b24] p-1 rounded">
                      Field: {f.section}
                    </div>
                  )}
                </div>
              ))}

              {/* Persistent items */}
              {comparisonData?.persistentOrig.map((f: any) => (
                <div key={f.id} className="rounded-lg border border-rose-500/15 bg-rose-950/5 p-3.5 space-y-1.5 opacity-60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-extrabold uppercase tracking-wide bg-rose-500/15 text-rose-300 border border-rose-500/20 px-1.5 py-0.5 rounded">
                      Persistent (Still Fails)
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{f.rule_id}</span>
                  </div>
                  <p className="text-xs text-gray-300 font-medium leading-snug">{f.message_reviewer || f.message_appraiser}</p>
                  {f.section && (
                    <div className="text-[9px] text-gray-500 font-mono bg-[#1a1b24]/50 p-1 rounded">
                      Field: {f.section}
                    </div>
                  )}
                </div>
              ))}

              {run.findings.length === 0 && (
                <p className="text-xs text-gray-500 italic">No original findings found.</p>
              )}
            </div>
          </div>

          {/* Right Panel: Revised */}
          <div 
            ref={revisedRef}
            onScroll={() => handleScroll("revised")}
            className="flex-1 overflow-y-auto p-6 space-y-5"
          >
            <div className="border-b border-gray-800 pb-2 mb-2 flex items-center justify-between">
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Revised Run Version</span>
                <div className="text-xs font-bold text-white mt-0.5 font-mono text-emerald-300">{run.revised_filename}</div>
              </div>
              <span className="text-[10px] text-gray-400 font-mono">Run: {new Date(run.revised_created_at || "").toLocaleTimeString()}</span>
            </div>

            {/* Counts */}
            <div className="grid grid-cols-3 gap-2">
              {["HardStop", "Warning", "Advisory"].map((s) => (
                <div key={s} className="bg-gray-900/40 rounded-lg border border-gray-800/80 p-2 text-center">
                  <div className="text-sm font-black text-white">{run.revised_counts?.[s as Severity] ?? 0}</div>
                  <div className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">{s}s</div>
                </div>
              ))}
            </div>

            {/* Findings */}
            <div className="space-y-3 pt-2">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">REVISED COMPLIANCE FINDINGS</h3>

              {/* Added/new items first */}
              {comparisonData?.added.map((f: any) => (
                <div key={f.id} className="rounded-lg border border-amber-500/25 bg-amber-950/5 p-3.5 space-y-1.5 transition">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-extrabold uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-500/20 px-1.5 py-0.5 rounded">
                      ✦ New Rule Triggered
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{f.rule_id}</span>
                  </div>
                  <p className="text-xs text-gray-100 font-bold leading-snug">{f.message_reviewer || f.message_appraiser}</p>
                  {f.section && (
                    <div className="text-[9px] text-gray-400 font-mono bg-[#1a1b24] p-1 rounded">
                      Field: {f.section}
                    </div>
                  )}
                </div>
              ))}

              {/* Persistent items */}
              {comparisonData?.persistentRev.map((f: any) => (
                <div key={f.id} className="rounded-lg border border-rose-500/25 bg-rose-950/5 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-extrabold uppercase tracking-wide bg-rose-500/15 text-rose-300 border border-rose-500/20 px-1.5 py-0.5 rounded">
                      Persistent (Still Fails)
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{f.rule_id}</span>
                  </div>
                  <p className="text-xs text-gray-200 font-medium leading-snug">{f.message_reviewer || f.message_appraiser}</p>
                  {f.section && (
                    <div className="text-[9px] text-gray-500 font-mono bg-[#1a1b24]/50 p-1 rounded">
                      Field: {f.section}
                    </div>
                  )}
                </div>
              ))}

              {run.revised_findings?.length === 0 && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/5 p-5 text-center space-y-1">
                  <p className="text-xs text-emerald-400 font-bold">✨ No Quality Issues Found</p>
                  <p className="text-[11px] text-gray-400">The appraiser resolved all outstanding compliance concerns!</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Role Selector & Bubble Integration Simulator Sub-bar */}
      <div className="bg-[#1f212a] text-white border-b border-gray-800 py-3.5 shadow-md font-sans">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>
            <span className="text-xs font-semibold tracking-wider uppercase text-gray-200">
              UAD 3.6 Compliance Engine
            </span>
            <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded px-1.5 py-0.2 font-mono">
              Bubble-API Connected
            </span>
          </div>

          {/* Identity inputs */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">User Identity:</span>
              <input
                type="text"
                value={simEmail}
                placeholder="email@example.com"
                onChange={(e) => updateSimulatedIdentity(e.target.value, simBubbleId, simRole)}
                className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white max-w-[170px] font-mono focus:border-emerald-500 focus:outline-none"
                title="Simulates standard SSO or Bubble mapping identifier (X-QC-User-Email header)"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Bubble ID:</span>
              <input
                type="text"
                value={simBubbleId}
                placeholder="Bubble ID"
                onChange={(e) => updateSimulatedIdentity(simEmail, e.target.value, simRole)}
                className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white max-w-[130px] font-mono focus:border-emerald-500 focus:outline-none"
                title="Simulates Bubble platform internal reference (X-QC-User-Bubble-Id header)"
              />
            </div>

            <div className="flex items-center gap-1.5 border-l border-gray-800 pl-3">
              <div className="flex rounded-md bg-black/40 p-0.5 text-xs border border-gray-800">
                {(["appraiser", "reviewer", "admin"] as AppMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => updateSimulatedIdentity(simEmail, simBubbleId, m)}
                    className={`px-2.5 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                      appMode === m 
                        ? "bg-emerald-600 text-white shadow-xs" 
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {m === "appraiser" ? "Appraiser" : m === "reviewer" ? "Reviewer" : "Admin Settings"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <section className="bg-[#2a5d49] text-white text-center py-12 px-4 shadow-inner font-sans">
        <div className="max-w-4xl mx-auto space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Quality Control Hub</h1>
          <p className="text-sm md:text-base font-light text-white/90 tracking-wide">Automated Compliance Analysis & Report Audit Portal</p>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 md:px-6 py-8 space-y-6 font-sans">
        
        {/* ADMIN WORKSPACE */}
        {appMode === "admin" && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <AdminPanel />
          </div>
        )}

        {/* DASHBOARD PAGE (Upload & Historical Runs) */}
        {appMode !== "admin" && activePage === "dashboard" && (
          <div className="space-y-6 max-w-5xl mx-auto">
            {/* Welcome message */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm font-sans">
              <div className="text-lg font-bold text-[#1d1c1d] mb-1 font-sans">Welcome to the True Footage Quality Control Portal</div>
              <p className="text-sm text-[#353744] leading-relaxed">
                Upload your UAD 3.6 XML or ZIP report package below to perform real-time, automated compliance and validation checks before submission.
              </p>
            </div>

            {/* File Upload Box (Supports Drop) */}
            <section 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer?.files?.[0];
                if (file) onFile(file);
              }}
              className={`rounded-lg border-2 border-dashed p-6 md:p-8 text-center shadow-sm transition-all duration-200 ${
                isDragging 
                  ? "border-[#00ab44] bg-[#2a5d49]/5 scale-[1.01]" 
                  : "border-[#2a5d49]/30 bg-white"
              }`}
            >
              <div className="max-w-md mx-auto space-y-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#1d1c1d]">Drag and Drop or Upload UAD 3.6 Report File</p>
                  <p className="text-xs text-[#353744]/75">Supports standard delivery .zip packages and .xml files</p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 bg-gray-50 p-4 rounded-lg border border-gray-100">
                  {/* Optional Profile Selector */}
                  <div className="w-full sm:w-auto text-left">
                    <label className="block text-[11px] font-bold text-[#353744] uppercase tracking-wider mb-1">
                      Client Profile (Optional)
                    </label>
                    <select
                      value={selectedProfile}
                      onChange={(e) => setSelectedProfile(e.target.value)}
                      className="w-full sm:w-48 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-[#353744] focus:border-[#2a5d49] focus:outline-none"
                    >
                      <option value="">-- Standard Ruleset --</option>
                      {meta?.profiles?.map((pName) => (
                        <option key={pName} value={pName}>
                          {pName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* File Selector */}
                  <div className="w-full sm:w-auto text-left flex-1">
                    <label className="block text-[11px] font-bold text-[#353744] uppercase tracking-wider mb-1">
                      Select XML/ZIP file
                    </label>
                    <input
                      type="file"
                      accept=".zip,.xml"
                      disabled={busy}
                      onChange={(e) => onFile(e.target.files?.[0])}
                      className="w-full text-xs text-[#353744] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-[#2a5d49]/10 file:text-[#2a5d49] hover:file:bg-[#2a5d49]/20 file:cursor-pointer"
                    />
                  </div>
                </div>

                {busy && (
                  <div className="flex items-center justify-center gap-2 text-sm text-[#353744]">
                    <span className="w-4 h-4 rounded-full border-2 border-[#2a5d49] border-t-transparent animate-spin"></span>
                    Analyzing document against QC rulesets…
                  </div>
                )}
                {error && <p className="text-xs font-semibold text-red-700">{error}</p>}
              </div>
            </section>

            {/* Dynamic Run History */}
            {history.length > 0 && (
              <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden font-sans">
                <h2 className="border-b border-gray-200 bg-gray-50/50 px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-[#353744]">
                  UAD Audit Run History ({history.length})
                </h2>
                <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                  {history.map((r) => (
                    <li key={r.id} className="transition hover:bg-[#2a5d49]/5">
                      <button
                        onClick={async () => {
                          const selectedRun = await getRun(r.id);
                          setRun(selectedRun);
                          setActivePage("review");
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className={`flex w-full flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 text-left text-xs ${
                          run?.id === r.id ? "bg-[#2a5d49]/5 border-l-4 border-[#2a5d49] pl-4" : ""
                        }`}
                      >
                        <div className="space-y-0.5">
                          <span className="font-semibold text-[#1d1c1d] block">{r.filename}</span>
                          <span className="text-[10px] text-[#353744]/70 block">{new Date(r.created_at).toLocaleString()}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2 sm:mt-0">
                          {SEVERITY_ORDER.filter((s) => (r.counts[s] ?? 0) > 0).map((s) => (
                            <span key={s} className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${SEVERITY_STYLE[s]}`}>
                              {r.counts[s]} {SEVERITY_LABEL[s]}
                            </span>
                          ))}
                          {SEVERITY_ORDER.every((s) => !(r.counts[s] ?? 0)) && (
                            <span className="rounded border border-green-300 bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-800">clean</span>
                          )}
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-[#353744] font-medium">
                            {SIGN_OFF_LABEL[r.sign_off_state] ?? r.sign_off_state}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* REVIEW/WORKSPACE PAGE (Split Screen: Left Findings, Right Sticky Form PDF Preview) */}
        {appMode !== "admin" && activePage === "review" && run && (
          <div className="space-y-4">
            
            {/* Nav & Banner bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-lg border border-gray-200 shadow-xs">
              <button
                onClick={() => {
                  setActivePage("dashboard");
                  setSelectedFindingId(null);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 text-xs font-bold transition shadow-xs cursor-pointer"
              >
                ← Back to Dashboard / Uploads
              </button>
              <div className="text-xs text-gray-500 font-medium">
                Active Audit Report: <span className="font-mono text-emerald-800 font-black bg-emerald-50 border border-emerald-200/50 rounded px-2.5 py-1">{run.filename}</span>
              </div>
            </div>

            {/* Main Side-by-Side Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Left Column: Findings, Controls, Checklist (5 Columns) */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* Active Run Metadata Details */}
                <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-md font-bold text-[#1d1c1d] truncate max-w-xs">{run.filename}</h2>
                        <span className="rounded bg-[#2a5d49]/10 text-[#2a5d49] px-2 py-0.5 text-xs font-semibold">
                          {SIGN_OFF_LABEL[run.sign_off_state] ?? run.sign_off_state}
                          {run.reviewer_name ? ` · ${run.reviewer_name}` : ""}
                        </span>
                      </div>
                      <p className="text-xs text-[#353744]/75">
                        Run ID: <code className="font-mono text-gray-600">{run.id.slice(0, 8)}</code> · Run date: {new Date(run.created_at).toLocaleString()}
                      </p>
                      <p className="text-xs text-[#353744]/75">
                        Schema: <span className="font-semibold">{run.schema_version}</span> · Ruleset: <span className="font-semibold text-[#2a5d49]">{run.ruleset_version}</span>
                      </p>
                    </div>
                    
                    {/* Export Buttons */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                      {run.has_revision && (
                        <button
                          onClick={() => setShowComparison(true)}
                          className="flex items-center gap-1 text-xs rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 font-bold text-indigo-700 hover:bg-indigo-100 shadow-xs transition cursor-pointer"
                          title="Compare original report and revised report side-by-side"
                        >
                          <span>🔍 Compare SBS Revision</span>
                        </button>
                      )}
                      <a
                        href={`/api/runs/${run.id}/export?format=pdf&mode=${mode}`}
                        className="flex-1 text-center text-xs rounded border border-gray-300 bg-white px-3 py-1.5 font-medium text-[#353744] hover:bg-gray-50 shadow-xs transition"
                        title="Export PDF quality report"
                      >
                        Download PDF
                      </a>
                      <a
                        href={`/api/runs/${run.id}/export?format=csv&mode=${mode}`}
                        className="flex-1 text-center text-xs rounded border border-gray-300 bg-white px-3 py-1.5 font-medium text-[#353744] hover:bg-gray-50 shadow-xs transition"
                        title="Export raw CSV findings"
                      >
                        Download CSV
                      </a>
                    </div>
                  </div>
                </section>

                {/* Counts Overview Cards */}
                <section className="grid grid-cols-3 gap-3">
                  {SEVERITY_ORDER.map((s: Severity) => (
                    <div key={s} className={`rounded-lg border p-3.5 text-center shadow-xs transition-colors ${SEVERITY_STYLE[s]}`}>
                      <div className="text-2xl font-extrabold tracking-tight">{run.counts[s] ?? 0}</div>
                      <div className="text-[10px] font-bold uppercase tracking-wide mt-0.5 opacity-90">{SEVERITY_LABEL[s]}s</div>
                    </div>
                  ))}
                </section>

                {/* Structural Errors */}
                {run.structural_errors.length > 0 && (
                  <section className="rounded-lg border border-purple-300 bg-purple-50/50 p-4 shadow-xs">
                    <h2 className="text-sm font-semibold text-purple-900 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                      File Structure or Schema Errors ({run.structural_errors.length})
                    </h2>
                    <p className="text-xs text-purple-700 mt-0.5">
                      These issues represent critical structural failures.
                    </p>
                    <ul className="mt-3 max-h-48 overflow-y-auto space-y-1.5 text-xs font-mono text-purple-900 bg-white border border-purple-200 rounded p-3">
                      {run.structural_errors.map((e, i) => (
                        <li key={i} className="border-b border-purple-100 pb-1 last:border-0 last:pb-0">
                          <span className="font-bold">[{e.code}{e.location ? ` @ ${e.location}` : ""}]</span> {e.message}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* Appraiser Checklist Progress Bar */}
                {mode === "appraiser" && actionable.length > 0 && (
                  <section className="rounded-lg border border-[#2a5d49]/20 bg-[#2a5d49]/5 p-5 shadow-xs">
                    <h2 className="text-sm font-bold text-[#1d1c1d]">
                      Appraisal Correction Checklist — {addressed} of {actionable.length} addressed
                    </h2>
                    <p className="mt-1 text-xs text-[#353744]">
                      Complete corrections inside your source software. Tap each checkbox to log your confirmation — state is saved in real-time.
                    </p>
                    <div className="mt-3 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#2a5d49] transition-all duration-300"
                        style={{ width: `${(addressed / actionable.length) * 100}%` }}
                      />
                    </div>
                  </section>
                )}

                {/* Appraiser Revision Uploader */}
                {mode === "appraiser" && run.sign_off_state === "sent_to_appraiser" && (
                  <section className="rounded-lg border-2 border-dashed border-amber-400 bg-amber-50/10 p-5 shadow-sm space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-amber-900 flex items-center gap-1.5 font-sans">
                        <span>📤</span> Action Required: Upload Revised Appraisal Report
                      </h3>
                      <p className="text-xs text-amber-700 mt-1">
                        The reviewer has returned this report for revisions. Address the custom requests and rule fails, then upload your corrected UAD 3.6 XML or ZIP package here.
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <input
                        type="file"
                        accept=".zip,.xml"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setBusy(true);
                          setError(null);
                          try {
                            const updated = await uploadRevision(run.id, file);
                            setRun(updated);
                            await refreshHistory();
                            alert("Revised report uploaded successfully! It is now ready for reviewer auditing.");
                          } catch (err: any) {
                            setError(err.message || String(err));
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="text-xs text-gray-800 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-amber-600 file:text-white hover:file:bg-amber-700 file:cursor-pointer"
                      />
                    </div>
                  </section>
                )}

                {/* Reviewer Sign-off Controls */}
                {mode === "reviewer" && (
                  <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-[#1d1c1d]">QD Sign-off & Audit Controls</h3>
                      <p className="text-xs text-[#353744]">Sign off to certify, or send back to the appraiser with the rule fails and requested corrections.</p>
                    </div>
                    <div className="flex flex-col gap-3">
                      <input
                        type="text"
                        value={reviewerName}
                        onChange={(e) => setReviewerName(e.target.value)}
                        placeholder="Your Name (Reviewer)"
                        className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs text-[#1d1c1d] bg-gray-50 focus:bg-white focus:outline-none"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => onSignOff("signed_off")}
                          className="rounded bg-[#2a5d49] py-1.5 text-xs font-bold text-white hover:bg-[#2a5d49]/90 transition cursor-pointer"
                          title="Finalize review and mark report as Signed Off"
                        >
                          Sign Off Certified
                        </button>
                        <button
                          onClick={() => onSignOff("sent_to_appraiser")}
                          className="rounded bg-amber-600 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition cursor-pointer"
                          title="Send back to appraiser with corrections"
                        >
                          Send to Appraiser
                        </button>
                        <button
                          onClick={() => onSignOff("returned")}
                          className="rounded bg-red-700 py-1.5 text-xs font-bold text-white hover:bg-red-800 transition cursor-pointer col-span-2"
                          title="Reject and Return report"
                        >
                          Return / Reject
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {/* Reviewer Custom Requests Checklist */}
                <section className="rounded-lg border border-amber-200 bg-amber-50/25 p-5 shadow-xs space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                        <span className="text-base text-amber-600">📋</span>
                        Reviewer Custom Requests & Action Items
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Reviewer-requested corrections and custom items that the appraiser must address.
                      </p>
                    </div>
                  </div>

                  {/* Request Items List */}
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {(run.reviewer_requests || []).length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No custom reviewer requests have been added yet.</p>
                    ) : (
                      (run.reviewer_requests || []).map((req) => (
                        <div key={req.id} className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-md border border-gray-150 hover:border-gray-250 transition-colors">
                          <label className="flex items-start gap-2.5 cursor-pointer flex-1 select-none text-xs">
                            <input
                              type="checkbox"
                              checked={req.checked}
                              onChange={(e) => onToggleReviewerRequest(req.id, e.target.checked)}
                              className="rounded border-gray-300 h-4 w-4 mt-0.5 text-amber-600 focus:ring-amber-500 cursor-pointer"
                            />
                            <span className={`text-gray-800 ${req.checked ? "line-through text-gray-400 font-normal" : ""}`}>
                              {req.text}
                            </span>
                          </label>
                          
                          {mode === "reviewer" && (
                            <button
                              onClick={() => onDeleteReviewerRequest(req.id)}
                              className="text-red-500 hover:text-red-700 font-bold px-1.5 py-0.5 text-xs hover:bg-red-50 rounded transition-colors cursor-pointer"
                              title="Delete request item"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Item form - Reviewers Only */}
                  {mode === "reviewer" && (
                    <div className="flex gap-2 pt-1">
                      <input
                        type="text"
                        value={newRequestText}
                        onChange={(e) => setNewRequestText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            onAddReviewerRequest(newRequestText);
                          }
                        }}
                        placeholder="Type an adjustment request..."
                        className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:border-amber-500"
                      />
                      <button
                        onClick={() => onAddReviewerRequest(newRequestText)}
                        disabled={!newRequestText.trim()}
                        className="rounded bg-amber-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  )}
                </section>

                {/* Findings List Grouped by Category */}
                <div className="space-y-4">
                  <div className="text-xs font-bold text-[#353744] uppercase tracking-wider">Quality Rule Violations ({run.findings.length})</div>
                  {run.findings.length === 0 ? (
                    <section className="rounded-lg border border-green-200 bg-green-50/50 p-6 text-center shadow-xs">
                      <p className="font-bold text-green-900 text-sm">Perfect Score! No issues identified.</p>
                      <p className="mt-1 text-xs text-green-700">
                        The report passed all active quality rules successfully.
                      </p>
                    </section>
                  ) : (
                    grouped.map(({ category, findings }) => (
                      <section key={category} className="space-y-2">
                        <h3 className="text-xs font-bold text-[#353744] uppercase tracking-wider mb-1 border-l-2 border-[#2a5d49] pl-2">
                          {category}
                        </h3>
                        <div className="space-y-2.5">
                          {findings.map((f) => (
                            <div
                              key={f.id}
                              onClick={() => setSelectedFindingId(f.id)}
                              className={`cursor-pointer transition-all duration-200 rounded-lg ${
                                selectedFindingId === f.id
                                  ? "ring-2 ring-indigo-500 shadow-md scale-[1.01]"
                                  : "opacity-80 hover:opacity-100"
                              }`}
                            >
                              <FindingCard key={f.id} finding={f} mode={mode} onCheck={onCheck} onReview={onReview} />
                            </div>
                          ))}
                        </div>
                      </section>
                    ))
                  )}
                </div>

                {/* Reviewer Rule Errors */}
                {mode === "reviewer" && run.rule_errors.length > 0 && (
                  <section className="rounded-lg border border-orange-200 bg-orange-50/50 p-4 shadow-xs">
                    <h2 className="text-sm font-semibold text-orange-900">Rule Execution Errors ({run.rule_errors.length})</h2>
                    <ul className="mt-2 space-y-1.5 text-xs font-mono text-orange-800">
                      {run.rule_errors.map((e, i) => (
                        <li key={i}>[{e.rule_id}]: {e.detail} ({e.error_type})</li>
                      ))}
                    </ul>
                  </section>
                )}

              </div>

              {/* Right Column: Sticky appraisal report or Supplemental Analytics (7 Columns) */}
              <div className="lg:col-span-7 lg:sticky lg:top-4 h-[calc(100vh-120px)] min-h-[500px] flex flex-col">
                {/* Right Tab Switcher */}
                <div className="flex bg-[#24252f] px-4 pt-2 border-b border-gray-300 rounded-t-lg select-none shrink-0 gap-1">
                  <button
                    onClick={() => setRightTab("form")}
                    className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-t-md transition-all cursor-pointer ${
                      rightTab === "form"
                        ? "bg-gray-100 text-[#1d1c1d] border-t-2 border-[#2a5d49]"
                        : "text-gray-400 hover:text-white hover:bg-gray-800/40"
                    }`}
                  >
                    📝 Fannie Mae 1004 Form
                  </button>
                  <button
                    onClick={() => setRightTab("supplemental")}
                    className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-t-md transition-all cursor-pointer flex items-center gap-1.5 ${
                      rightTab === "supplemental"
                        ? "bg-gray-100 text-[#1d1c1d] border-t-2 border-[#2a5d49]"
                        : "text-gray-400 hover:text-white hover:bg-gray-800/40"
                    }`}
                  >
                    <span>✦</span> Supplemental Analytics
                    <span className="text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-1.5 py-0.2 rounded font-mono font-normal">
                      Maps & Photos
                    </span>
                  </button>
                </div>

                <div className="flex-1 min-h-0 flex flex-col border border-t-0 border-gray-300 rounded-b-lg overflow-hidden bg-white">
                  {rightTab === "form" ? (
                    <PDFPreview 
                      run={run} 
                      activeFinding={activeFinding} 
                    />
                  ) : (
                    <SupplementalAnalytics run={run} />
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-200 text-center py-8 px-4 text-xs text-gray-500 mt-12 font-sans">
        <div className="max-w-4xl mx-auto space-y-2">
          <p className="italic text-[#353744]/80 font-medium tracking-wide">
            Privileged and confidential. For internal True Footage use only.
          </p>
          <p className="text-[11px] text-gray-400">
            © {new Date().getFullYear()} True Footage. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
