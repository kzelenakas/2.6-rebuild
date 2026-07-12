import type { Mode, Run, RunSummary } from "./types";

export interface UserPermission {
  email: string;
  bubble_user_id?: string;
  name: string;
  role: "appraiser" | "reviewer" | "admin";
  permissions: string[];
}

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

export function getUserHeaders(): Record<string, string> {
  const email = localStorage.getItem("qc_user_email") || "";
  const bubbleId = localStorage.getItem("qc_user_bubble_id") || "";
  const role = localStorage.getItem("qc_user_role") || "appraiser";

  const headers: Record<string, string> = {
    "X-QC-Role": role,
  };
  if (email) {
    headers["X-QC-User-Email"] = email;
  }
  if (bubbleId) {
    headers["X-QC-User-Bubble-Id"] = bubbleId;
  }
  return headers;
}

export async function uploadReport(
  file: File,
  profile?: string,
  appraiserEmail?: string,
  appraiserBubbleId?: string,
  bubbleOrderId?: string
): Promise<Run> {
  const body = new FormData();
  body.append("file", file);
  
  let url = profile ? `/api/runs?profile=${encodeURIComponent(profile)}` : "/api/runs";
  const params = new URLSearchParams();
  if (appraiserEmail) params.append("appraiser_email", appraiserEmail);
  if (appraiserBubbleId) params.append("appraiser_bubble_id", appraiserBubbleId);
  if (bubbleOrderId) params.append("bubble_order_id", bubbleOrderId);
  
  const queryStr = params.toString();
  if (queryStr) {
    url += (url.includes("?") ? "&" : "?") + queryStr;
  }

  return handle(await fetch(url, {
    method: "POST",
    headers: getUserHeaders(),
    body
  }));
}

export async function uploadRevision(runId: string, file: File): Promise<Run> {
  const body = new FormData();
  body.append("file", file);
  return handle(await fetch(`/api/runs/${runId}/revision`, {
    method: "POST",
    headers: getUserHeaders(),
    body
  }));
}

export async function listRuns(): Promise<RunSummary[]> {
  return handle(await fetch("/api/runs", {
    headers: getUserHeaders()
  }));
}

export async function getRun(id: string): Promise<Run> {
  return handle(await fetch(`/api/runs/${id}`, {
    headers: getUserHeaders()
  }));
}

export async function checkFinding(runId: string, findingId: number, checked: boolean, _mode: Mode): Promise<Run> {
  return handle(await fetch(`/api/runs/${runId}/findings/${findingId}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getUserHeaders() },
    body: JSON.stringify({ checked }),
  }));
}

export async function reviewFinding(
  runId: string, findingId: number, status: string, note: string | null, _mode: Mode,
): Promise<Run> {
  return handle(await fetch(`/api/runs/${runId}/findings/${findingId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getUserHeaders() },
    body: JSON.stringify({ status, note }),
  }));
}

export async function signOff(runId: string, state: string, reviewer: string | null, _mode: Mode): Promise<Run> {
  return handle(await fetch(`/api/runs/${runId}/sign-off`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getUserHeaders() },
    body: JSON.stringify({ state, reviewer }),
  }));
}

// Custom Reviewer Request Checklist Endpoints
export async function addReviewerRequest(runId: string, text: string): Promise<Run> {
  return handle(await fetch(`/api/runs/${runId}/reviewer-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getUserHeaders() },
    body: JSON.stringify({ text }),
  }));
}

export async function checkReviewerRequest(runId: string, requestId: string, checked: boolean): Promise<Run> {
  return handle(await fetch(`/api/runs/${runId}/reviewer-requests/${requestId}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getUserHeaders() },
    body: JSON.stringify({ checked }),
  }));
}

export async function deleteReviewerRequest(runId: string, requestId: string): Promise<Run> {
  return handle(await fetch(`/api/runs/${runId}/reviewer-requests/${requestId}`, {
    method: "DELETE",
    headers: getUserHeaders(),
  }));
}

// Admin Users Permissions endpoints
export async function getAdminUsers(): Promise<UserPermission[]> {
  return handle(await fetch("/api/admin/users", {
    headers: getUserHeaders()
  }));
}

export async function saveAdminUser(user: Partial<UserPermission>): Promise<UserPermission> {
  return handle(await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getUserHeaders() },
    body: JSON.stringify(user)
  }));
}

export async function deleteAdminUser(email: string): Promise<{ success: boolean }> {
  return handle(await fetch(`/api/admin/users/${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: getUserHeaders()
  }));
}

export async function getUserMe(): Promise<UserPermission> {
  return handle(await fetch("/api/users/me", {
    headers: getUserHeaders()
  }));
}
