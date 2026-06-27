const fs = require("fs");
const path = require("path");
const { createLocalBackup } = require("./backupService");

function restoreFromBackup(options) {
	const backupPath = options.backupPath;
	const dbPath = options.dbPath;
	const backupsDir = options.backupsDir;

	if (!fs.existsSync(backupPath)) {
		throw new Error(`Резервная копия не найдена: ${backupPath}`);
	}

	if (fs.existsSync(dbPath)) {
		createLocalBackup({
			dbPath,
			backupsDir,
			reason: "before_restore"
		});
	}

	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	fs.copyFileSync(backupPath, dbPath);

	return {
		restoredFrom: backupPath,
		dbPath,
		restoredAt: new Date().toISOString()
	};
}

module.exports = {
	restoreFromBackup
};
