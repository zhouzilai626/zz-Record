type BodyRequest = AsyncIterable<Buffer | string> & {
	headers?: { "content-length"?: string | string[] | undefined };
};

export class RequestBodyTooLargeError extends Error {
	constructor(readonly maxBytes: number) {
		super(`Request body exceeds the ${maxBytes}-byte limit.`);
		this.name = "RequestBodyTooLargeError";
	}
}

function getDeclaredContentLength(request: BodyRequest): number | null {
	const header = request.headers?.["content-length"];
	const value = Array.isArray(header) ? header[0] : header;
	if (!value) {
		return null;
	}

	const contentLength = Number(value);
	return Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : null;
}

export async function readJsonBody(request: BodyRequest, maxBytes: number): Promise<unknown> {
	const declaredContentLength = getDeclaredContentLength(request);
	if (declaredContentLength !== null && declaredContentLength > maxBytes) {
		throw new RequestBodyTooLargeError(maxBytes);
	}

	const chunks: Buffer[] = [];
	let byteLength = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		byteLength += buffer.length;
		if (byteLength > maxBytes) {
			throw new RequestBodyTooLargeError(maxBytes);
		}
		chunks.push(buffer);
	}

	if (chunks.length === 0) {
		return null;
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
