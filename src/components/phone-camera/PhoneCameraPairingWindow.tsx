import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PhoneCameraState } from "@/lib/phoneCamera";

function maskPairingCode(code?: string): string {
	if (!code) {
		return "------";
	}

	return code.replace(/(.{3})/g, "$1 ").trim();
}

function getStatusTone(state: PhoneCameraState | null): { label: string; color: string } {
	switch (state?.status) {
		case "connected":
			return { label: "Connected", color: "#2f9e44" };
		case "error":
			return { label: "Needs attention", color: "#d9480f" };
		case "pending":
			return { label: "Waiting for phone", color: "#1c7ed6" };
		case "stopped":
			return { label: "Stopped", color: "#868e96" };
		default:
			return { label: "Idle", color: "#868e96" };
	}
}

export function PhoneCameraPairingWindow() {
	const [phoneCameraState, setPhoneCameraState] = useState<PhoneCameraState | null>(null);
	const [copied, setCopied] = useState<"code" | "url" | null>(null);

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

	const tone = useMemo(() => getStatusTone(phoneCameraState), [phoneCameraState]);
	const pairingUrl = phoneCameraState?.pairingUrl;

	const handleCopy = useCallback(async (value: string | undefined, kind: "code" | "url") => {
		if (!value) {
			return;
		}

		try {
			await navigator.clipboard.writeText(value);
			setCopied(kind);
			window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1500);
		} catch (error) {
			console.warn("Failed to copy phone camera pairing value:", error);
		}
	}, []);

	return (
		<div
			className="min-h-screen w-full text-white"
			style={{
				background:
					"radial-gradient(circle at top, rgba(45, 110, 255, 0.24), transparent 34%), linear-gradient(160deg, #07111f 0%, #0d1b2a 48%, #081019 100%)",
			}}
		>
			<div className="mx-auto flex min-h-screen max-w-[900px] items-center justify-center px-6 py-10">
				<div className="grid w-full gap-6 lg:grid-cols-[1.15fr_0.85fr]">
					<section className="rounded-[28px] border border-white/10 bg-white/6 p-7 shadow-2xl shadow-black/40 backdrop-blur-xl">
						<div className="mb-5 flex items-center justify-between gap-4">
							<div>
								<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">Phone Camera Pairing</p>
								<h1 className="mt-2 text-3xl font-semibold tracking-tight">Connect your phone to Recordly</h1>
							</div>
							<div className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: `${tone.color}66`, color: tone.color, background: `${tone.color}14` }}>
								{tone.label}
							</div>
						</div>

						<p className="max-w-[52ch] text-sm leading-6 text-white/72">
							This window is the new source-level pairing entry for phone camera support. Real camera streaming is still in progress, but the app can now create and track a dedicated pairing session.
						</p>

						<div className="mt-7 flex flex-col items-center rounded-[24px] border border-white/10 bg-white px-6 py-7 text-[#0c1624] shadow-xl shadow-black/20">
							<div className="rounded-[24px] bg-white p-4 shadow-sm">
								{pairingUrl ? (
									<QRCodeSVG
										value={pairingUrl}
										size={224}
										bgColor="#ffffff"
										fgColor="#0c1624"
										includeMargin={true}
									/>
								) : (
									<div className="flex h-[224px] w-[224px] items-center justify-center rounded-[18px] border border-slate-200 bg-slate-100 px-6 text-center text-sm text-slate-500">
										Waiting for a pairing session...
									</div>
								)}
							</div>
							<p className="mt-4 text-center text-sm font-medium text-slate-700">
								Scan this QR code with your phone to open the local pairing page.
							</p>
						</div>

						<div className="mt-7 rounded-[24px] border border-white/10 bg-black/20 p-6">
							<div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Pairing code</div>
							<div className="mt-3 font-mono text-4xl font-semibold tracking-[0.18em] text-white">{maskPairingCode(phoneCameraState?.pairingCode)}</div>
							<div className="mt-4 flex flex-wrap gap-3">
								<button
									type="button"
									onClick={() => void handleCopy(phoneCameraState?.pairingCode, "code")}
									className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[#0c1624] transition hover:bg-white/90"
								>
									{copied === "code" ? "Copied" : "Copy code"}
								</button>
								<button
									type="button"
									onClick={() => void handleCopy(phoneCameraState?.pairingUrl, "url")}
									className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white/86 transition hover:border-white/30 hover:bg-white/8"
								>
									{copied === "url" ? "Copied" : "Copy link"}
								</button>
							</div>
						</div>

						<div className="mt-5 rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
							<div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Pairing link</div>
							<div className="mt-3 break-all rounded-2xl bg-black/25 px-4 py-3 font-mono text-sm text-white/86">
								{pairingUrl || "Waiting for session initialization..."}
							</div>
						</div>
					</section>

					<aside className="rounded-[28px] border border-white/10 bg-[#0d1725]/88 p-7 shadow-2xl shadow-black/30">
						<div className="rounded-[22px] border border-dashed border-white/14 bg-white/[0.03] p-5">
							<div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Session</div>
							<div className="mt-3 font-mono text-sm text-white/75">{phoneCameraState?.sessionId || "No active session"}</div>
							<p className="mt-4 text-sm leading-6 text-white/68">
								Open this link on your phone or enter the pairing code in the future mobile bridge. Once the bridge is implemented, this window will switch from pending to connected automatically.
							</p>
						</div>

						<ol className="mt-6 space-y-3 text-sm leading-6 text-white/72">
							<li>1. Keep this window open after choosing <span className="font-medium text-white">Phone Camera (Local)</span>.</li>
							<li>2. Use the pairing code or link on your phone when the bridge page is ready.</li>
							<li>3. After the transport layer lands, preview and recording will attach to this session.</li>
						</ol>

						<div className="mt-6 rounded-[20px] border border-white/10 bg-black/20 p-5">
							<div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Status detail</div>
							<p className="mt-3 text-sm leading-6 text-white/72">
								{phoneCameraState?.message || phoneCameraState?.error || "Waiting for phone camera state..."}
							</p>
						</div>
					</aside>
				</div>
			</div>
		</div>
	);
}
