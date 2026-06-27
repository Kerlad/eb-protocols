const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3-multiple-ciphers");

const baseDir = process.env.PORTABLE_EXECUTABLE_DIR || process.cwd();
const DATA_DIR = baseDir;
const DB_PATH = path.join(DATA_DIR, "eb_protocols.db");

let runtimeDbKey = null;

function setRuntimeDbKey(key) {
	runtimeDbKey = key || null;
}

function ensureDataDir() {
	if (!fs.existsSync(DATA_DIR)) {
		fs.mkdirSync(DATA_DIR, { recursive: true });
	}
}

function openDb() {
	ensureDataDir();

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
	setRuntimeDbKey,
	touchDbOpened,
	touchDbModified
};
