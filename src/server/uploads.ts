import { Storage } from "@google-cloud/storage";
import crypto from "crypto";

// Cloud Run has a hard, non-configurable ~32MiB request-body ceiling -- no
// Express/multer setting can raise it. UAD zip bundles (XML + PDF + photos)
// commonly exceed that, so large uploads must go straight from the browser to
// GCS via a signed URL, bypassing Cloud Run entirely; the server only ever
// sees the small follow-up request naming the object it already received.
// Configured via QC_UPLOAD_BUCKET (set by infra/deploy-gcp.ps1). Unset in
// local dev, where there's no Cloud Run ceiling to work around -- callers
// should fall back to the direct multipart upload path in that case.
const BUCKET_NAME = process.env.QC_UPLOAD_BUCKET || "";
const UPLOAD_PREFIX = "uploads/";
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

let storage: Storage | null = null;
function getStorage(): Storage | null {
  if (!BUCKET_NAME) return null;
  if (!storage) storage = new Storage();
  return storage;
}

export function uploadsConfigured(): boolean {
  return !!BUCKET_NAME;
}

export async function createSignedUploadUrl(filename: string): Promise<{ uploadUrl: string; objectPath: string } | null> {
  const gcs = getStorage();
  if (!gcs) return null;
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
  const objectPath = `${UPLOAD_PREFIX}${crypto.randomUUID()}-${safeName}`;
  const [uploadUrl] = await gcs.bucket(BUCKET_NAME).file(objectPath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + SIGNED_URL_TTL_MS,
    contentType: "application/octet-stream"
  });
  return { uploadUrl, objectPath };
}

// objectPath always comes from a value this module handed out via
// createSignedUploadUrl, but callers pass it back over HTTP, so re-validate
// the uploads/ prefix here rather than trusting the request.
function assertOwnedPath(objectPath: string) {
  if (!objectPath.startsWith(UPLOAD_PREFIX) || objectPath.includes("..")) {
    throw new Error("Invalid object path");
  }
}

export async function downloadUploadedObject(objectPath: string): Promise<Buffer> {
  const gcs = getStorage();
  if (!gcs) throw new Error("GCS upload bucket not configured");
  assertOwnedPath(objectPath);
  const [buffer] = await gcs.bucket(BUCKET_NAME).file(objectPath).download();
  return buffer;
}

export async function deleteUploadedObject(objectPath: string): Promise<void> {
  const gcs = getStorage();
  if (!gcs) return;
  assertOwnedPath(objectPath);
  await gcs.bucket(BUCKET_NAME).file(objectPath).delete({ ignoreNotFound: true }).catch(() => {});
}
