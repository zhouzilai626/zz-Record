import path from "node:path";
import { app } from "electron";

const useProductionUserData = process.env["RECORDLY_USE_PRODUCTION_USER_DATA"] === "1";

if (process.env["VITE_DEV_SERVER_URL"] && !useProductionUserData) {
	const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
	app.setPath("userData", devUserDataPath);
	app.setPath("sessionData", path.join(devUserDataPath, "session"));
}

export const USER_DATA_PATH = app.getPath("userData");
export const RECORDINGS_DIR = path.join(USER_DATA_PATH, "recordings");
