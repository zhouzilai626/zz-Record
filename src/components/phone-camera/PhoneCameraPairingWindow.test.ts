import { describe, expect, it } from "vitest";
import type { PhoneCameraState } from "@/lib/phoneCamera";
import { getPhoneCameraPairingStatusTone } from "./PhoneCameraPairingWindow";

function state(status: PhoneCameraState["status"]): PhoneCameraState {
  return {
    active: status !== "inactive",
    connected: status === "connected",
    status,
    startedAtMs: null,
    lastFrameAtMs: null,
    deviceId: "phone-camera",
    message: "test",
  };
}

describe("PhoneCameraPairingWindow status guidance", () => {
  it.each([
    ["connected", "已连接"],
    ["pending", "等待手机连接"],
    ["error", "需要处理"],
    ["stopped", "已停止"],
  ] as const)("shows %s pairing state as %s", (status, label) => {
    expect(getPhoneCameraPairingStatusTone(state(status)).label).toBe(label);
  });

  it("shows preparation guidance while the pairing URL is unavailable", () => {
    expect(getPhoneCameraPairingStatusTone(null)).toEqual({
      label: "正在准备",
      color: "#868e96",
    });
  });

  it("surfaces an actionable status for expired or failed pairing sessions", () => {
    const expired = state("error");
    expired.message = "配对链接已失效，请重新扫码连接。";

    expect(getPhoneCameraPairingStatusTone(expired)).toMatchObject({
      label: "需要处理",
      color: "#d9480f",
    });
  });
});
