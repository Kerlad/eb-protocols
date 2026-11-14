const fs = require("fs");
const os = require("os");
const path = require("path");
const ftpClient = require("./ftpClient");
const sftpClient = require("./sftpClient");
const { compareDbState } = require("./conflictDetector");
const { createLocalBackup } = require("./backupService");
const syncRepository = require("../db/repositories/syncRepository");
const { snapshotDbFile, verifyDbFile, openDbFile, closeDb } = require("../db/connection");

const REMOTE_DB_NAME = "eb_protocols.db";
const REMOTE_META_NAME = "eb_protocols.meta.json";
const REMOTE_DB_TEMP_NAME = REMOTE_DB_NAME + ".uploading";

function getTransport(config) {
	return config && config.transport === "sftp" ? sftpClient : ftpClient;
}

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
		dbUid: state.db_uid || null,
		changeId: state.change_id || null,
		baseChangeId: state.base_change_id || null,
		device: info.device,
		user: info.user,
		generatedAt: new Date().toISOString()
	};
}

async function fetchRemoteMeta(config, tempDir) {
	const transport = getTransport(config);
	const exists = await transport.fileExists(config, REMOTE_META_NAME);
	if (!exists) return null;

	const tempPath = path.join(tempDir, `remote_${Date.now()}.meta.json`);
	await transport.downloadFile(config, REMOTE_META_NAME, tempPath);

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
	const { db, config, dbPath, tempDir, force } = options;

	// T2.8: не затирать чужие изменения на сервере без явного подтверждения
	if (!force) {
		const { remoteMeta, comparison } = await getStatus({ db, config, tempDir });
		if (comparison.status === "remote_newer" || comparison.status === "conflict") {
			const error = new Error(comparison.details);
			error.code = "SYNC_CONFLICT";
			error.status = comparison.status;
			error.remoteDevice = remoteMeta && remoteMeta.device || null;
			error.remoteModifiedAt = remoteMeta && (remoteMeta.lastModifiedAt || remoteMeta.generatedAt) || null;
			throw error;
		}
	}

	const localMeta = buildLocalMeta(db);
	const workDir = tempDir || os.tmpdir();
	const stamp = Date.now();
	const metaPath = path.join(workDir, `local_${stamp}.meta.json`);
	const snapshotPath = path.join(workDir, `upload_${stamp}.db`);
	const transport = getTransport(config);

	fs.writeFileSync(metaPath, JSON.stringify(localMeta, null, 2), "utf8");

	try {
		// T2.9: выгружается согласованный снимок под временным именем, затем переименование —
		// второй компьютер не скачает недописанный файл
		snapshotDbFile(dbPath, snapshotPath);
		await transport.uploadFile(config, snapshotPath, REMOTE_DB_TEMP_NAME);
		await transport.replaceFile(config, REMOTE_DB_TEMP_NAME, REMOTE_DB_NAME);
		await transport.uploadFile(config, metaPath, REMOTE_META_NAME);
	} finally {
		try { fs.unlinkSync(metaPath); } catch (e) { /* ignore */ }
		try { fs.unlinkSync(snapshotPath); } catch (e) { /* ignore */ }
	}

	const info = deviceInfo();
	syncRepository.updateSyncState(db, {
		last_synced_at: new Date().toISOString(),
		last_sync_direction: "upload",
		last_sync_user: info.user,
		last_sync_device: info.device,
		sync_status: "uploaded",
		sync_error: null,
		base_change_id: localMeta.changeId
	});

	return { ok: true, direction: "upload", meta: localMeta, transport: transport === sftpClient ? "SFTP" : "FTP" };
}

async function downloadDb(options) {
	const { config, dbPath, backupsDir } = options;
	const transport = getTransport(config);

	const exists = await transport.fileExists(config, REMOTE_DB_NAME);
	if (!exists) {
		throw new Error("На сервере нет файла базы данных");
	}

	// T2.9: качаем во временный файл; рабочая база меняется только после проверки
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	const tmpPath = dbPath + ".download";
	try {
		try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
		await transport.downloadFile(config, REMOTE_DB_NAME, tmpPath);
		try {
			verifyDbFile(tmpPath);
		} catch (error) {
			throw new Error(`Скачанная база не прошла проверку, рабочая база не изменена. ${error.message}`);
		}

		if (fs.existsSync(dbPath)) {
			createLocalBackup({ dbPath, backupsDir, reason: "before_download" });
		}
		closeDb();
		fs.renameSync(tmpPath, dbPath);
	} catch (error) {
		try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
		throw error;
	}

	// миграции схемы для базы, выгруженной старой версией
	require("../db/initDb").initDb();

	const freshDb = openDbFile(dbPath);
	try {
		const info = deviceInfo();
		syncRepository.updateSyncState(freshDb, {
			last_synced_at: new Date().toISOString(),
			last_sync_direction: "download",
			last_sync_user: info.user,
			last_sync_device: info.device,
			sync_status: "downloaded",
			sync_error: null,
			base_change_id: (syncRepository.getSyncState(freshDb) || {}).change_id || null
		});
	} finally {
		freshDb.close();
	}

	return { ok: true, direction: "download" };
}

module.exports = {
	REMOTE_DB_NAME,
	REMOTE_META_NAME,
	REMOTE_DB_TEMP_NAME,
	buildLocalMeta,
	fetchRemoteMeta,
	getTransport,
	getStatus,
	uploadDb,
	downloadDb
};
