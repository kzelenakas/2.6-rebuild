import { useEffect, useMemo, useState } from "react";
import {
  archiveRule, exportRuleset, importRuleset, listAdminRules, listFields, listProfiles,
  saveProfile, saveRule, suggestEncoding, toggleRule, batchEncodeRules, suggestFromRevisions,
  interactiveSuggestEncoding, verifyRule
} from "./adminApi";
import type { AdminRule, EncodingSuggestion, FieldManifestEntry, Profile, BatchEncodeResult, RuleSuggestion, InteractiveEncodingResponse, VerificationReport } from "./adminApi";
import { LogicEditor, validateLogic } from "./LogicEditor";
import { getAdminUsers, saveAdminUser, deleteAdminUser } from "./api";
import type { UserPermission } from "./api";

type Tab = "all" | "enabled" | "needs_encoding" | "profiles" | "rule_creator" | "permissions";

const SEVERITIES = ["HardStop", "Warning", "Advisory"] as const;

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>("all");
  const [rules, setRules] = useState<AdminRule[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [fields, setFields] = useState<FieldManifestEntry[]>([]);

  // Sorting & Filtering State for Rules
  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"rule_id" | "severity" | "category" | "enabled">("rule_id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);

  // Batch action selection state
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());

  // Edit / Form states
  const [editing, setEditing] = useState<AdminRule | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<EncodingSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [verificationReport, setVerificationReport] = useState<VerificationReport | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Interactive AI Encoder States
  const [interactiveRes, setInteractiveRes] = useState<InteractiveEncodingResponse | null>(null);
  const [interactiveLoading, setInteractiveLoading] = useState(false);
  const [userAnswers, setUserAnswers] = useState<Record<string, { answer: string; text: string }>>({});
  const [feedbackText, setFeedbackText] = useState("");

  // Batch encoding state
  const [batchMode, setBatchMode] = useState<"heuristic_only" | "heuristic_and_ai">("heuristic_only");
  const [batchLimit, setBatchLimit] = useState(50);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchEncodeResult | null>(null);

  // Guideline revision state
  const [revisionsText, setRevisionsText] = useState("");
  const [creatingRules, setCreatingRules] = useState(false);
  const [ruleSuggestions, setRuleSuggestions] = useState<RuleSuggestion[]>([]);

  async function onBatchEncode() {
    setBatchRunning(true);
    setBatchResult(null);
    setError(null);
    try {
      const res = await batchEncodeRules(batchMode, batchLimit);
      setBatchResult(res);
      setStatus(`Batch processing complete! Auto-encoded ${res.updated} rules.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchRunning(false);
    }
  }

  async function onAnalyzeRevisions() {
    if (!revisionsText.trim()) return;
    setCreatingRules(true);
    setRuleSuggestions([]);
    setError(null);
    try {
      const res = await suggestFromRevisions(revisionsText);
      setRuleSuggestions(res.suggestions);
      setStatus(`Successfully extracted ${res.suggestions.length} potential rules from guidelines!`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingRules(false);
    }
  }

  async function onApproveSuggestedRule(suggested: RuleSuggestion) {
    setError(null);
    try {
      const newRule: AdminRule = {
        rule_id: suggested.rule_id,
        category: suggested.category,
        description: suggested.description,
        severity: suggested.severity,
        enabled: true,
        logic: suggested.logic,
        citation: "Lender / Guidelines Revision Integration",
        messages: {
          appraiser: suggested.messages.appraiser,
          reviewer: suggested.messages.reviewer,
        }
      };
      await saveRule(newRule);
      setRuleSuggestions(prev => prev.filter(r => r.rule_id !== suggested.rule_id));
      setStatus(`Successfully imported and enabled rule ${suggested.rule_id}!`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    listFields().then(setFields).catch(() => { /* field picker degrades to free text */ });
  }, []);

  function openEdit(rule: AdminRule) {
    setSuggestion(null);
    setInteractiveRes(null);
    setUserAnswers({});
    setFeedbackText("");
    setVerificationReport(rule.ai_verification ? (rule.ai_verification as VerificationReport) : null);
    setEditing(structuredClone(rule));
  }

  function closeEdit() {
    setSuggestion(null);
    setInteractiveRes(null);
    setUserAnswers({});
    setFeedbackText("");
    setVerificationReport(null);
    setEditing(null);
  }

  async function onVerifyRule() {
    if (!editing) return;
    setVerifying(true);
    setVerificationReport(null);
    setError(null);
    setStatus(null);
    try {
      const report = await verifyRule(
        editing.description,
        editing.logic || {},
        editing.category,
        editing.severity
      );
      setVerificationReport(report);
      if (report.approved) {
        setStatus("AI verification completed: Compliance logic approved with high accuracy rating!");
      } else {
        setError("AI verification flag: The auditor highlighted potential issues with the current logic.");
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setVerifying(false);
    }
  }

  async function onStartInteractiveAI() {
    if (!editing) return;
    setInteractiveLoading(true);
    setError(null);
    try {
      const res = await interactiveSuggestEncoding(editing.rule_id, []);
      setInteractiveRes(res);
      setUserAnswers({});
      setFeedbackText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInteractiveLoading(false);
    }
  }

  async function onUpdateInteractiveAI() {
    if (!editing || !interactiveRes) return;
    setInteractiveLoading(true);
    setError(null);
    try {
      const answersArray = Object.entries(userAnswers).map(([id, item]) => ({
        questionId: id,
        answer: item.answer,
        questionText: item.text,
      }));
      const res = await interactiveSuggestEncoding(editing.rule_id, answersArray, feedbackText);
      setInteractiveRes(res);
      setFeedbackText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInteractiveLoading(false);
    }
  }

  async function onSuggest() {
    if (!editing) return;
    setSuggesting(true);
    setError(null);
    try {
      setSuggestion(await suggestEncoding(editing.rule_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  }

  function onApplySuggestion() {
    if (!editing || !suggestion) return;
    setEditing({ ...editing, logic: suggestion.logic });
  }

  async function refresh() {
    setError(null);
    try {
      if (tab === "profiles") {
        setProfiles(await listProfiles());
        // Load rules as well to construct ruleset override list
        setRules(await listAdminRules("all"));
      } else {
        setRules(await listAdminRules(tab));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
    setPage(0);
    setSelectedRuleIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Extract unique categories for filter options
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    rules.forEach((r) => {
      if (r.category) cats.add(r.category);
    });
    return Array.from(cats).sort();
  }, [rules]);

  // Master Sorting & Filtering logic
  const filteredAndSorted = useMemo(() => {
    let result = [...rules];

    // 1. Apply Search Query
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          r.rule_id.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          (r.description || "").toLowerCase().includes(q)
      );
    }

    // 2. Apply Severity Filter
    if (filterSeverity !== "all") {
      result = result.filter((r) => r.severity === filterSeverity);
    }

    // 3. Apply Category Filter
    if (filterCategory !== "all") {
      result = result.filter((r) => r.category === filterCategory);
    }

    // 4. Apply Status Filter
    if (filterStatus !== "all") {
      result = result.filter((r) => {
        const isNeedsEncoding = r.logic?.type === "needs_encoding";
        if (filterStatus === "active") return r.enabled;
        if (filterStatus === "inactive") return !r.enabled;
        if (filterStatus === "needs_encoding") return isNeedsEncoding;
        return true;
      });
    }

    // 5. Apply Sorting
    result.sort((a, b) => {
      let valA: any = a[sortBy];
      let valB: any = b[sortBy];

      if (sortBy === "enabled") {
        valA = a.enabled ? 1 : 0;
        valB = b.enabled ? 1 : 0;
      } else if (sortBy === "severity") {
        const priority: Record<string, number> = { HardStop: 3, Warning: 2, Advisory: 1 };
        valA = priority[a.severity] || 0;
        valB = priority[b.severity] || 0;
      } else {
        valA = String(valA || "").toLowerCase();
        valB = String(valB || "").toLowerCase();
      }

      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [rules, search, filterSeverity, filterCategory, filterStatus, sortBy, sortDir]);

  // Paginated Rules Slice
  const pageRules = useMemo(() => {
    return filteredAndSorted.slice(page * pageSize, (page + 1) * pageSize);
  }, [filteredAndSorted, page, pageSize]);

  const pageCount = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));

  // Handle Sort triggers
  function handleSort(column: typeof sortBy) {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
  }

  // Batch activate/deactivate actions
  async function onBatchToggle(enabled: boolean) {
    if (!window.confirm(`Are you sure you want to ${enabled ? "ACTIVATE" : "DEACTIVATE"} the ${selectedRuleIds.size} selected rule(s)?`)) return;
    setError(null);
    setStatus(null);
    try {
      const promises = Array.from(selectedRuleIds).map((id) => toggleRule(id, enabled));
      await Promise.all(promises);
      setStatus(`Successfully ${enabled ? "activated" : "deactivated"} ${selectedRuleIds.size} rules!`);
      setSelectedRuleIds(new Set());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onSaveEdit() {
    if (!editing) return;
    setError(null);
    try {
      const updated = await saveRule(editing);
      setRules((rs) => rs.map((r) => (r.rule_id === updated.rule_id ? updated : r)));
      setStatus(`${updated.rule_id} saved`);
      closeEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onArchive(rule: AdminRule) {
    if (!window.confirm(`Remove rule ${rule.rule_id}? It is archived (kept in history), not deleted.`)) return;
    try {
      await archiveRule(rule.rule_id);
      setRules((rs) => rs.filter((r) => r.rule_id !== rule.rule_id));
      setStatus(`${rule.rule_id} archived`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onExport() {
    const data = await exportRuleset();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qc_ruleset_export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const data = JSON.parse(await file.text());
      const result = await importRuleset(data, false);
      setStatus(`Imported/updated ${result.imported} rules`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "enabled", "needs_encoding", "profiles", "rule_creator", "permissions"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${tab === t ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            >
              {t === "all"
                ? "All Rules"
                : t === "enabled"
                ? "Enabled Rules"
                : t === "needs_encoding"
                ? "Needs Encoding"
                : t === "profiles"
                ? "Client Rulesets (Profiles)"
                : t === "permissions"
                ? "Users & Permissions"
                : "✦ AI Rule Creator"}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-2">
            <button onClick={onExport} className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Export rules
            </button>
            <label className="cursor-pointer rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Import rules
              <input type="file" accept=".json" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
            </label>
          </span>
        </div>

        {tab !== "profiles" && tab !== "rule_creator" && tab !== "permissions" && (
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-5 text-xs">
            {/* Search Input */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="Search by ID, category, or description…"
                className="w-full rounded border border-gray-300 px-3 py-1.5 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              />
            </div>

            {/* Severity Filter */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Severity</label>
              <select
                value={filterSeverity}
                onChange={(e) => { setFilterSeverity(e.target.value); setPage(0); }}
                className="w-full rounded border border-gray-300 px-2.5 py-1.5 bg-white"
              >
                <option value="all">All Severities</option>
                <option value="HardStop">Hard Stop</option>
                <option value="Warning">Warning</option>
                <option value="Advisory">Advisory</option>
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Category</label>
              <select
                value={filterCategory}
                onChange={(e) => { setFilterCategory(e.target.value); setPage(0); }}
                className="w-full rounded border border-gray-300 px-2.5 py-1.5 bg-white"
              >
                <option value="all">All Categories</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
                className="w-full rounded border border-gray-300 px-2.5 py-1.5 bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active / Enabled</option>
                <option value="inactive">Inactive / Disabled</option>
                <option value="needs_encoding">Needs Logic Encoding</option>
              </select>
            </div>
          </div>
        )}

        {status && <p className="mt-2 text-xs text-green-700 font-semibold flex items-center gap-1">✓ {status}</p>}
        {error && <p className="mt-2 text-xs text-red-700 font-semibold flex items-center gap-1">⚠ {error}</p>}
      </section>

      {tab === "permissions" ? (
        <UsersPermissionsPanel />
      ) : tab === "profiles" ? (
        <ProfilesPanel profiles={profiles} rules={rules} onSaved={refresh} />
      ) : tab === "rule_creator" ? (
        <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span className="text-xl">✦</span> AI-Powered QC Rule Creation Engine
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Paste new guideline revisions, policy updates, or lender overlay descriptions here. Gemini will analyze the text, extract rules, and formulate executable logic that you can inspect and add to your active ruleset with one click.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">Guideline Revisions Text</label>
            <textarea
              rows={6}
              value={revisionsText}
              onChange={(e) => setRevisionsText(e.target.value)}
              placeholder="Paste guidelines here. For example:&#10;Lenders now require that if the property is a Condominium, the HOA dues field must be provided. Also, if PropertyEstateType = 'Leasehold', the LandOwnedInCommonIndicator must be 'false'."
              className="w-full rounded-md border border-gray-300 p-3 text-sm focus:border-gray-950 focus:ring-1 focus:ring-gray-950 font-sans"
            />
          </div>

          <button
            onClick={onAnalyzeRevisions}
            disabled={creatingRules || !revisionsText.trim()}
            className="w-full sm:w-auto rounded-md bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {creatingRules ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Analyzing and formulating rules...
              </>
            ) : (
              "Analyze Guidelines & Formulate Rules"
            )}
          </button>

          {ruleSuggestions.length > 0 && (
            <div className="mt-6 border-t border-gray-100 pt-6 space-y-4">
              <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Formulated Rule Proposals ({ruleSuggestions.length})
              </h4>
              <div className="grid gap-4">
                {ruleSuggestions.map((sug) => (
                  <div key={sug.rule_id} className="rounded-lg border border-gray-200 bg-gray-50 p-4 hover:border-gray-300 transition-colors">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold bg-gray-200 px-1.5 py-0.5 rounded text-gray-800">{sug.rule_id}</span>
                          <span className="text-xs text-gray-400">•</span>
                          <span className="text-xs font-medium text-gray-600">{sug.category}</span>
                          <span className="text-xs text-gray-400">•</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sug.severity === "HardStop" ? "bg-red-50 text-red-700" : sug.severity === "Warning" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700"}`}>
                            {sug.severity === "HardStop" ? "Hard Stop" : sug.severity}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 mt-2">{sug.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onApproveSuggestedRule(sug)}
                          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
                        >
                          Approve & Enable
                        </button>
                        <button
                          onClick={() => setRuleSuggestions(prev => prev.filter(r => r.rule_id !== sug.rule_id))}
                          className="rounded-md bg-white border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Discard
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 bg-gray-900 rounded p-3 text-[11px] font-mono text-gray-300 overflow-x-auto">
                      <div className="text-gray-500 mb-1">// Executable logic encoding:</div>
                      {JSON.stringify(sug.logic, null, 2)}
                    </div>

                    <div className="mt-2 text-xs text-gray-500 grid gap-1 border-t border-gray-200 pt-2 mt-3">
                      <div><strong className="text-gray-700">Appraiser Coaching:</strong> {sug.messages.appraiser}</div>
                      <div><strong className="text-gray-700">Reviewer Flag:</strong> {sug.messages.reviewer}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          {tab === "needs_encoding" && (
            <section className="rounded-lg border border-orange-200 bg-orange-50/50 p-6 space-y-4">
              <div>
                <h3 className="text-md font-bold text-orange-950 flex items-center gap-2">
                  <span className="text-lg">⚙</span> Automated Logic Encoder (Bulk Mode)
                </h3>
                <p className="text-xs text-orange-900 mt-1 leading-relaxed">
                  Avoid encoding them manually! Run our high-precision structural template heuristic engine to instantly parse and encode matches, or combine it with a live Gemini AI fallback to automatically convert rule descriptions into executable machine-logic.
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-4 text-xs">
                <div className="grid gap-1">
                  <span className="font-semibold text-orange-950">Execution Mode</span>
                  <select
                    value={batchMode}
                    onChange={(e) => setBatchMode(e.target.value as any)}
                    className="rounded border border-orange-300 bg-white px-2 py-1.5 text-xs text-gray-800"
                  >
                    <option value="heuristic_only">Fast Heuristic Engine (Fast, 100% accurate, zero cost)</option>
                    <option value="heuristic_and_ai">Heuristics + Live Gemini AI Fallback (Batch Mode)</option>
                  </select>
                </div>

                {batchMode === "heuristic_and_ai" && (
                  <div className="grid gap-1 w-24">
                    <span className="font-semibold text-orange-950">Batch Limit</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={batchLimit}
                      onChange={(e) => setBatchLimit(parseInt(e.target.value, 10) || 50)}
                      className="rounded border border-orange-300 bg-white px-2 py-1 text-xs text-gray-800"
                    />
                  </div>
                )}

                <button
                  onClick={onBatchEncode}
                  disabled={batchRunning}
                  className="rounded-md bg-orange-600 hover:bg-orange-700 disabled:opacity-50 px-4 py-1.5 font-bold text-white transition-colors flex items-center gap-2 text-xs"
                >
                  {batchRunning ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Processing...
                    </>
                  ) : (
                    "Run Bulk Encoder"
                  )}
                </button>
              </div>

              {batchResult && (
                <div className="rounded border border-orange-200 bg-white p-4 text-xs text-gray-800 grid gap-2 animate-fade-in">
                  <div className="font-semibold text-orange-950 flex items-center gap-1">
                    <span className="text-green-600 font-bold text-sm">✓</span> Automated Batch Encoder Complete!
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center border-t border-gray-100 pt-3 mt-1">
                    <div className="p-2 bg-gray-50 rounded">
                      <div className="font-mono text-lg font-bold text-gray-900">{batchResult.total_needs_encoding}</div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider">Unencoded rules</div>
                    </div>
                    <div className="p-2 bg-green-50 rounded">
                      <div className="font-mono text-lg font-bold text-green-700">+{batchResult.updated}</div>
                      <div className="text-[10px] text-green-600 uppercase tracking-wider">Newly Encoded</div>
                    </div>
                    <div className="p-2 bg-blue-50 rounded">
                      <div className="font-mono text-md font-bold text-blue-700">{batchResult.heuristic_count} / {batchResult.ai_count}</div>
                      <div className="text-[10px] text-blue-600 uppercase tracking-wider">Heuristic / AI</div>
                    </div>
                    <div className="p-2 bg-gray-50 rounded">
                      <div className="font-mono text-lg font-bold text-gray-500">{batchResult.total_needs_encoding - batchResult.updated}</div>
                      <div className="text-[10px] text-gray-400 uppercase tracking-wider">Remaining</div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Batch action confirmation panel */}
          {selectedRuleIds.size > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs animate-fade-in">
              <div className="flex items-center gap-2 text-sm text-gray-700 font-medium">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">
                  {selectedRuleIds.size}
                </span>
                <span>{selectedRuleIds.size === 1 ? "rule" : "rules"} selected for batch action</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onBatchToggle(true)}
                  className="rounded-md bg-green-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors shadow-xs flex items-center gap-1"
                >
                  ✓ Activate Selected
                </button>
                <button
                  onClick={() => onBatchToggle(false)}
                  className="rounded-md bg-gray-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1"
                >
                  ✕ Deactivate Selected
                </button>
                <button
                  onClick={() => setSelectedRuleIds(new Set())}
                  className="rounded-md border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel Selection
                </button>
              </div>
            </div>
          )}

          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-200 px-4 py-3 text-xs text-gray-600 gap-2">
              <span className="font-medium text-gray-900">{filteredAndSorted.length} matching rules found</span>
              <div className="flex items-center gap-4 flex-wrap">
                {/* Page Size Selector */}
                <div className="flex items-center gap-1.5">
                  <span>Show</span>
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                    className="rounded border border-gray-300 px-2 py-1 bg-white text-xs text-gray-700"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                  </select>
                  <span>per page</span>
                </div>

                {/* Pagination Controls */}
                <span className="flex items-center gap-1">
                  <button disabled={page === 0} onClick={() => setPage(0)} className="rounded border border-gray-300 px-2 py-1 bg-white disabled:opacity-40" title="First Page">«</button>
                  <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-gray-300 px-2 py-1 bg-white disabled:opacity-40" title="Previous Page">‹</button>
                  <span className="px-2 font-medium">Page {page + 1} of {pageCount}</span>
                  <button disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} className="rounded border border-gray-300 px-2 py-1 bg-white disabled:opacity-40" title="Next Page">›</button>
                  <button disabled={page >= pageCount - 1} onClick={() => setPage(pageCount - 1)} className="rounded border border-gray-300 px-2 py-1 bg-white disabled:opacity-40" title="Last Page">»</button>
                </span>
              </div>
            </div>

            {/* Table layout */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 bg-white text-left text-xs">
                <thead className="bg-gray-50 text-gray-700 uppercase tracking-wider font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-3 w-12 text-center">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 h-4 w-4 text-gray-900 focus:ring-gray-900 cursor-pointer"
                        checked={pageRules.length > 0 && pageRules.every((r) => selectedRuleIds.has(r.rule_id))}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedRuleIds((prev) => {
                            const next = new Set(prev);
                            pageRules.forEach((r) => {
                              if (checked) {
                                next.add(r.rule_id);
                              } else {
                                next.delete(r.rule_id);
                              }
                            });
                            return next;
                          });
                        }}
                      />
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("rule_id")}>
                      Rule ID {sortBy === "rule_id" && (sortDir === "asc" ? "▲" : "▼")}
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("severity")}>
                      Severity {sortBy === "severity" && (sortDir === "asc" ? "▲" : "▼")}
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("category")}>
                      Category {sortBy === "category" && (sortDir === "asc" ? "▲" : "▼")}
                    </th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("enabled")}>
                      Status / Logic {sortBy === "enabled" && (sortDir === "asc" ? "▲" : "▼")}
                    </th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {pageRules.map((rule) => {
                    const isSelected = selectedRuleIds.has(rule.rule_id);
                    const isNeedsEncoding = rule.logic?.type === "needs_encoding";
                    return (
                      <tr key={rule.rule_id} className={`hover:bg-gray-50/50 transition-colors ${isSelected ? "bg-gray-50" : ""}`}>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 h-4 w-4 text-gray-900 focus:ring-gray-900 cursor-pointer"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedRuleIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(rule.rule_id)) {
                                  next.delete(rule.rule_id);
                                } else {
                                  next.add(rule.rule_id);
                                }
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-gray-900">{rule.rule_id}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
                            rule.severity === "HardStop" 
                              ? "bg-red-100 text-red-800" 
                              : rule.severity === "Warning" 
                              ? "bg-amber-100 text-amber-800" 
                              : "bg-sky-100 text-sky-800"
                          }`}>
                            {rule.severity === "HardStop" ? "Hard Stop" : rule.severity}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-500 max-w-[120px] truncate" title={rule.category}>{rule.category}</td>
                        <td className="px-4 py-3 text-gray-800 break-words max-w-xs md:max-w-md">{rule.description}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 items-start">
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              rule.enabled 
                                ? "bg-green-100 text-green-800" 
                                : "bg-gray-100 text-gray-600"
                            }`}>
                              {rule.enabled ? "Active" : "Inactive"}
                            </span>
                            {isNeedsEncoding && (
                              <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-medium text-orange-800" title="Needs manual or AI logic encoding before it can execute">
                                needs encoding
                              </span>
                            )}
                            {rule.ai_verification ? (
                              <span 
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium ${
                                  (rule.ai_verification as any).approved
                                    ? "bg-teal-50 text-teal-700 border border-teal-200"
                                    : "bg-amber-50 text-amber-700 border border-amber-200"
                                }`}
                                title={(rule.ai_verification as any).remarks}
                              >
                                🛡️ AI {(rule.ai_verification as any).approved ? `Verified (${Math.round((rule.ai_verification as any).score * 100)}%)` : "Flagged"}
                              </span>
                            ) : (
                              <span 
                                className="inline-flex items-center gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-400 border border-gray-100"
                                title="No automated AI verification report available for this rule yet"
                              >
                                🛡️ Unverified
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEdit(rule)}
                              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-xs"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => onArchive(rule)}
                              className="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors shadow-xs"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {pageRules.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-400 font-semibold">
                        No compliance rules found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-[#0c0d12]/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
          <section className="bg-white rounded-xl shadow-2xl border border-gray-200 max-w-4xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4 relative flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-1.5">
                <span>🔧</span> Edit Quality Rule: <span className="font-mono text-[#2a5d49]">{editing.rule_id}</span>
              </h3>
              <button 
                onClick={closeEdit} 
                className="text-gray-400 hover:text-gray-600 transition-colors text-lg font-bold cursor-pointer"
                title="Close Edit Window"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 grid gap-3 text-xs">
              <label className="grid gap-1">
                <span className="font-medium text-gray-700">Severity</span>
                <select
                  value={editing.severity}
                  onChange={(e) => setEditing({ ...editing, severity: e.target.value as AdminRule["severity"] })}
                  className="rounded border border-gray-300 px-2 py-1.5"
                >
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s === "HardStop" ? "Hard Stop (must fix)" : s === "Warning" ? "Warning (should fix)" : "Advisory (informational)"}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="font-medium text-gray-700">Category</span>
                <input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5" />
              </label>
              <label className="grid gap-1">
                <span className="font-medium text-gray-700">Description (what is checked)</span>
                <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5" />
              </label>
              <label className="grid gap-1">
                <span className="font-medium text-gray-700">Message for appraisers (coaching tone)</span>
                <textarea
                  value={editing.messages?.appraiser ?? ""}
                  onChange={(e) => setEditing({ ...editing, messages: { ...editing.messages, appraiser: e.target.value || null } })}
                  rows={2} className="rounded border border-gray-300 px-2 py-1.5"
                />
              </label>
              <label className="grid gap-1">
                <span className="font-medium text-gray-700">Message for reviewers (audit tone)</span>
                <textarea
                  value={editing.messages?.reviewer ?? ""}
                onChange={(e) => setEditing({ ...editing, messages: { ...editing.messages, reviewer: e.target.value || null } })}
                rows={2} className="rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            {/* Interactive AI Coach widget */}
            <div className="rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-1.5">
                    <span>✦</span> Enhanced AI Rule Coach (Non-Technical)
                  </h4>
                  <p className="text-[11px] text-indigo-800">
                    Interact with the AI using plain English to refine trigger logic, ask questions, and confirm suitability.
                  </p>
                </div>
                {!interactiveRes && (
                  <button
                    onClick={onStartInteractiveAI}
                    disabled={interactiveLoading}
                    className="rounded bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 font-semibold text-white transition-colors disabled:opacity-50"
                  >
                    {interactiveLoading ? "Starting Coach..." : "Start AI Coach"}
                  </button>
                )}
              </div>

              {interactiveLoading && (
                <div className="flex items-center gap-2 text-indigo-700 animate-pulse font-medium text-[11px]">
                  <span className="h-2 w-2 rounded-full bg-indigo-600 animate-bounce" />
                  AI is analyzing the rule and drafting questions...
                </div>
              )}

              {interactiveRes && !interactiveLoading && (
                <div className="bg-white rounded border border-indigo-100 p-3.5 space-y-3">
                  {/* Human friendly explanation */}
                  <div className="space-y-1 bg-indigo-50/30 p-2.5 rounded border border-indigo-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">How this rule triggers (Human Terms)</span>
                    <p className="text-gray-800 font-medium text-xs leading-relaxed">
                      {interactiveRes.human_explanation}
                    </p>
                  </div>

                  {/* Technical Schema Preview */}
                  <details className="text-[10px]">
                    <summary className="cursor-pointer text-indigo-600 font-medium hover:underline">
                      Show internal technical logic structure
                    </summary>
                    <pre className="mt-1.5 p-2 bg-gray-50 rounded text-[10px] font-mono text-gray-700 overflow-x-auto">
                      {JSON.stringify(interactiveRes.suggested_logic, null, 2)}
                    </pre>
                  </details>

                  {/* Questions Section */}
                  {interactiveRes.questions && interactiveRes.questions.length > 0 && (
                    <div className="space-y-3 border-t border-indigo-50 pt-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 flex items-center gap-1">
                        <span>❓</span> Clarifying Questions
                      </span>
                      {interactiveRes.questions.map((q) => {
                        const currentAnswer = userAnswers[q.id]?.answer || "";
                        return (
                          <div key={q.id} className="space-y-1.5 pl-2 border-l-2 border-indigo-200">
                            <label className="font-semibold text-gray-800 text-xs block">
                              {q.text}
                            </label>

                            {q.type === "yes_no" && (
                              <div className="flex gap-2">
                                {["Yes", "No"].map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => setUserAnswers(prev => ({
                                      ...prev,
                                      [q.id]: { answer: option, text: q.text }
                                    }))}
                                    className={`px-3 py-1 text-xs rounded border font-medium transition-colors ${
                                      currentAnswer === option
                                        ? "bg-indigo-600 border-indigo-600 text-white"
                                        : "bg-white hover:bg-gray-50 text-gray-700 border-gray-300"
                                    }`}
                                  >
                                    {option}
                                  </button>
                                ))}
                              </div>
                            )}

                            {q.type === "multiple_choice" && q.options && (
                              <div className="flex flex-wrap gap-1.5">
                                {q.options.map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => setUserAnswers(prev => ({
                                      ...prev,
                                      [q.id]: { answer: option, text: q.text }
                                    }))}
                                    className={`px-2.5 py-1 text-xs rounded border font-medium transition-colors ${
                                      currentAnswer === option
                                        ? "bg-indigo-600 border-indigo-600 text-white"
                                        : "bg-white hover:bg-gray-50 text-gray-700 border-gray-300"
                                    }`}
                                  >
                                    {option}
                                  </button>
                                ))}
                              </div>
                            )}

                            {q.type === "text" && (
                              <input
                                type="text"
                                value={currentAnswer}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setUserAnswers(prev => ({
                                    ...prev,
                                    [q.id]: { answer: val, text: q.text }
                                  }));
                                }}
                                placeholder="Type your answer here..."
                                className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-800 focus:border-indigo-500 focus:outline-none"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Additional feedback text area */}
                  <div className="space-y-1 border-t border-indigo-50 pt-3">
                    <label className="font-semibold text-gray-800 text-xs block">
                      Customize guidelines in plain English:
                    </label>
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="e.g., 'Ensure this only triggers when PropertyEstateType is Leasehold'"
                      rows={2}
                      className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-800 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onUpdateInteractiveAI}
                      disabled={interactiveLoading}
                      className="rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1.5 text-xs"
                    >
                      Update AI Suggestion
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setEditing({ ...editing, logic: interactiveRes.suggested_logic });
                        setStatus("AI suggestion applied to the rule form below!");
                      }}
                      className="rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold px-3 py-1.5 text-xs"
                    >
                      Apply to Logic Editor
                    </button>

                    {interactiveRes.ready_to_save && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const updated = { ...editing, logic: interactiveRes.suggested_logic };
                            const saved = await saveRule(updated);
                            setRules((rs) => rs.map((r) => (r.rule_id === saved.rule_id ? saved : r)));
                            setStatus(`Successfully saved and encoded rule ${saved.rule_id}!`);
                            closeEdit();
                          } catch (err: any) {
                            setError(err.message || String(err));
                          }
                        }}
                        className="rounded bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1.5 text-xs"
                      >
                        ✓ Accept & Save Rule
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setInteractiveRes(null);
                        setUserAnswers({});
                        setFeedbackText("");
                      }}
                      className="text-gray-500 hover:text-gray-700 px-2.5 py-1.5 text-xs font-medium"
                    >
                      Exit Coach
                    </button>
                  </div>
                </div>
              )}
            </div>

            {editing.logic?.type === "needs_encoding" && (
              <div className="rounded border border-indigo-200 bg-indigo-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-indigo-900">AI-assisted encoding</span>
                  <button
                    onClick={onSuggest}
                    disabled={suggesting}
                    className="rounded bg-indigo-600 px-2.5 py-1 font-medium text-white disabled:opacity-50"
                  >
                    {suggesting ? "Thinking…" : "Suggest encoding"}
                  </button>
                </div>
                {suggestion && (
                  <div className="mt-2 space-y-2">
                    {suggestion.blocked && (
                      <p className="text-amber-800">Blocked: this rule needs Phase 2 (multi-instance) support — see rationale below.</p>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-indigo-800">{suggestion.logic_type}</span>
                      <span className="text-gray-600">confidence {Math.round(suggestion.confidence * 100)}%</span>
                    </div>
                    <p className="text-gray-700">{suggestion.rationale}</p>
                    {suggestion.candidate_fields.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-indigo-700">
                          {suggestion.candidate_fields.length} candidate field(s) considered
                        </summary>
                        <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] text-gray-600">
                          {suggestion.candidate_fields.map((f) => <li key={f.key}>{f.key}</li>)}
                        </ul>
                      </details>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={onApplySuggestion}
                        disabled={suggestion.logic_type === "needs_encoding"}
                        className="rounded border border-indigo-300 bg-white px-2.5 py-1 font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                      >
                        Apply to form below
                      </button>
                      <button onClick={() => setSuggestion(null)} className="rounded border border-gray-300 px-2.5 py-1 text-gray-700">Dismiss</button>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      Applying only fills the fields below — nothing is saved until you click Save.
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-1">
              <span className="text-xs font-medium text-gray-700">What triggers this rule?</span>
              <LogicEditor
                logic={editing.logic}
                fields={fields}
                sourceText={editing.description}
                onChange={(logic) => setEditing({ ...editing, logic })}
              />
            </div>

            {/* AI Rule Verification section */}
            <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-teal-950 flex items-center gap-1.5">
                    <span>🛡️</span> AI Compliance Review & Verification
                  </h4>
                  <p className="text-[11px] text-teal-800">
                    Get an instant AI-powered validation report to review safety, logic mapping, and false positive risks.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onVerifyRule}
                  disabled={verifying}
                  className="rounded bg-teal-700 hover:bg-teal-800 text-white font-semibold px-3 py-1.5 text-xs transition-colors cursor-pointer"
                >
                  {verifying ? "Auditing logic..." : "Run AI Verification"}
                </button>
              </div>

              {verificationReport && (
                <div className="bg-white rounded-md border border-teal-100 p-3.5 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 flex items-center gap-1">
                      <span>✓</span> Verification Audit Result
                    </span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      verificationReport.approved 
                        ? "bg-green-100 text-green-800" 
                        : "bg-amber-100 text-amber-800"
                    }`}>
                      {verificationReport.approved ? "Approved" : "Flags Raised"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 block uppercase">Confidence Score</span>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-full bg-gray-100 rounded-full h-2.5 max-w-[120px]">
                          <div 
                            className={`h-2.5 rounded-full ${verificationReport.score >= 0.8 ? 'bg-green-500' : 'bg-amber-500'}`} 
                            style={{ width: `${Math.round(verificationReport.score * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-gray-800">{Math.round(verificationReport.score * 100)}%</span>
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 block uppercase">Verified On</span>
                      <span className="text-xs font-medium text-gray-600 block mt-1">
                        {new Date().toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="bg-gray-50/50 rounded p-2.5 border border-gray-100 text-xs text-gray-700 leading-relaxed font-sans">
                    {verificationReport.remarks}
                  </div>
                </div>
              )}
            </div>
            </div>
            <div className="flex items-center gap-2 border-t border-gray-100 pt-4">
              <button
                onClick={onSaveEdit}
                disabled={!!validateLogic(editing.logic, fields)}
                title={validateLogic(editing.logic, fields) ?? undefined}
                className="rounded bg-[#2a5d49] hover:bg-[#2a5d49]/90 px-5 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 text-xs transition-colors cursor-pointer"
              >
                Save Rule
              </button>
              <button onClick={closeEdit} className="rounded border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 text-xs font-semibold transition-colors cursor-pointer">Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ==========================================
// CLIENT RULESETS / PROFILES PANEL
// ==========================================
interface ProfilesPanelProps {
  profiles: Profile[];
  rules: AdminRule[];
  onSaved: () => void;
}

function ProfilesPanel({ profiles, rules, onSaved }: ProfilesPanelProps) {
  // Main form details
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  
  // Set of disabled rules for the currently edited profile
  const [disabledSet, setDisabledSet] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Sorting & Filtering State inside Profile Customizer Rules Table
  const [pSearch, setPSearch] = useState("");
  const [pFilterSeverity, setPFilterSeverity] = useState("all");
  const [pFilterCategory, setPFilterCategory] = useState("all");
  const [pFilterStatus, setPFilterStatus] = useState("all"); // 'all', 'enforced', 'bypassed'
  const [pSortBy, setPSortBy] = useState<"rule_id" | "severity" | "category" | "status">("rule_id");
  const [pSortDir, setPSortDir] = useState<"asc" | "desc">("asc");
  const [pPage, setPPage] = useState(0);
  const [pPageSize, setPPageSize] = useState<number>(50);

  // Reset form states
  function clearForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setDisabledSet(new Set());
    setError(null);
    setPPage(0);
  }

  // Load a profile into editor
  function onEditProfile(p: Profile) {
    setEditingId(p.id);
    setName(p.name);
    setDescription(p.description);
    setDisabledSet(new Set(p.disabled_rule_ids));
    setError(null);
    setPPage(0);
  }

  // Duplicate a profile
  function onDuplicateProfile(p: Profile) {
    setEditingId(null); // Force as a new profile
    setName(`${p.name} (Copy)`);
    setDescription(p.description);
    setDisabledSet(new Set(p.disabled_rule_ids));
    setError(null);
    setPPage(0);
  }

  async function onSave() {
    setError(null);
    if (!name.trim()) {
      setError("Ruleset name is required.");
      return;
    }
    try {
      // Save profile to backend with the disabled IDs
      await saveProfile(name.trim(), description.trim(), Array.from(disabledSet));
      clearForm();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Categories list for Profile Rules dropdown filter
  const pCategories = useMemo(() => {
    const cats = new Set<string>();
    rules.forEach((r) => {
      if (r.category) cats.add(r.category);
    });
    return Array.from(cats).sort();
  }, [rules]);

  // Sorting & Filtering of Rules inside the Profile customizer
  const pFilteredAndSortedRules = useMemo(() => {
    let result = [...rules];

    // 1. Search filter
    const q = pSearch.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          r.rule_id.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          (r.description || "").toLowerCase().includes(q)
      );
    }

    // 2. Severity filter
    if (pFilterSeverity !== "all") {
      result = result.filter((r) => r.severity === pFilterSeverity);
    }

    // 3. Category filter
    if (pFilterCategory !== "all") {
      result = result.filter((r) => r.category === pFilterCategory);
    }

    // 4. Custom ruleset status filter (Enforced vs Bypassed)
    if (pFilterStatus !== "all") {
      result = result.filter((r) => {
        const isBypassed = disabledSet.has(r.rule_id);
        if (pFilterStatus === "enforced") return !isBypassed;
        if (pFilterStatus === "bypassed") return isBypassed;
        return true;
      });
    }

    // 5. Sorting
    result.sort((a, b) => {
      let valA: any = a[pSortBy === "status" ? "rule_id" : pSortBy];
      let valB: any = b[pSortBy === "status" ? "rule_id" : pSortBy];

      if (pSortBy === "status") {
        const isBypassedA = disabledSet.has(a.rule_id) ? 1 : 0;
        const isBypassedB = disabledSet.has(b.rule_id) ? 1 : 0;
        valA = isBypassedA;
        valB = isBypassedB;
      } else if (pSortBy === "severity") {
        const priority: Record<string, number> = { HardStop: 3, Warning: 2, Advisory: 1 };
        valA = priority[a.severity] || 0;
        valB = priority[b.severity] || 0;
      } else {
        valA = String(valA || "").toLowerCase();
        valB = String(valB || "").toLowerCase();
      }

      if (valA < valB) return pSortDir === "asc" ? -1 : 1;
      if (valA > valB) return pSortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [rules, pSearch, pFilterSeverity, pFilterCategory, pFilterStatus, pSortBy, pSortDir, disabledSet]);

  // Paginated slice for profiles rules customizer table
  const pPageRules = useMemo(() => {
    return pFilteredAndSortedRules.slice(pPage * pPageSize, (pPage + 1) * pPageSize);
  }, [pFilteredAndSortedRules, pPage, pPageSize]);

  const pPageCount = Math.max(1, Math.ceil(pFilteredAndSortedRules.length / pPageSize));

  function handlePSort(column: typeof pSortBy) {
    if (pSortBy === column) {
      setPSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setPSortBy(column);
      setPSortDir("asc");
    }
  }

  // Bulk rules customizer handlers
  function handleEnforceAllFiltered() {
    setDisabledSet((prev) => {
      const next = new Set(prev);
      pFilteredAndSortedRules.forEach((r) => {
        next.delete(r.rule_id); // Remove from bypassed list -> turns them ON
      });
      return next;
    });
  }

  function handleBypassAllFiltered() {
    setDisabledSet((prev) => {
      const next = new Set(prev);
      pFilteredAndSortedRules.forEach((r) => {
        next.add(r.rule_id); // Add to bypassed list -> turns them OFF
      });
      return next;
    });
  }

  return (
    <section className="space-y-6">
      {/* 1. Saved Rulesets Grid */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-md font-bold text-gray-900">Active Client Rulesets (Profiles)</h3>
        <p className="mt-1 text-xs text-gray-500">
          A client profile acts as a customized ruleset. You can bypass specific rule enforcements for that client overlay. Selected profiles apply automatically when processing reports.
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map((p) => {
            const bypassedCount = p.disabled_rule_ids.length;
            const activeCount = Math.max(0, rules.length - bypassedCount);
            return (
              <div key={p.id} className="rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-all bg-gray-50/50 shadow-xs flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-gray-900">{p.name}</h4>
                      {p.description && <p className="text-xs text-gray-600 mt-0.5">{p.description}</p>}
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      bypassedCount === 0 
                        ? "bg-green-100 text-green-800" 
                        : "bg-amber-100 text-amber-800"
                    }`}>
                      {bypassedCount === 0 ? "100% Rules Active" : `${activeCount} / ${rules.length} Active`}
                    </span>
                  </div>

                  <p className="text-[11px] text-gray-500 line-clamp-2">
                    {bypassedCount > 0 
                      ? `Bypassed overlay rules: ${p.disabled_rule_ids.join(", ")}` 
                      : "No overlay rules bypassed. Full master ruleset enforced."}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-150 flex items-center gap-2">
                  <button
                    onClick={() => onEditProfile(p)}
                    className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-xs"
                  >
                    Edit Ruleset
                  </button>
                  <button
                    onClick={() => onDuplicateProfile(p)}
                    className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-xs"
                  >
                    Duplicate
                  </button>
                </div>
              </div>
            );
          })}
          {profiles.length === 0 && (
            <div className="md:col-span-2 py-8 text-center text-gray-400 font-medium text-xs">
              No custom rulesets defined yet.
            </div>
          )}
        </div>
      </div>

      {/* 2. Create/Edit Ruleset Panel */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 text-xs space-y-4">
        <div>
          <h3 className="text-md font-bold text-gray-900">
            {editingId ? `Modify Custom Ruleset: ${name}` : "Create New Custom Ruleset"}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure ruleset details and toggle which system compliance rules should be checked.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="font-semibold text-gray-700">Ruleset / Profile Name (e.g., Fannie Mae Overlay, Chase Overlay)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Chase Bank Overlay"
              className="rounded border border-gray-300 px-3 py-1.5 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 font-sans"
            />
          </label>
          <label className="grid gap-1">
            <span className="font-semibold text-gray-700">Ruleset Description</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe when this ruleset should be selected"
              className="rounded border border-gray-300 px-3 py-1.5 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 font-sans"
            />
          </label>
        </div>

        {/* 3. Reusable Table Customizer for Client Overlay */}
        <div className="border border-gray-200 rounded-lg p-4 space-y-4 bg-gray-50/50">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h4 className="font-bold text-sm text-gray-900">Enforced Compliance Rules</h4>
              <p className="text-xs text-gray-500">
                Check rules to enforce them. Uncheck rules to bypass them for this ruleset profile.
              </p>
            </div>

            {/* Customizer Stats */}
            <div className="flex items-center gap-3">
              <span className="bg-gray-900 text-white font-semibold text-xs px-2.5 py-1 rounded-md">
                {Math.max(0, rules.length - disabledSet.size)} / {rules.length} Rules Enforced
              </span>
              {disabledSet.size > 0 && (
                <span className="bg-orange-100 text-orange-800 font-semibold text-xs px-2.5 py-1 rounded-md">
                  {disabledSet.size} Bypassed
                </span>
              )}
            </div>
          </div>

          {/* Table Filters inside Ruleset builder */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs bg-white p-3 rounded-md border border-gray-200">
            {/* Search Input */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Filter Rules</label>
              <input
                type="text"
                value={pSearch}
                onChange={(e) => { setPSearch(e.target.value); setPPage(0); }}
                placeholder="Search rule ID, category, or description…"
                className="w-full rounded border border-gray-300 px-3 py-1 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              />
            </div>

            {/* Severity Filter */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Severity</label>
              <select
                value={pFilterSeverity}
                onChange={(e) => { setPFilterSeverity(e.target.value); setPPage(0); }}
                className="w-full rounded border border-gray-300 px-2 bg-white text-xs py-1"
              >
                <option value="all">All Severities</option>
                <option value="HardStop">Hard Stop</option>
                <option value="Warning">Warning</option>
                <option value="Advisory">Advisory</option>
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Category</label>
              <select
                value={pFilterCategory}
                onChange={(e) => { setPFilterCategory(e.target.value); setPPage(0); }}
                className="w-full rounded border border-gray-300 px-2 bg-white text-xs py-1"
              >
                <option value="all">All Categories</option>
                {pCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Ruleset Status Filter */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Ruleset Status</label>
              <select
                value={pFilterStatus}
                onChange={(e) => { setPFilterStatus(e.target.value); setPPage(0); }}
                className="w-full rounded border border-gray-300 px-2 bg-white text-xs py-1"
              >
                <option value="all">All Rules</option>
                <option value="enforced">Enforced (Checked)</option>
                <option value="bypassed">Bypassed (Unchecked)</option>
              </select>
            </div>
          </div>

          {/* Quick Bulk actions inside ruleset panel */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleEnforceAllFiltered}
              className="rounded bg-gray-900 hover:bg-gray-800 text-white font-semibold px-3 py-1 text-[11px] transition-colors"
            >
              Enforce All Filtered
            </button>
            <button
              onClick={handleBypassAllFiltered}
              className="rounded border border-gray-300 hover:bg-gray-100 bg-white text-gray-700 font-semibold px-3 py-1 text-[11px] transition-colors"
            >
              Bypass All Filtered
            </button>
          </div>

          {/* Rules Customizer Table */}
          <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
            {/* Table pagination header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-200 px-4 py-2.5 text-xs text-gray-600 gap-2">
              <span className="font-medium text-gray-800">{pFilteredAndSortedRules.length} rules matching overlay filters</span>
              <div className="flex items-center gap-4 flex-wrap">
                {/* Customizer Page Size selector */}
                <div className="flex items-center gap-1.5">
                  <span>Show</span>
                  <select
                    value={pPageSize}
                    onChange={(e) => { setPPageSize(Number(e.target.value)); setPPage(0); }}
                    className="rounded border border-gray-300 px-2 py-0.5 bg-white text-xs text-gray-700 font-normal"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                  </select>
                  <span>per page</span>
                </div>

                <span className="flex items-center gap-1">
                  <button disabled={pPage === 0} onClick={() => setPPage(0)} className="rounded border border-gray-300 px-2 py-0.5 bg-white disabled:opacity-40">«</button>
                  <button disabled={pPage === 0} onClick={() => setPPage(pPage - 1)} className="rounded border border-gray-300 px-2 py-0.5 bg-white disabled:opacity-40">‹</button>
                  <span className="px-1.5 font-medium">Page {pPage + 1} of {pPageCount}</span>
                  <button disabled={pPage >= pPageCount - 1} onClick={() => setPPage(pPage + 1)} className="rounded border border-gray-300 px-2 py-0.5 bg-white disabled:opacity-40">›</button>
                  <button disabled={pPage >= pPageCount - 1} onClick={() => setPPage(pPageCount - 1)} className="rounded border border-gray-300 px-2 py-0.5 bg-white disabled:opacity-40">»</button>
                </span>
              </div>
            </div>

            {/* Customizer HTML Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 bg-white text-left text-[11px]">
                <thead className="bg-gray-50 text-gray-700 uppercase tracking-wider font-semibold text-[9px]">
                  <tr>
                    <th className="px-4 py-2 w-12 text-center">Enforced</th>
                    <th className="px-4 py-2 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handlePSort("rule_id")}>
                      Rule ID {pSortBy === "rule_id" && (pSortDir === "asc" ? "▲" : "▼")}
                    </th>
                    <th className="px-4 py-2 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handlePSort("severity")}>
                      Severity {pSortBy === "severity" && (pSortDir === "asc" ? "▲" : "▼")}
                    </th>
                    <th className="px-4 py-2 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handlePSort("category")}>
                      Category {pSortBy === "category" && (pSortDir === "asc" ? "▲" : "▼")}
                    </th>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2 cursor-pointer select-none hover:bg-gray-100 transition-colors animate-fade-in" onClick={() => handlePSort("status")}>
                      Status {pSortBy === "status" && (pSortDir === "asc" ? "▲" : "▼")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {pPageRules.map((rule) => {
                    const isBypassed = disabledSet.has(rule.rule_id);
                    const isEnforced = !isBypassed;
                    return (
                      <tr key={rule.rule_id} className={`hover:bg-gray-50/50 transition-colors ${isBypassed ? "bg-orange-50/10" : ""}`}>
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 h-3.5 w-3.5 text-gray-900 focus:ring-gray-900 cursor-pointer"
                            checked={isEnforced}
                            onChange={() => {
                              setDisabledSet((prev) => {
                                const next = new Set(prev);
                                if (next.has(rule.rule_id)) {
                                  next.delete(rule.rule_id); // Toggle back to Enforced
                                } else {
                                  next.add(rule.rule_id); // Toggle to Bypassed
                                }
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-4 py-2 font-mono font-bold text-gray-900">{rule.rule_id}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.2 text-[9px] font-semibold ${
                            rule.severity === "HardStop" 
                              ? "bg-red-100 text-red-800" 
                              : rule.severity === "Warning" 
                              ? "bg-amber-100 text-amber-800" 
                              : "bg-sky-100 text-sky-800"
                          }`}>
                            {rule.severity === "HardStop" ? "Hard Stop" : rule.severity}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-500 font-medium max-w-[100px] truncate">{rule.category}</td>
                        <td className="px-4 py-2 text-gray-800 max-w-sm break-words">{rule.description}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                            isEnforced 
                              ? "bg-green-100 text-green-800" 
                              : "bg-orange-100 text-orange-800"
                          }`}>
                            {isEnforced ? "Enforced" : "Bypassed"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {pPageRules.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-6 text-gray-400 font-semibold">
                        No custom overlay rules found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Action Panel */}
        <div className="flex items-center gap-2.5 pt-2">
          <button
            onClick={onSave}
            disabled={!name.trim()}
            className="rounded-md bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800 disabled:opacity-40 transition-colors shadow-sm"
          >
            {editingId ? "Save Custom Ruleset Overlay" : "Create Ruleset Profile"}
          </button>
          <button
            onClick={clearForm}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Clear / Cancel
          </button>
          {error && <span className="ml-2 font-semibold text-red-700">{error}</span>}
        </div>
      </div>
    </section>
  );
}

export function UsersPermissionsPanel() {
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Edit / Add Form State
  const [email, setEmail] = useState("");
  const [bubbleUserId, setBubbleUserId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"appraiser" | "reviewer" | "admin">("appraiser");
  const [permissions, setPermissions] = useState<string[]>([]);

  const defaultPermissionsForRole = {
    appraiser: ["run_qc", "check_findings", "resolve_requests"],
    reviewer: ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report"],
    admin: ["run_qc", "check_findings", "review_findings", "sign_off", "add_requests", "send_report", "manage_rules", "manage_profiles", "manage_permissions"]
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Update default permissions when role changes
  useEffect(() => {
    setPermissions(defaultPermissionsForRole[role]);
  }, [role]);

  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminUsers();
      setUsers(data);
    } catch (e: any) {
      setError(e.message || "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    setError(null);
    setStatus(null);
    try {
      const saved = await saveAdminUser({
        email: email.trim(),
        bubble_user_id: bubbleUserId.trim() || undefined,
        name: name.trim() || undefined,
        role,
        permissions
      });
      setStatus(`Successfully saved permission profile for ${saved.email}`);
      clearForm();
      fetchUsers();
    } catch (e: any) {
      setError(e.message || "Failed to save user permissions");
    }
  }

  async function handleDelete(userEmail: string) {
    if (!window.confirm(`Are you sure you want to delete permission mapping for ${userEmail}?`)) return;
    setError(null);
    setStatus(null);
    try {
      await deleteAdminUser(userEmail);
      setStatus(`Successfully removed ${userEmail}`);
      fetchUsers();
    } catch (e: any) {
      setError(e.message || "Failed to delete user permissions");
    }
  }

  function handleEdit(user: UserPermission) {
    setEmail(user.email);
    setBubbleUserId(user.bubble_user_id || "");
    setName(user.name);
    setRole(user.role);
    setPermissions(user.permissions);
  }

  function clearForm() {
    setEmail("");
    setBubbleUserId("");
    setName("");
    setRole("appraiser");
    setPermissions(defaultPermissionsForRole["appraiser"]);
  }

  const allPossiblePermissions = [
    { key: "run_qc", label: "Run QC Checks", desc: "Upload and evaluate reports" },
    { key: "check_findings", label: "Check Off Findings", desc: "Toggle checkmark status on findings" },
    { key: "review_findings", label: "Review & Evaluate Findings", desc: "Change finding review status and add notes" },
    { key: "sign_off", label: "Sign-Off Reports", desc: "Finalize run sign-off state" },
    { key: "add_requests", label: "Add Custom Requests", desc: "Add custom checklist items for appraisers" },
    { key: "send_report", label: "Send Reports", desc: "Send report to appraisers" },
    { key: "manage_rules", label: "Manage QC Rules", desc: "Edit, toggle, and create QC rules" },
    { key: "manage_profiles", label: "Manage Overlay Profiles", desc: "Create and edit custom lender overlay profiles" },
    { key: "manage_permissions", label: "Manage Roles & Permissions", desc: "Administer user profiles and bubble integrations" },
  ];

  function togglePermission(permKey: string) {
    setPermissions(prev =>
      prev.includes(permKey)
        ? prev.filter(p => p !== permKey)
        : [...prev, permKey]
    );
  }

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Side - Add/Edit Form */}
        <div className="lg:col-span-1 rounded-lg border border-gray-200 bg-white p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <span className="text-xl text-gray-500">⚙</span>
            Add / Edit User Role & Permissions
          </h3>
          <p className="text-xs text-gray-500">
            Define permissions and assign custom capabilities to specific users. Use Bubble ID or email to map integration parameters.
          </p>

          <form onSubmit={handleSave} className="space-y-3.5 text-xs">
            <div>
              <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">User Email <span className="text-red-500">*</span></label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="appraiser@example.com"
                className="w-full rounded border border-gray-300 p-2 text-xs focus:border-gray-950 focus:ring-1 focus:ring-gray-950"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">Bubble User ID <span className="text-gray-400 font-normal">(Optional)</span></label>
              <input
                type="text"
                value={bubbleUserId}
                onChange={(e) => setBubbleUserId(e.target.value)}
                placeholder="1678943x123..."
                className="w-full rounded border border-gray-300 p-2 text-xs focus:border-gray-950 focus:ring-1 focus:ring-gray-950 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Appraiser"
                className="w-full rounded border border-gray-300 p-2 text-xs focus:border-gray-950 focus:ring-1 focus:ring-gray-950"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">Base Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full rounded border border-gray-300 p-2 text-xs bg-white focus:border-gray-950 focus:ring-1 focus:ring-gray-950"
              >
                <option value="appraiser">Appraiser</option>
                <option value="reviewer">Reviewer</option>
                <option value="admin">Administrator</option>
              </select>
            </div>

            {/* Permissions Checkboxes */}
            <div className="space-y-1.5 border-t border-gray-100 pt-3">
              <label className="block text-[10px] font-semibold text-gray-600 uppercase">Capabilities & Permissions</label>
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1 pt-1">
                {allPossiblePermissions.map((p) => {
                  const isChecked = permissions.includes(p.key);
                  return (
                    <label key={p.key} className="flex items-start gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePermission(p.key)}
                        className="rounded border-gray-300 h-3.5 w-3.5 mt-0.5 text-gray-950 focus:ring-gray-950 cursor-pointer"
                      />
                      <div>
                        <span className="font-semibold text-gray-800 block text-xs leading-tight">{p.label}</span>
                        <span className="text-[10px] text-gray-400 font-normal leading-normal">{p.desc}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <button
                type="submit"
                className="rounded bg-gray-900 px-3.5 py-1.5 font-bold text-white hover:bg-gray-800 transition-colors cursor-pointer"
              >
                Save Profile
              </button>
              <button
                type="button"
                onClick={clearForm}
                className="rounded border border-gray-300 bg-white px-3.5 py-1.5 font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>

            {status && <p className="text-xs text-green-700 font-semibold mt-2">✓ {status}</p>}
            {error && <p className="text-xs text-red-700 font-semibold mt-2">⚠ {error}</p>}
          </form>
        </div>

        {/* Right Side - Registered Users List */}
        <div className="lg:col-span-2 rounded-lg border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <span>👥</span> Registered User Accounts ({users.length})
            </h3>
            <button
              onClick={fetchUsers}
              className="text-xs font-semibold text-gray-600 hover:text-gray-900 flex items-center gap-1 cursor-pointer"
            >
              🔄 Refresh List
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-400 font-semibold text-xs animate-pulse">Loading accounts...</div>
          ) : (
            <div className="overflow-x-auto border border-gray-100 rounded-md">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-bold uppercase text-[9px] tracking-wider">
                    <th className="px-4 py-2.5">User Details</th>
                    <th className="px-4 py-2.5">Bubble ID</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">Capabilities</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {users.map((u) => (
                    <tr key={u.email} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-gray-900 text-xs">{u.name}</div>
                        <div className="text-gray-400 text-[10px] mt-0.5">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        {u.bubble_user_id ? (
                          <span className="font-mono text-[10px] text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">{u.bubble_user_id}</span>
                        ) : (
                          <span className="text-gray-300 italic text-[10px]">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                          u.role === "admin"
                            ? "bg-purple-100 text-purple-800"
                            : u.role === "reviewer"
                            ? "bg-indigo-100 text-indigo-800"
                            : "bg-green-100 text-green-800"
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {u.permissions.map((p) => (
                            <span key={p} className="bg-gray-100 text-gray-600 text-[9px] px-1 py-0.2 rounded font-mono">
                              {p}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right space-x-1.5">
                        <button
                          onClick={() => handleEdit(u)}
                          className="text-[10px] font-semibold text-gray-600 hover:text-gray-900 transition-colors bg-gray-100 px-2 py-1 rounded cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(u.email)}
                          className="text-[10px] font-semibold text-red-600 hover:text-red-900 transition-colors bg-red-50 px-2 py-1 rounded cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-gray-400 font-semibold italic">
                        No user mappings configured yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
