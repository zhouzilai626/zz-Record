export type CorsVideoSourceTarget = {
	crossOrigin: string | null;
	src: string;
	load: () => void;
};

export function loadCorsVideoSource(target: CorsVideoSourceTarget, sourceUrl: string): void {
	target.crossOrigin = "anonymous";
	target.src = sourceUrl;
	target.load();
}
