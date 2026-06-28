const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3-multiple-ciphers");
const { getDbPath, ensureDataDir, migrateFromLegacy } = require("../paths");

const DB_PATH = getDbPath();

let runtimeDbKey = null;
let singletonDb = null;

function setRuntimeDbKey(key) {
	runtimeDbKey = key || null;
	if (singletonDb) {
		try { singletonDb.close(); } catch (e) {}
		singletonDb = null;
	}
}

function openDb() {
	ensureDataDir();
	migrateFromLegacy();

	const options = {};
	if (runtimeDbKey) {
		options.key = runtimeDbKey;
	}

	const db = new Database(DB_PATH, options);
	db.pragma("foreign_keys = ON");

	db.function("lower", (str) => {
		return typeof str === "string" ? str.toLowerCase() : str;
	});

	return db;
}

function getDb() {
	if (singletonDb) return singletonDb;
	singletonDb = openDb();
	return singletonDb;
}

function closeDb() {
	if (singletonDb) {
		try { singletonDb.close(); } catch (e) {}
		singletonDb = null;
	}
}

function touchDbOpened(db) {
	db.prepare("UPDATE sync_state SET last_opened_at = ? WHERE id = 1")
		.run(new Date().toISOString());
}

function touchDbModified(db) {
	db.prepare(`
		UPDATE sync_state
		SET last_modified_at = ?,
			sync_revision = COALESCE(sync_revision, 0) + 1
		WHERE id = 1
	`).run(new Date().toISOString());
}

module.exports = {
	DB_PATH,
	openDb,
	getDb,
	closeDb,
	setRuntimeDbKey,
	touchDbOpened,
	touchDbModified
};
