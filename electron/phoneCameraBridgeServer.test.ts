import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => ".test-user-data",
  },
}));

import {
  MAX_CA_DOWNLOAD_TICKETS_PER_SESSION,
  PHONE_CAMERA_SECURITY_HEADERS,
  PhoneCameraCaTicketStore,
  configurePhoneCameraBridgeSession,
  handlePhoneCameraBridgeRequest,
  handlePhoneCameraSetupRequest,
} from "./phoneCameraBridgeServer";

const servers: ReturnType<typeof createServer>[] = [];

async function startServer(
  handler: typeof handlePhoneCameraBridgeRequest | typeof handlePhoneCameraSetupRequest,
): Promise<string> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  servers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function startTestServer(): Promise<string> {
  return startServer(handlePhoneCameraBridgeRequest);
}

function startTestSetupServer(): Promise<string> {
  return startServer(handlePhoneCameraSetupRequest);
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("phone camera CA ticket store", () => {
  it("issues opaque single-use tickets that are scoped to one session", () => {
    const store = new PhoneCameraCaTicketStore();
    const ticket = store.issue("session-a", Date.now() + 60_000);

    expect(ticket).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(store.consume(ticket!, "session-b")).toBe(false);
    expect(store.consume(ticket!, "session-a")).toBe(true);
    expect(store.consume(ticket!, "session-a")).toBe(false);
  });

  it("rejects expired tickets and caps ticket issuance per session", () => {
    const store = new PhoneCameraCaTicketStore();
    const expired = store.issue("session-a", 100);
    expect(store.consume(expired!, "session-a", 100)).toBe(false);

    const tickets = Array.from(
      { length: MAX_CA_DOWNLOAD_TICKETS_PER_SESSION - 1 },
      () => store.issue("session-a", Date.now() + 60_000),
    );
    expect(tickets.every(Boolean)).toBe(true);
    expect(store.issue("session-a", Date.now() + 60_000)).toBeNull();
  });
});

describe("phone camera bridge", () => {
  it("rejects expired pairing tokens on bridge and frame requests", async () => {
    const expiredSession = {
      sessionId: "expired-session",
      pairingToken: "x".repeat(43),
      pairingExpiresAtMs: Date.now() - 1,
    };
    const isCurrentExpiredSession = (payload: {
      sessionId: string;
      pairingToken: string;
    }) =>
      payload.sessionId === expiredSession.sessionId &&
      payload.pairingToken === expiredSession.pairingToken &&
      expiredSession.pairingExpiresAtMs > Date.now();
    const onConnect = vi.fn(isCurrentExpiredSession);
    const onFrame = vi.fn(isCurrentExpiredSession);
    configurePhoneCameraBridgeSession({
      getSession: () => expiredSession,
      onConnect,
      onFrame,
    });
    const baseUrl = await startTestServer();

    const pairingPage = await fetch(
      `${baseUrl}/phone-camera?session=${expiredSession.sessionId}&token=${expiredSession.pairingToken}`,
    );
    const connect = await fetch(`${baseUrl}/phone-camera/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: expiredSession.sessionId,
        pairingToken: expiredSession.pairingToken,
      }),
    });
    const frame = await fetch(`${baseUrl}/phone-camera/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: expiredSession.sessionId,
        pairingToken: expiredSession.pairingToken,
        frameDataUrl: "data:image/jpeg;base64,AA==",
        width: 1,
        height: 1,
      }),
    });

    expect(pairingPage.status).toBe(410);
    expect(connect.status).toBe(410);
    expect(frame.status).toBe(410);
    expect(onConnect).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledOnce();
  });

  it("only permits health CORS for the configured setup origin", async () => {
    const baseUrl = await startTestServer();
    const untrustedOrigin = "http://evil.test:17886";
    const response = await fetch(`${baseUrl}/phone-camera-health`, {
      headers: { Origin: untrustedOrigin },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not grant CORS permissions to an untrusted health preflight", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/phone-camera-health`, {
      method: "OPTIONS",
      headers: { Origin: "http://evil.test:17886" },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("applies the complete security header policy to health responses", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/phone-camera-health`);

    expect(response.status).toBe(204);
    for (const [header, value] of Object.entries(PHONE_CAMERA_SECURITY_HEADERS)) {
      expect(response.headers.get(header)).toBe(value);
    }
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "base-uri 'none'",
    );
  });

  it("rejects a certificate download that omits its ticket", async () => {
    const baseUrl = await startTestSetupServer();
    const response = await fetch(
      `${baseUrl}/phone-camera-ca.cer?session=invalid&token=invalid`,
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "base-uri 'none'",
    );
  });

  it("issues only three setup tickets and enforces one-time session-scoped CA downloads", async () => {
    const sessionA = {
      sessionId: `session-a-${Date.now()}`,
      pairingToken: "a".repeat(43),
      pairingExpiresAtMs: Date.now() + 60_000,
    };
    const sessionB = {
      sessionId: `session-b-${Date.now()}`,
      pairingToken: "b".repeat(43),
      pairingExpiresAtMs: Date.now() + 60_000,
    };
    let currentSession = sessionA;
    configurePhoneCameraBridgeSession({
      getSession: () => currentSession,
      caFingerprintForTests: "AA:BB:CC",
      onConnect: () => false,
      onFrame: () => false,
    });
    const baseUrl = await startTestSetupServer();
    const setupUrl = (session: typeof sessionA) =>
      `${baseUrl}/phone-camera-setup?session=${session.sessionId}&token=${session.pairingToken}`;

    const firstSetup = await fetch(setupUrl(sessionA));
    const firstHtml = await firstSetup.text();
    const firstTicket = new URL(
      firstHtml.match(/phone-camera-ca\.cer[^"<]+/)?.[0] ?? "",
      baseUrl,
    ).searchParams.get("ticket");
    expect(firstSetup.status).toBe(200);
    expect(firstSetup.headers.get("cache-control")).toBe("no-store");
    expect(firstTicket).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const mismatchedSession = await fetch(
      `${baseUrl}/phone-camera-ca.cer?session=${sessionB.sessionId}&token=${sessionB.pairingToken}&ticket=${firstTicket}`,
    );
    expect(mismatchedSession.status).toBe(410);

    const remainingSetups = await Promise.all([
      fetch(setupUrl(sessionA)),
      fetch(setupUrl(sessionA)),
      fetch(setupUrl(sessionA)),
    ]);
    expect(remainingSetups.filter((response) => response.status === 200)).toHaveLength(2);
    expect(remainingSetups.filter((response) => response.status === 410)).toHaveLength(1);

    currentSession = sessionB;
    const sessionBSetup = await fetch(setupUrl(sessionB));
    expect(sessionBSetup.status).toBe(200);
  });

  it("rejects CA tickets when the pairing session has expired", async () => {
    const session = {
      sessionId: `expired-setup-${Date.now()}`,
      pairingToken: "c".repeat(43),
      pairingExpiresAtMs: Date.now() - 1,
    };
    configurePhoneCameraBridgeSession({
      getSession: () => session,
      caFingerprintForTests: "AA:BB:CC",
      onConnect: () => false,
      onFrame: () => false,
    });
    const baseUrl = await startTestSetupServer();
    const response = await fetch(
      `${baseUrl}/phone-camera-setup?session=${session.sessionId}&token=${session.pairingToken}`,
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("renders permanent re-pair guidance for expired bridge sessions", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/phone-camera`);
    const page = await response.text();

    expect(response.status).toBe(410);
    expect(page).toContain("配对链接已失效");
    expect(page).toContain("重新选择手机摄像头并扫码连接");
  });

  it("serves an inactive page for an invalid pairing link", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/phone-camera`);
    const page = await response.text();

    expect(response.status).toBe(410);
    expect(page).toContain("配对链接已失效");
    expect(page).not.toContain("navigator.mediaDevices.getUserMedia");
    expect(page).not.toContain("/phone-camera/connect");
    expect(page).not.toContain("/phone-camera/frame");
  });

  it("applies no-store and anti-embedding headers to invalid pairing pages", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/phone-camera`);

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(PHONE_CAMERA_SECURITY_HEADERS).toMatchObject({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
  });

  it("does not expose permissive CORS on bridge endpoints", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/phone-camera/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.test",
      },
      body: JSON.stringify({ sessionId: "invalid", pairingToken: "invalid" }),
    });

    expect(response.status).toBe(410);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("returns protected 404 responses for removed WebRTC signaling routes", async () => {
    const baseUrl = await startTestServer();
    const requests = Array.from({ length: 50 }, (_, index) =>
      fetch(`${baseUrl}/api/webrtc-${index % 2 === 0 ? "offer" : "ice"}`, {
        method: index % 3 === 0 ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        body:
          index % 3 === 0
            ? undefined
            : JSON.stringify({ candidate: `candidate-${index}` }),
      }),
    );

    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 404)).toBe(true);
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  });
});
