const path = require("path");
const fs = require("fs");

function getUserDataDir() {
	if (typeof process !== "undefined" && process.env.PORTABLE_EXECUTABLE_DIR) {
		return process.env.PORTABLE_EXECUTABLE_DIR;
	}
	if (typeof process !== "undefined" && process.env.EB_DATA_DIR) {
		return process.env.EB_DATA_DIR;
	}
	return path.join(process.cwd(), "data");
}

function getLegacyDataDir() {
	return process.env.PORTABLE_EXECUTABLE_DIR || process.cwd();
}

function getDataDir() {
	return getUserDataDir();
}

function getDbPath() {
	return path.join(getUserDataDir(), "eb_protocols.db");
}

function getBackupsDir() {
	return path.join(getUserDataDir(), "backups");
}

function getProtocolsDir() {
	return path.join(getUserDataDir(), "protocols");
}

function getTemplatePath() {
	if (typeof process !== "undefined" && process.resourcesPath) {
		return path.join(process.resourcesPath, "templates", "Протокол.docx");
	}
	return path.join(process.cwd(), "templates", "Протокол.docx");
}

function ensureDataDir() {
	const dir = getUserDataDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function migrateFromLegacy() {
	const legacyDb = path.join(getLegacyDataDir(), "eb_protocols.db");
	const currentDb = getDbPath();

	if (legacyDb !== currentDb && fs.existsSync(legacyDb) && !fs.existsSync(currentDb)) {
		ensureDataDir();
		const backupDir = getBackupsDir();
		if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
		const backupPath = path.join(backupDir, `eb_protocols_migration_${Date.now()}.db`);
		fs.copyFileSync(legacyDb, backupPath);
		fs.copyFileSync(legacyDb, currentDb);
		console.log(`[migration] Скопирована БД из ${legacyDb} → ${currentDb} (бэкап: ${backupPath})`);
		return true;
	}
	return false;
}

module.exports = {
	getUserDataDir,
	getLegacyDataDir,
	getDataDir,
	getDbPath,
	getBackupsDir,
	getProtocolsDir,
	getTemplatePath,
	ensureDataDir,
	migrateFromLegacy
};
