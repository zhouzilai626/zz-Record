export type EditorUpdateStatus = UpdateStatusSummary["status"];

export type EditorUpdateCardModel = {
	title: string;
	detail: string;
	primaryAction: "check" | "download" | "install" | null;
	primaryLabel: string | null;
	showProgress: boolean;
};

export function createEditorUpdateCardModel(summary: UpdateStatusSummary): EditorUpdateCardModel {
	const availableVersion = summary.availableVersion;
	const versionLabel = availableVersion ? `ZZ Record v${availableVersion}` : "ZZ Record";

	switch (summary.status) {
		case "checking":
			return {
				title: "正在检查更新",
				detail: "正在连接官方更新服务，请稍候。",
				primaryAction: null,
				primaryLabel: null,
				showProgress: false,
			};
		case "up-to-date":
			return {
				title: "当前已是最新版本",
				detail: summary.detail || `ZZ Record v${summary.currentVersion} 已是最新版本。`,
				primaryAction: "check",
				primaryLabel: "再次检查",
				showProgress: false,
			};
		case "available":
			return {
				title: `${versionLabel} 可更新`,
				detail: summary.detail || "发现新版本。下载完成后可自行选择安装时间。",
				primaryAction: "download",
				primaryLabel: "下载更新",
				showProgress: false,
			};
		case "downloading":
			return {
				title: `正在下载 ${versionLabel}`,
				detail: summary.detail || "更新正在后台下载，完成前可继续使用应用。",
				primaryAction: null,
				primaryLabel: null,
				showProgress: true,
			};
		case "ready":
			return {
				title: `${versionLabel} 已准备好`,
				detail: summary.detail || "更新已下载完成。安装时应用会重新启动。",
				primaryAction: "install",
				primaryLabel: "安装并重启",
				showProgress: false,
			};
		case "error":
			return {
				title: "检查或下载更新失败",
				detail: summary.detail || "当前版本仍可正常使用，请检查网络后重试。",
				primaryAction: "check",
				primaryLabel: "重试检查",
				showProgress: false,
			};
		case "idle":
		default:
			return {
				title: "官方更新服务",
				detail: summary.detail || "可手动检查是否有新版本。",
				primaryAction: "check",
				primaryLabel: "检查更新",
				showProgress: false,
			};
	}
}

export function formatUpdateProgress(progressPercent: number | undefined): number {
	return Math.max(0, Math.min(100, Math.round(progressPercent ?? 0)));
}
