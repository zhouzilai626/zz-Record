import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Transactional persistence for the phone camera certificate material.
 *
 * All certificate files (CA key/PEM/DER, server leaf cert/key, metadata) are
 * committed together: new content is staged in a sibling directory, fsynced,
 * described by a SHA-256 manifest, and then swapped in as a whole directory.
 * A partially written store can therefore never be observed by the loader —
 * either the previous consistent set survives or the new consistent set lands.
 */

export const PHONE_CAMERA_CERT_MANIFEST_FILE = "certificate-manifest.json";

const STAGING_INFIX = ".staging-";
const BACKUP_INFIX = ".backup-";

type CertificateManifest = {
  version: 1;
  files: Record<string, { sha256: string }>;
};

export type CertificateStoreIntegrity = "empty" | "ok" | "legacy" | "corrupt";

function hashBuffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function listRegularFiles(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function writeFileWithSync(filePath: string, data: Buffer): void {
  const handle = fs.openSync(filePath, "w");
  try {
    fs.writeFileSync(handle, data);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function readManifest(directory: string): CertificateManifest | null {
  const manifestPath = path.join(directory, PHONE_CAMERA_CERT_MANIFEST_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as CertificateManifest).version !== 1 ||
      typeof (parsed as CertificateManifest).files !== "object" ||
      (parsed as CertificateManifest).files === null
    ) {
      return null;
    }
    return parsed as CertificateManifest;
  } catch {
    return null;
  }
}

/**
 * Removes leftover staging/backup directories from an interrupted swap.
 * Safe to call at every startup before the store is inspected.
 */
export function cleanupCertificateStoreArtifacts(directory: string): void {
  const parent = path.dirname(directory);
  const base = path.basename(directory);
  let siblings: fs.Dirent[];
  try {
    siblings = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of siblings) {
    if (!entry.isDirectory()) continue;
    if (
      entry.name.startsWith(`${base}${STAGING_INFIX}`) ||
      entry.name.startsWith(`${base}${BACKUP_INFIX}`)
    ) {
      fs.rmSync(path.join(parent, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
}

/**
 * Classifies the on-disk certificate store:
 * - "empty": no certificate files at all (fresh install or cleared store);
 * - "ok": manifest present and every listed file hashes correctly;
 * - "legacy": files from a pre-manifest version exist without a manifest;
 * - "corrupt": manifest present but a listed file is missing or altered.
 */
export function inspectCertificateStore(
  directory: string,
): CertificateStoreIntegrity {
  let files: string[];
  try {
    files = listRegularFiles(directory);
  } catch {
    return "empty";
  }
  if (files.length === 0) {
    return "empty";
  }

  const manifest = readManifest(directory);
  if (!manifest) {
    return files.every((name) => name === PHONE_CAMERA_CERT_MANIFEST_FILE)
      ? "corrupt"
      : "legacy";
  }

  for (const [name, entry] of Object.entries(manifest.files)) {
    const filePath = path.join(directory, name);
    let data: Buffer;
    try {
      data = fs.readFileSync(filePath);
    } catch {
      return "corrupt";
    }
    if (hashBuffer(data) !== entry.sha256) {
      return "corrupt";
    }
  }
  return "ok";
}

/** Deletes the whole certificate store so it can be regenerated from scratch. */
export function clearCertificateStore(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true });
}

/**
 * Atomically commits `files` into the certificate store directory.
 *
 * Existing files that are not being replaced are carried over into the new
 * store version, and the manifest always describes the complete resulting set.
 * The swap keeps a backup of the previous directory and rolls it back if the
 * commit fails, so the previous consistent material is never lost.
 */
export function writeCertificateFilesTransactionally(
  directory: string,
  files: Record<string, string | Buffer>,
): void {
  const parent = path.dirname(directory);
  const base = path.basename(directory);
  const stagingDir = path.join(parent, `${base}${STAGING_INFIX}${randomUUID()}`);
  const backupDir = path.join(parent, `${base}${BACKUP_INFIX}${randomUUID()}`);

  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(stagingDir);

  try {
    // Carry over files that this transaction does not replace.
    let existing: string[] = [];
    try {
      existing = listRegularFiles(directory);
    } catch {
      existing = [];
    }
    for (const name of existing) {
      if (name === PHONE_CAMERA_CERT_MANIFEST_FILE) continue;
      if (Object.prototype.hasOwnProperty.call(files, name)) continue;
      writeFileWithSync(
        path.join(stagingDir, name),
        fs.readFileSync(path.join(directory, name)),
      );
    }

    for (const [name, data] of Object.entries(files)) {
      writeFileWithSync(
        path.join(stagingDir, name),
        typeof data === "string" ? Buffer.from(data, "utf8") : data,
      );
    }

    const manifest: CertificateManifest = { version: 1, files: {} };
    for (const name of listRegularFiles(stagingDir)) {
      manifest.files[name] = {
        sha256: hashBuffer(fs.readFileSync(path.join(stagingDir, name))),
      };
    }
    writeFileWithSync(
      path.join(stagingDir, PHONE_CAMERA_CERT_MANIFEST_FILE),
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
    );

    // Swap: previous directory becomes a backup until the commit succeeds.
    let hadPrevious = false;
    if (fs.existsSync(directory)) {
      fs.renameSync(directory, backupDir);
      hadPrevious = true;
    }
    try {
      fs.renameSync(stagingDir, directory);
    } catch (error) {
      if (hadPrevious) {
        try {
          fs.renameSync(backupDir, directory);
        } catch {
          // The backup stays on disk for manual recovery.
        }
      }
      throw error;
    }
    if (hadPrevious) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Prepares the store before certificates are loaded:
 * - cleans interrupted staging/backup leftovers;
 * - adopts legacy pre-manifest material by generating its manifest;
 * - clears a corrupt store so callers regenerate a fresh consistent set.
 * Returns the action that was taken.
 */
export function prepareCertificateStore(
  directory: string,
): "ready" | "adopted" | "cleared" | "empty" {
  cleanupCertificateStoreArtifacts(directory);
  const integrity = inspectCertificateStore(directory);
  if (integrity === "empty") {
    return "empty";
  }
  if (integrity === "ok") {
    return "ready";
  }
  if (integrity === "legacy") {
    // Existing installs predate the manifest; adopt them without changing content.
    writeCertificateFilesTransactionally(directory, {});
    return "adopted";
  }
  clearCertificateStore(directory);
  return "cleared";
}
