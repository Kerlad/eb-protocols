const path = require("path");
const { app } = require("electron");

function getUserDataDir() {
	if (app && app.getPath) {
		return app.getPath("userData");
	}

	return path.join(process.cwd(), "data");
}

function getDataDir() {
	return process.env.PORTABLE_EXECUTABLE_DIR || process.cwd();
}

function getDbPath() {
	return path.join(getDataDir(), "eb_protocols.db");
}

function getBackupsDir() {
	return path.join(getDataDir(), "backups");
}

function getProtocolsDir() {
	return path.join(getDataDir(), "protocols");
}

function getTemplatePath() {
	if (process.resourcesPath) {
		return path.join(process.resourcesPath, "templates", "Протокол.docx");
	}

	return path.join(process.cwd(), "templates", "Протокол.docx");
}

module.exports = {
	getUserDataDir,
	getDataDir,
	getDbPath,
	getBackupsDir,
	getProtocolsDir,
	getTemplatePath
};
