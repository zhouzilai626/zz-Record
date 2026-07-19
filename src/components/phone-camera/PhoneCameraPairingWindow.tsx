import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import type { PhoneCameraState } from "@/lib/phoneCamera";

export function getPhoneCameraPairingStatusTone(
  state: PhoneCameraState | null,
): {
  label: string;
  color: string;
} {
  switch (state?.status) {
    case "connected":
      return { label: "已连接", color: "#2f9e44" };
    case "error":
      return { label: "需要处理", color: "#d9480f" };
    case "pending":
      return { label: "等待手机连接", color: "#1c7ed6" };
    case "stopped":
      return { label: "已停止", color: "#868e96" };
    default:
      return { label: "正在准备", color: "#868e96" };
  }
}

export function PhoneCameraPairingWindow() {
  const [phoneCameraState, setPhoneCameraState] =
    useState<PhoneCameraState | null>(null);

  useEffect(() => {
    let mounted = true;

    void window.electronAPI.getPhoneCameraState().then((state) => {
      if (mounted) {
        setPhoneCameraState(state);
      }
    });

    const cleanup = window.electronAPI.onPhoneCameraStateChanged((state) => {
      if (mounted) {
        setPhoneCameraState(state);
      }
    });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, []);

  const tone = useMemo(
    () => getPhoneCameraPairingStatusTone(phoneCameraState),
    [phoneCameraState],
  );
  const pairingUrl = phoneCameraState?.pairingUrl;

  return (
    <div className="min-h-screen bg-[#07111f] px-5 py-6 text-white">
      <main className="mx-auto flex min-h-[calc(100vh-48px)] max-w-[480px] items-center">
        <section className="w-full rounded-2xl border border-white/10 bg-[#0d1b2a] p-5 shadow-2xl shadow-black/35">
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-white/55">手机摄像头</p>
              <h1 className="mt-1 text-2xl font-semibold">连接到 ZZ Record</h1>
            </div>
            <div
              className="shrink-0 rounded-full border px-3 py-1 text-xs font-medium"
              style={{
                borderColor: `${tone.color}66`,
                color: tone.color,
                background: `${tone.color}14`,
              }}
            >
              {tone.label}
            </div>
          </header>

          <div className="mt-5 flex justify-center rounded-xl bg-white p-4 text-[#0c1624]">
            {pairingUrl ? (
              <QRCodeSVG
                value={pairingUrl}
                size={208}
                bgColor="#ffffff"
                fgColor="#0c1624"
                includeMargin={true}
              />
            ) : (
              <div className="flex h-[208px] w-[208px] items-center justify-center px-5 text-center text-sm text-slate-500">
                正在创建配对会话...
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2 rounded-lg bg-black/20 px-3 py-3 text-sm leading-6 text-white/75">
            <p>1. 用手机扫描二维码，首次使用先下载并安装本机 CA 证书。</p>
            <p>2. 核对手机端与下方显示的 CA 指纹完全一致，再在系统设置中信任证书。</p>
            <p>3. 返回安全摄像头页并允许摄像头权限；已安装证书的手机会直接进入该页面。</p>
          </div>
          {phoneCameraState?.caFingerprint ? (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-center">
              <p className="text-xs text-white/60">CA SHA-256 指纹</p>
              <p className="mt-1 break-all font-mono text-xs leading-5 text-white/90">
                {phoneCameraState.caFingerprint}
              </p>
            </div>
          ) : null}
          <p className="mt-3 rounded-lg bg-black/20 px-3 py-2 text-center text-xs leading-5 text-white/60">
            {phoneCameraState?.message || "正在等待手机摄像头状态..."}
          </p>
        </section>
      </main>
    </div>
  );
}
