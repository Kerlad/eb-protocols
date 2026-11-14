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

const KEY_HEX_RE = /^[0-9a-f]{64}$/i;

// Ключ задаётся через pragma: опция конструктора { key } в этой сборке игнорируется
function applyDbKey(db, key) {
	if (!KEY_HEX_RE.test(String(key))) {
		throw new Error("Некорректный ключ шифрования базы");
	}
	db.pragma("cipher='sqlcipher'");
	db.pragma(`key="x'${key}'"`);
}

function verifyDbReadable(db) {
	db.prepare("SELECT count(*) FROM sqlite_master").get();
}

function openDbWithKey(key) {
	ensureDataDir();
	migrateFromLegacy();

	const db = new Database(DB_PATH);
	if (key) {
		try {
			applyDbKey(db, key);
			verifyDbReadable(db);
		} catch (error) {
			try { db.close(); } catch (e) {}
			throw new Error("Не удалось открыть базу: неверный пароль или база повреждена");
		}
	}
	db.pragma("foreign_keys = ON");

	db.function("lower", (str) => {
		return typeof str === "string" ? str.toLowerCase() : str;
	});

	return db;
}

function openDb() {
	return openDbWithKey(runtimeDbKey);
}

function getRuntimeDbKey() {
	return runtimeDbKey;
}

// Меняет ключ базы: текущий ключ (runtimeDbKey) -> newKey; newKey = null снимает шифрование.
// runtimeDbKey сама не меняет — это делает вызывающий после успеха.
function rekeyDb(newKey) {
	if (newKey && !KEY_HEX_RE.test(String(newKey))) {
		throw new Error("Некорректный ключ шифрования базы");
	}
	const db = openDb();
	try {
		if (newKey) {
			db.pragma("cipher='sqlcipher'");
			db.pragma(`rekey="x'${newKey}'"`);
		} else {
			db.pragma("rekey=''");
		}
	} finally {
		db.close();
	}
	// Проверка: база открывается новым ключом
	const check = openDbWithKey(newKey || null);
	try {
		verifyDbReadable(check);
	} finally {
		check.close();
	}
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
	getRuntimeDbKey,
	rekeyDb,
	touchDbOpened,
	touchDbModified
};
