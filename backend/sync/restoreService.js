const fs = require("fs");
const path = require("path");
const { createLocalBackup } = require("./backupService");
const { verifyDbFile, closeDb } = require("../db/connection");

function restoreFromBackup(options) {
	const backupPath = options.backupPath;
	const dbPath = options.dbPath;
	const backupsDir = options.backupsDir;

	if (!fs.existsSync(backupPath)) {
		throw new Error(`Резервная копия не найдена: ${backupPath}`);
	}

	// T2.9: битую копию не ставим на место рабочей базы
	verifyDbFile(backupPath);

	if (fs.existsSync(dbPath)) {
		createLocalBackup({
			dbPath,
			backupsDir,
			reason: "before_restore"
		});
	}

	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	const tmpPath = dbPath + ".restoring";
	try {
		fs.copyFileSync(backupPath, tmpPath);
		closeDb();
		fs.renameSync(tmpPath, dbPath);
	} catch (error) {
		try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
		throw error;
	}
	require("../db/initDb").initDb();

	return {
		restoredFrom: backupPath,
		dbPath,
		restoredAt: new Date().toISOString()
	};
}

module.exports = {
	restoreFromBackup
};
