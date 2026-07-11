export function renderCSV(run: any, mode: string): string {
  const columns = [
    "run_id", "filename", "created_at", "schema_version", "ruleset_version",
    "mode", "reviewer", "sign_off_state",
    "rule_id", "category", "severity", "message", "field_path", "xpath", "section",
    "values", "citation", "appraiser_checked", "reviewer_status", "reviewer_note"
  ];

  const escapeCSV = (val: any) => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  let csv = columns.join(",") + "\n";
  const base = {
    run_id: run.id,
    filename: run.filename,
    created_at: run.created_at,
    schema_version: run.schema_version,
    ruleset_version: run.ruleset_version,
    mode,
    reviewer: run.reviewer_name || "",
    sign_off_state: run.sign_off_state || ""
  };

  const findings = run.findings || [];
  if (findings.length === 0) {
    const row = [
      base.run_id, base.filename, base.created_at, base.schema_version, base.ruleset_version,
      base.mode, base.reviewer, base.sign_off_state,
      "", "", "", "No issues found", "", "", "", "", "", "", "", ""
    ];
    csv += row.map(escapeCSV).join(",") + "\n";
    return csv;
  }

  for (const f of findings) {
    const message = mode === "appraiser" ? f.message_appraiser : f.message_reviewer;
    const valuesStr = Object.entries(f.values || {})
      .map(([k, v]) => `${k}=${v === null || v === "" ? "(blank)" : v}`)
      .join("; ");

    const row = [
      base.run_id, base.filename, base.created_at, base.schema_version, base.ruleset_version,
      base.mode, base.reviewer, base.sign_off_state,
      f.rule_id, f.category, f.severity, message, f.field_path, f.xpath || "", f.section || "",
      valuesStr, f.citation || "", f.appraiser_checked ? "true" : "false",
      mode === "reviewer" ? (f.reviewer_status || "") : "",
      mode === "reviewer" ? (f.reviewer_note || "") : ""
    ];
    csv += row.map(escapeCSV).join(",") + "\n";
  }

  return csv;
}

