function now() {
	return new Date().toISOString();
}

function getSetting(db, key, defaultValue = null) {
	const row = db.prepare(`
		SELECT value
		FROM settings
		WHERE key = ?
	`).get(key);

	return row ? row.value : defaultValue;
}

function setSetting(db, key, value) {
	db.prepare(`
		INSERT INTO settings (
			key,
			value,
			updated_at
		) VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`).run(key, String(value), now());
}

function getAllSettings(db) {
	const rows = db.prepare(`
		SELECT key, value
		FROM settings
		ORDER BY key
	`).all();

	return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function saveSettings(db, settings) {
	const tx = db.transaction(() => {
		for (const [key, value] of Object.entries(settings)) {
			setSetting(db, key, value);
		}
	});

	tx();

	return getAllSettings(db);
}

module.exports = {
	getSetting,
	setSetting,
	getAllSettings,
	saveSettings
};
