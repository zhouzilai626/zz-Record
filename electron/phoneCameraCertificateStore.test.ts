import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PHONE_CAMERA_CERT_MANIFEST_FILE,
  cleanupCertificateStoreArtifacts,
  inspectCertificateStore,
  prepareCertificateStore,
  writeCertificateFilesTransactionally,
} from "./phoneCameraCertificateStore";

const temporaryDirectories: string[] = [];

async function createTemporaryParent(): Promise<string> {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "recordly-cert-store-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fsp.rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe("phone camera certificate store", () => {
  it("commits a complete file set with a matching manifest", async () => {
    const parent = await createTemporaryParent();
    const store = path.join(parent, "certs");

    writeCertificateFilesTransactionally(store, {
      "ca.pem": "CA-PEM",
      "ca-key.pem": "CA-KEY",
      "ca.cer": Buffer.from([1, 2, 3]),
    });

    expect(fs.readFileSync(path.join(store, "ca.pem"), "utf8")).toBe("CA-PEM");
    expect(inspectCertificateStore(store)).toBe("ok");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(store, PHONE_CAMERA_CERT_MANIFEST_FILE), "utf8"),
    );
    expect(Object.keys(manifest.files).sort()).toEqual([
      "ca-key.pem",
      "ca.cer",
      "ca.pem",
    ]);
  });

  it("carries over untouched files and keeps the manifest describing the full set", async () => {
    const parent = await createTemporaryParent();
    const store = path.join(parent, "certs");
    writeCertificateFilesTransactionally(store, {
      "ca.pem": "CA-PEM",
      "ca-key.pem": "CA-KEY",
    });

    writeCertificateFilesTransactionally(store, {
      "server.pem": "LEAF",
      "server-key.pem": "LEAF-KEY",
    });

    expect(fs.readFileSync(path.join(store, "ca.pem"), "utf8")).toBe("CA-PEM");
    expect(fs.readFileSync(path.join(store, "server.pem"), "utf8")).toBe("LEAF");
    expect(inspectCertificateStore(store)).toBe("ok");
  });

  it("keeps the previous consistent material when the commit rename fails", async () => {
    const parent = await createTemporaryParent();
    const store = path.join(parent, "certs");
    writeCertificateFilesTransactionally(store, { "ca.pem": "OLD" });

    const originalRename = fs.renameSync;
    const renameSpy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((from, to) => {
        if (String(from).includes(".staging-")) {
          throw new Error("commit failed");
        }
        return originalRename(from, to);
      });

    expect(() =>
      writeCertificateFilesTransactionally(store, { "ca.pem": "NEW" }),
    ).toThrow("commit failed");
    renameSpy.mockRestore();

    // Old material must be back in place and still consistent.
    expect(fs.readFileSync(path.join(store, "ca.pem"), "utf8")).toBe("OLD");
    expect(inspectCertificateStore(store)).toBe("ok");
    // No staging leftovers.
    const siblings = fs
      .readdirSync(parent)
      .filter((name) => name.includes(".staging-"));
    expect(siblings).toEqual([]);
  });

  it("clears a corrupt store so callers regenerate a fresh set", async () => {
    const parent = await createTemporaryParent();
    const store = path.join(parent, "certs");
    writeCertificateFilesTransactionally(store, {
      "ca.pem": "CA-PEM",
      "ca-key.pem": "CA-KEY",
    });
    // Simulate a torn write: content no longer matches the manifest.
    fs.writeFileSync(path.join(store, "ca-key.pem"), "TRUNC", "utf8");

    expect(inspectCertificateStore(store)).toBe("corrupt");
    expect(prepareCertificateStore(store)).toBe("cleared");
    expect(fs.existsSync(store)).toBe(false);
  });

  it("adopts legacy pre-manifest material without changing its content", async () => {
    const parent = await createTemporaryParent();
    const store = path.join(parent, "certs");
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, "ca.pem"), "LEGACY-CA", "utf8");
    fs.writeFileSync(path.join(store, "ca-key.pem"), "LEGACY-KEY", "utf8");

    expect(inspectCertificateStore(store)).toBe("legacy");
    expect(prepareCertificateStore(store)).toBe("adopted");
    expect(inspectCertificateStore(store)).toBe("ok");
    expect(fs.readFileSync(path.join(store, "ca.pem"), "utf8")).toBe(
      "LEGACY-CA",
    );
  });

  it("removes interrupted staging and backup directories at startup", async () => {
    const parent = await createTemporaryParent();
    const store = path.join(parent, "certs");
    writeCertificateFilesTransactionally(store, { "ca.pem": "CA" });
    fs.mkdirSync(path.join(parent, "certs.staging-deadbeef"));
    fs.mkdirSync(path.join(parent, "certs.backup-deadbeef"));

    cleanupCertificateStoreArtifacts(store);

    expect(fs.existsSync(path.join(parent, "certs.staging-deadbeef"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(parent, "certs.backup-deadbeef"))).toBe(
      false,
    );
    expect(inspectCertificateStore(store)).toBe("ok");
  });

  it("treats a missing or empty directory as empty", async () => {
    const parent = await createTemporaryParent();
    const store = path.join(parent, "certs");
    expect(inspectCertificateStore(store)).toBe("empty");
    expect(prepareCertificateStore(store)).toBe("empty");
  });
});
