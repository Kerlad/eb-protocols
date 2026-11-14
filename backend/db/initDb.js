const fs = require("fs");
const path = require("path");
const { openDb, touchDbOpened } = require("./connection");
const pkg = require("../../package.json");
const eventsRepository = require("./repositories/eventsRepository");

const SETTINGS_KEY_MIGRATION = [
	["ftp_host", "ftp.host"],
	["ftp_port", "ftp.port"],
	["ftp_user", "ftp.user"],
	["ftp_path", "ftp.remote_dir"]
];

// T1.1: переименование ключей FTP; T1.2: удаление паролей из настроек
function migrateSettings(db) {
	const tx = db.transaction(() => {
		const has = db.prepare("SELECT 1 FROM settings WHERE key = ?");
		const read = db.prepare("SELECT value FROM settings WHERE key = ?");
		const insert = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
		const remove = db.prepare("DELETE FROM settings WHERE key = ?");
		for (const [oldKey, newKey] of SETTINGS_KEY_MIGRATION) {
			if (!has.get(oldKey)) continue;
			if (!has.get(newKey)) {
				insert.run(newKey, read.get(oldKey).value, new Date().toISOString());
			}
			remove.run(oldKey);
		}
		db.prepare("DELETE FROM settings WHERE key IN ('ftp_password', 'ftp.password')").run();
	});
	tx();
}

// T2.1: убрать поддельные даты, которые ставили прежние версии импорта (2000-01-01, DATE_DEFERRED)
function migrateFakeDates(db) {
	let shifted = 0;
	const tx = db.transaction(() => {
		db.prepare("UPDATE employees SET last_check_date = NULL WHERE last_check_date = '2000-01-01'").run();
		shifted = db.prepare("UPDATE employees SET note = NULL WHERE note = 'DATE_DEFERRED'").run().changes;
		if (shifted > 0) {
			eventsRepository.addEvent(db, {
				event_type: "migration_fake_dates",
				level: "warning",
				message: `У ${shifted} записей сроки проверки были сдвинуты прежней версией импорта. Перепроверьте даты у этих работников.`,
				details: { count: shifted }
			});
		}
	});
	tx();
	return shifted;
}

function initDb() {
	const db = openDb();
	try {
		initSchema(db);
	} finally {
		db.close();
	}
}

function initSchema(db) {
	const schemaPath = path.join(__dirname, "schema.sql");
	const schema = fs.readFileSync(schemaPath, "utf8");

	db.exec(schema);

	migrateSettings(db);
	migrateFakeDates(db);

	// Migration: add updated_at to reference tables if missing
	const tables = ['departments', 'knowledge_scopes', 'commission_chairmen', 'commission_members', 'commissions', 'work_rights'];
	for (const table of tables) {
		try {
			db.exec(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z'`);
			console.log(`Added updated_at to ${table}`);
		} catch(e) {
			// Ignore if it already exists
		}
	}

	db.prepare(`
		INSERT OR IGNORE INTO sync_state (
			id,
			db_version,
			sync_revision,
			sync_status
		) VALUES (1, ?, 0, 'local_created')
	`).run(pkg.version);

	touchDbOpened(db);
	console.log("SQLite database initialized v" + pkg.version);
}

if (require.main === module) {
	initDb();
}

module.exports = { initDb, migrateSettings, migrateFakeDates };
