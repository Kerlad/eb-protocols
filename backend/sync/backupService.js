const fs = require("fs");
const path = require("path");

const KEEP_BACKUPS = 30;

function timestamp() {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function createLocalBackup(options) {
	const dbPath = options.dbPath;
	const backupsDir = options.backupsDir;
	const reason = options.reason || "manual";

	if (!fs.existsSync(dbPath)) {
		throw new Error(`База данных не найдена: ${dbPath}`);
	}

	ensureDir(backupsDir);

	const fileName = `eb_protocols_${reason}_${timestamp()}.db`;
	const backupPath = path.join(backupsDir, fileName);

	// T2.9: снимок через SQLite (согласованное состояние, шифрование сохраняется).
	// Если база не открывается (повреждена, перед восстановлением) — копия файла как есть.
	let method = "snapshot";
	try {
		const { snapshotDbFile } = require("../db/connection");
		snapshotDbFile(dbPath, backupPath);
	} catch (error) {
		method = "copy";
		fs.copyFileSync(dbPath, backupPath);
	}

	pruneBackups(backupsDir, KEEP_BACKUPS);

	return {
		method,
		path: backupPath,
		fileName,
		reason,
		createdAt: new Date().toISOString()
	};
}

function listLocalBackups(backupsDir) {
	if (!fs.existsSync(backupsDir)) return [];

	return fs.readdirSync(backupsDir)
		.filter((name) => name.endsWith(".db"))
		.map((name) => {
			const fullPath = path.join(backupsDir, name);
			const stat = fs.statSync(fullPath);
			return {
				fileName: name,
				path: fullPath,
				size: stat.size,
				createdAt: stat.mtime.toISOString()
			};
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneBackups(backupsDir, keep = KEEP_BACKUPS) {
	const backups = listLocalBackups(backupsDir);
	const toDelete = backups.slice(keep);

	for (const backup of toDelete) {
		try {
			fs.unlinkSync(backup.path);
		} catch (error) {
			// ignore
		}
	}

	return toDelete.length;
}

module.exports = {
	createLocalBackup,
	listLocalBackups,
	pruneBackups
};
