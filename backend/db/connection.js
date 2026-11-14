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

// Открывает произвольный файл базы (скачанный, резервную копию) текущим ключом сеанса
function openDbFile(filePath, key = runtimeDbKey) {
	const db = new Database(filePath, { fileMustExist: true });
	try {
		if (key) applyDbKey(db, key);
		verifyDbReadable(db);
	} catch (error) {
		try { db.close(); } catch (e) {}
		throw new Error(key
			? "Файл базы не открывается текущим паролем базы или повреждён"
			: "Файл не является базой данных программы или повреждён");
	}
	return db;
}

// T2.9: целостность и наличие основных таблиц — до того, как файл заменит рабочую базу
function verifyDbFile(filePath, key = runtimeDbKey) {
	const db = openDbFile(filePath, key);
	try {
		const result = db.pragma("integrity_check", { simple: true });
		if (result !== "ok") {
			throw new Error(`База повреждена: ${result}`);
		}
		const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'protocol_journal'").get();
		if (!table) {
			throw new Error("В файле нет таблиц программы (protocol_journal)");
		}
	} finally {
		db.close();
	}
}

// T2.9: согласованный снимок базы. VACUUM INTO, а не db.backup(): backup() на зашифрованной
// базе падает («incompatible source and target»), а VACUUM INTO сохраняет шифрование тем же ключом.
function snapshotDbFile(srcPath, destPath, key = runtimeDbKey) {
	if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
	const db = openDbFile(srcPath, key);
	try {
		db.prepare("VACUUM INTO ?").run(destPath);
	} finally {
		db.close();
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
	openDbFile,
	verifyDbFile,
	snapshotDbFile,
	touchDbOpened,
	touchDbModified
};