export function renderPDF(run: any, mode: string): string {
  const counts = run.counts || {};
  const structural = run.structural_errors || [];
  const findings = run.findings || [];

  const sevColors: Record<string, string> = {
    HardStop: "#b91c1c",
    Warning: "#b45309",
    Advisory: "#0369a1"
  };

  const sevLabels: Record<string, string> = {
    HardStop: "Hard Stop",
    Warning: "Warning",
    Advisory: "Advisory"
  };

  let structuralHtml = "";
  if (structural.length > 0) {
    structuralHtml = `
      <div class="section">
        <h2>Schema / Structural Issues (${structural.length})</h2>
        <p class="small text-gray">These are file-structure problems checked before QC rules; they may invalidate rule results below.</p>
        <ul style="padding-left: 20px;">
          ${structural.slice(0, 100).map((e: any) => `
            <li class="err-item"><strong>[${e.code}${e.location ? ` @ ${e.location}` : ""}]</strong> ${e.message}</li>
          `).join("")}
          ${structural.length > 100 ? `<li class="small text-gray">... and ${structural.length - 100} more</li>` : ""}
        </ul>
      </div>
    `;
  }

  let findingsHtml = "";
  if (findings.length === 0) {
    findingsHtml = `
      <div class="section">
        <h2>No Issues Found</h2>
        <p>All enabled rules passed for ${run.filename} under rule set ${run.ruleset_version}.</p>
      </div>
    `;
  } else {
    // Group by category
    const byCategory: Record<string, any[]> = {};
    for (const f of findings) {
      if (!byCategory[f.category]) {
        byCategory[f.category] = [];
      }
      byCategory[f.category].push(f);
    }

    const order: Record<string, number> = { HardStop: 0, Warning: 1, Advisory: 2 };

    findingsHtml = `
      <div class="section">
        <h2>Findings (${findings.length})</h2>
        ${Object.entries(byCategory).map(([category, items]) => {
          const sorted = [...items].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
          return `
            <div class="category-block">
              <h3>${category}</h3>
              ${sorted.map((f: any) => {
                const message = mode === "appraiser" ? f.message_appraiser : f.message_reviewer;
                const color = sevColors[f.severity] || "#000";
                const label = sevLabels[f.severity] || f.severity;

                const details: string[] = [];
                if (f.section) {
                  details.push(`Location: ${f.section}${f.xpath ? ` - ${f.xpath}` : ""}`);
                }
                for (const [k, v] of Object.entries(f.values || {})) {
                  details.push(`Value: ${k}=${v === null || v === "" ? "(blank)" : v}`);
                }
                if (mode === "reviewer" && f.citation) {
                  details.push(`Citation: ${f.citation}`);
                }
                if (f.appraiser_checked) {
                  details.push("Appraiser marked addressed");
                }
                if (mode === "reviewer" && f.reviewer_status && f.reviewer_status !== "pending") {
                  details.push(`Reviewer: ${f.reviewer_status}${f.reviewer_note ? ` - ${f.reviewer_note}` : ""}`);
                }

                return `
                  <div class="finding-item" style="border-left: 3px solid ${color};">
                    <div class="finding-title" style="color: ${color};">
                      <strong>[${label}] ${f.rule_id}</strong> - ${message}
                    </div>
                    <div class="finding-details">
                      ${details.map(d => `<div class="detail-line">${d}</div>`).join("")}
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>UAD 3.6 QC Report - ${run.filename}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1f2937;
      line-height: 1.5;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 24px;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 12px;
    }
    h2 {
      font-size: 18px;
      font-weight: 600;
      margin-top: 24px;
      margin-bottom: 12px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px;
    }
    h3 {
      font-size: 15px;
      font-weight: 600;
      margin-top: 16px;
      margin-bottom: 8px;
      color: #4b5563;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      font-size: 13px;
    }
    td {
      padding: 6px 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    td.label {
      color: #4b5563;
      font-weight: 500;
      width: 30%;
    }
    .section {
      margin-bottom: 30px;
    }
    .small {
      font-size: 12px;
    }
    .text-gray {
      color: #6b7280;
    }
    .finding-item {
      padding: 10px 12px;
      background-color: #f9fafb;
      margin-bottom: 12px;
      border-radius: 0 4px 4px 0;
    }
    .finding-title {
      font-size: 14px;
      margin-bottom: 6px;
    }
    .finding-details {
      font-size: 12px;
      color: #4b5563;
      padding-left: 8px;
    }
    .detail-line {
      margin-bottom: 2px;
    }
    .err-item {
      font-size: 13px;
      margin-bottom: 4px;
    }
    @media print {
      body {
        padding: 0;
      }
      .finding-item {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <h1>UAD 3.6 Quality Control Report</h1>
  
  <table>
    <tr>
      <td class="label">File</td>
      <td><strong>${run.filename}</strong></td>
    </tr>
    <tr>
      <td class="label">Run ID</td>
      <td>${run.id}</td>
    </tr>
    <tr>
      <td class="label">File hash (SHA-256)</td>
      <td><code class="small">${run.file_hash}</code></td>
    </tr>
    <tr>
      <td class="label">Run timestamp</td>
      <td>${run.created_at}</td>
    </tr>
    <tr>
      <td class="label">Schema version</td>
      <td>${run.schema_version}</td>
    </tr>
    <tr>
      <td class="label">Rule set version</td>
      <td>${run.ruleset_version}</td>
    </tr>
    <tr>
      <td class="label">Mode</td>
      <td>${mode === "appraiser" ? "Appraiser self-check" : "QC reviewer audit"}</td>
    </tr>
    <tr>
      <td class="label">Reviewer</td>
      <td>${run.reviewer_name || "-"}</td>
    </tr>
    <tr>
      <td class="label">Sign-off state</td>
      <td>${run.sign_off_state || "-"}</td>
    </tr>
    <tr>
      <td class="label">Counts</td>
      <td>
        <strong>Hard Stops:</strong> ${counts.HardStop || 0} &nbsp;&nbsp;&nbsp;
        <strong>Warnings:</strong> ${counts.Warning || 0} &nbsp;&nbsp;&nbsp;
        <strong>Advisories:</strong> ${counts.Advisory || 0}
      </td>
    </tr>
  </table>

  ${structuralHtml}
  ${findingsHtml}

  <script>
    // Auto trigger print dialog if format requested is PDF
    window.onload = function() {
      // User can save as PDF or print easily
    }
  </script>
</body>
</html>
  `;
}
