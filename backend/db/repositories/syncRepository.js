function getSyncState(db) {
	return db.prepare(`
		SELECT *
		FROM sync_state
		WHERE id = 1
	`).get();
}

function updateSyncState(db, patch) {
	const allowed = [
		"last_opened_at",
		"last_modified_at",
		"last_synced_at",
		"last_sync_direction",
		"last_sync_user",
		"last_sync_device",
		"db_version",
		"sync_revision",
		"remote_file_timestamp",
		"sync_status",
		"sync_error",
		"local_journal_count_total",
		"remote_journal_count_total",
		"local_journal_count_current_year",
		"remote_journal_count_current_year",
		"local_max_protocol_number_current_year",
		"remote_max_protocol_number_current_year"
	];

	const keys = Object.keys(patch).filter((key) => allowed.includes(key));
	if (!keys.length) return;

	const sql = `
		UPDATE sync_state
		SET ${keys.map((key) => `${key} = @${key}`).join(", ")}
		WHERE id = 1
	`;

	db.prepare(sql).run(patch);
}

function incrementRevision(db) {
	db.prepare(`
		UPDATE sync_state
		SET sync_revision = COALESCE(sync_revision, 0) + 1,
			last_modified_at = ?
		WHERE id = 1
	`).run(new Date().toISOString());
}

function getLocalDbStats(db, year = new Date().getFullYear()) {
	const total = db.prepare(`
		SELECT COUNT(*) AS count
		FROM protocol_journal
	`).get();

	const currentYear = db.prepare(`
		SELECT
			COUNT(*) AS count,
			COALESCE(MAX(protocol_number), 0) AS max_protocol_number
		FROM protocol_journal
		WHERE protocol_year = ?
	`).get(year);

	const byYear = db.prepare(`
		SELECT
			protocol_year,
			COUNT(*) AS count,
			COALESCE(MAX(protocol_number), 0) AS max_protocol_number
		FROM protocol_journal
		GROUP BY protocol_year
		ORDER BY protocol_year DESC
	`).all();

	return {
		journal_count_total: total.count,
		journal_count_current_year: currentYear.count,
		max_protocol_number_current_year: currentYear.max_protocol_number,
		max_protocol_numbers_by_year: byYear
	};
}

module.exports = {
	getSyncState,
	updateSyncState,
	incrementRevision,
	getLocalDbStats
};
