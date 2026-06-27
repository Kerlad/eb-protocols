const fs = require("fs");
const os = require("os");
const path = require("path");
const ftpClient = require("./ftpClient");
const { compareDbState } = require("./conflictDetector");
const { createLocalBackup } = require("./backupService");
const syncRepository = require("../db/repositories/syncRepository");

const REMOTE_DB_NAME = "eb_protocols.db";
const REMOTE_META_NAME = "eb_protocols.meta.json";

function deviceInfo() {
	return {
		device: os.hostname(),
		user: os.userInfo().username
	};
}

function buildLocalMeta(db) {
	const state = syncRepository.getSyncState(db) || {};
	const stats = syncRepository.getLocalDbStats(db);
	const info = deviceInfo();

	return {
		syncRevision: state.sync_revision || 0,
		lastModifiedAt: state.last_modified_at || null,
		lastSyncedAt: state.last_synced_at || null,
		dbVersion: state.db_version || "0.1.0",
		journalCountTotal: stats.journal_count_total,
		journalCountCurrentYear: stats.journal_count_current_year,
		maxProtocolNumberCurrentYear: stats.max_protocol_number_current_year,
		maxProtocolNumbersByYear: stats.max_protocol_numbers_by_year,
		device: info.device,
		user: info.user,
		generatedAt: new Date().toISOString()
	};
}

async function fetchRemoteMeta(config, tempDir) {
	const exists = await ftpClient.fileExists(config, REMOTE_META_NAME);
	if (!exists) return null;

	const tempPath = path.join(tempDir, `remote_${Date.now()}.meta.json`);
	await ftpClient.downloadFile(config, REMOTE_META_NAME, tempPath);

	try {
		const raw = fs.readFileSync(tempPath, "utf8");
		return JSON.parse(raw);
	} catch (error) {
		return null;
	} finally {
		try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
	}
}

async function getStatus(options) {
	const { db, config, tempDir } = options;
	const localMeta = buildLocalMeta(db);
	const remoteMeta = await fetchRemoteMeta(config, tempDir || os.tmpdir());
	const comparison = compareDbState(localMeta, remoteMeta);

	return { localMeta, remoteMeta, comparison };
}

async function uploadDb(options) {
	const { db, config, dbPath, tempDir } = options;
	const localMeta = buildLocalMeta(db);
	const metaPath = path.join(tempDir || os.tmpdir(), `local_${Date.now()}.meta.json`);

	fs.writeFileSync(metaPath, JSON.stringify(localMeta, null, 2), "utf8");

	try {
		await ftpClient.uploadFile(config, dbPath, REMOTE_DB_NAME);
		await ftpClient.uploadFile(config, metaPath, REMOTE_META_NAME);
	} finally {
		try { fs.unlinkSync(metaPath); } catch (e) { /* ignore */ }
	}

	const info = deviceInfo();
	syncRepository.updateSyncState(db, {
		last_synced_at: new Date().toISOString(),
		last_sync_direction: "upload",
		last_sync_user: info.user,
		last_sync_device: info.device,
		sync_status: "uploaded",
		sync_error: null
	});

	return { ok: true, direction: "upload", meta: localMeta };
}

async function downloadDb(options) {
	const { db, config, dbPath, backupsDir } = options;

	if (fs.existsSync(dbPath)) {
		createLocalBackup({ dbPath, backupsDir, reason: "before_download" });
	}

	const exists = await ftpClient.fileExists(config, REMOTE_DB_NAME);
	if (!exists) {
		throw new Error("На сервере нет файла базы данных");
	}

	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	await ftpClient.downloadFile(config, REMOTE_DB_NAME, dbPath);

	const { openDb } = require("../db/connection");
	const freshDb = openDb();
	try {
		const info = deviceInfo();
		syncRepository.updateSyncState(freshDb, {
			last_synced_at: new Date().toISOString(),
			last_sync_direction: "download",
			last_sync_user: info.user,
			last_sync_device: info.device,
			sync_status: "downloaded",
			sync_error: null
		});
	} finally {
		freshDb.close();
	}

	return { ok: true, direction: "download" };
}

module.exports = {
	REMOTE_DB_NAME,
	REMOTE_META_NAME,
	buildLocalMeta,
	fetchRemoteMeta,
	getStatus,
	uploadDb,
	downloadDb
};
