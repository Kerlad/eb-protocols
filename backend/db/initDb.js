const fs = require("fs");
const path = require("path");
const { openDb, touchDbOpened } = require("./connection");

function initDb() {
	const db = openDb();
	const schemaPath = path.join(__dirname, "schema.sql");
	const schema = fs.readFileSync(schemaPath, "utf8");

	db.exec(schema);

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
		) VALUES (1, '0.1.0', 0, 'local_created')
	`).run();

	touchDbOpened(db);
	console.log("SQLite database initialized");
}

if (require.main === module) {
	initDb();
}

module.exports = { initDb };
