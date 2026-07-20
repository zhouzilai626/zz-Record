import { ArrowClockwise, CheckCircle, DownloadSimple, Spinner, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	createEditorUpdateCardModel,
	formatUpdateProgress,
	type EditorUpdateStatus,
} from "./updateCardState";

type EditorUpdateCardProps = {
	isRecording: boolean;
};

type UpdatePayload = UpdateToastState;

const INITIAL_SUMMARY: UpdateStatusSummary = {
	status: "idle",
	currentVersion: "",
	availableVersion: null,
};

function getStatusIcon(status: EditorUpdateStatus) {
	switch (status) {
		case "checking":
		case "downloading":
			return <Spinner className="h-5 w-5 animate-spin" aria-hidden="true" />;
		case "up-to-date":
		case "ready":
			return <CheckCircle className="h-5 w-5" aria-hidden="true" />;
		case "error":
			return <WarningCircle className="h-5 w-5" aria-hidden="true" />;
		default:
			return <ArrowClockwise className="h-5 w-5" aria-hidden="true" />;
	}
}

export function EditorUpdateCard({ isRecording }: EditorUpdateCardProps) {
	const [summary, setSummary] = useState<UpdateStatusSummary>(INITIAL_SUMMARY);
	const [payload, setPayload] = useState<UpdatePayload | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [actionInProgress, setActionInProgress] = useState(false);

	const refreshSummary = useCallback(async () => {
		const nextSummary = await window.electronAPI.getUpdateStatusSummary();
		setSummary(nextSummary);
	}, []);

	useEffect(() => {
		let active = true;
		void refreshSummary().catch(() => {
			if (active) {
				setActionError("无法读取更新状态，请稍后重试。");
			}
		});

		const dispose = window.electronAPI.onUpdateToastStateChanged((nextPayload) => {
			if (!active) return;
			setPayload(nextPayload);
			void refreshSummary().catch(() => undefined);
		});

		return () => {
			active = false;
			dispose();
		};
	}, [refreshSummary]);

	const model = createEditorUpdateCardModel(summary);
	const progress = formatUpdateProgress(payload?.progressPercent);
	const isBusy = actionInProgress || summary.status === "checking" || summary.status === "downloading";
	const detail = actionError || model.detail;
	const isDevelopmentBuild = import.meta.env.DEV;

	const handleAction = async () => {
		if (!model.primaryAction || isBusy) return;
		setActionError(null);
		setActionInProgress(true);
		try {
			if (model.primaryAction === "check") {
				await window.electronAPI.checkForAppUpdates();
			} else if (model.primaryAction === "download") {
				const result = await window.electronAPI.downloadAvailableUpdate(false);
				if (!result.success) throw new Error(result.message || "更新下载未能开始。");
			} else {
				if (isRecording) {
					setActionError("当前正在录制，请先结束录制，再安装更新。");
					return;
				}
				const result = await window.electronAPI.installDownloadedUpdate();
				if (!result.success) throw new Error(result.message || "无法安装更新。");
			}
			await refreshSummary();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "更新操作失败，请稍后重试。");
		} finally {
			setActionInProgress(false);
		}
	};

	return (
		<section
			aria-label="应用更新"
			className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-3"
		>
			<div className="flex items-start gap-3">
				<div
					className={cn(
						"flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
						summary.status === "error"
							? "border-red-500/25 bg-red-500/10 text-red-500"
							: "border-[#2563EB]/20 bg-[#2563EB]/10 text-[#2563EB]",
					)}
				>
					{getStatusIcon(summary.status)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
						<h3 className="text-sm font-semibold text-foreground">ZZ Record v{summary.currentVersion || "…"}</h3>
						{isDevelopmentBuild ? (
							<span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
								开发版
							</span>
						) : null}
					</div>
					<p className="mt-0.5 text-[11px] font-medium text-foreground">{model.title}</p>
					<p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{detail}</p>
					{isDevelopmentBuild ? (
						<p className="mt-1 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
							开发版不会检查或安装正式更新；请在发布版中使用此功能。
						</p>
					) : null}
				</div>
			</div>

			{model.showProgress ? (
				<div className="mt-3">
					<div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
						<span>下载进度</span>
						<span className="font-medium text-foreground">{progress}%</span>
					</div>
					<div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
						<div
							className="h-full rounded-full bg-[#2563EB] transition-[width] duration-300"
							style={{ width: `${progress}%` }}
						/>
					</div>
				</div>
			) : null}

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant={model.primaryAction === "install" ? "default" : "outline"}
					onClick={() => void handleAction()}
					disabled={!model.primaryAction || isBusy || isDevelopmentBuild}
					className="h-8 gap-1.5 border-foreground/10 bg-foreground/5 px-3 text-[11px] text-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-60"
				>
					{model.primaryAction === "download" ? <DownloadSimple className="h-3.5 w-3.5" /> : null}
					{isBusy ? "处理中…" : (model.primaryLabel ?? "处理中…")}
				</Button>
				{summary.status === "ready" && isRecording ? (
					<span className="text-[10px] text-amber-700 dark:text-amber-300">
						录制结束后可安装
					</span>
				) : null}
			</div>
		</section>
	);
}
