function getProtocolYear(checkDate) {
	return new Date(checkDate).getFullYear();
}

function getNextProtocolNumber(db, checkDate) {
	const protocolYear = getProtocolYear(checkDate);

	const row = db.prepare(`
		SELECT MAX(protocol_number) AS max_number
		FROM protocol_journal
		WHERE protocol_year = ?
	`).get(protocolYear);

	return {
		protocolYear,
		nextNumber: (row?.max_number || 0) + 1
	};
}

function assertProtocolNumberAvailable(db, protocolYear, protocolNumber) {
	const existing = db.prepare(`
		SELECT *
		FROM protocol_journal
		WHERE protocol_year = ?
			AND protocol_number = ?
	`).get(protocolYear, protocolNumber);

	if (existing) {
		throw new Error(`Протокол №${protocolNumber} за ${protocolYear} год уже существует`);
	}
}

function getJournalStatsByYear(db, year) {
	return db.prepare(`
		SELECT
			COUNT(*) AS count,
			COALESCE(MAX(protocol_number), 0) AS max_protocol_number
		FROM protocol_journal
		WHERE protocol_year = ?
	`).get(year);
}

function getMaxProtocolNumbersByYear(db) {
	return db.prepare(`
		SELECT
			protocol_year,
			COUNT(*) AS count,
			MAX(protocol_number) AS max_protocol_number
		FROM protocol_journal
		GROUP BY protocol_year
		ORDER BY protocol_year DESC
	`).all();
}

function listJournal(db, filters = {}) {
	const params = {};
	const where = [];

	if (filters.year) {
		where.push("protocol_year = @year");
		params.year = Number(filters.year);
	}

	if (filters.query) {
		where.push("(full_name_snapshot LIKE @query OR CAST(protocol_number AS TEXT) LIKE @query)");
		params.query = `%${filters.query}%`;
	}

	const sql = `
		SELECT *
		FROM protocol_journal
		${where.length ? `WHERE ${where.join(" AND ")}` : ""}
		ORDER BY check_date DESC, protocol_number DESC
		LIMIT 500
	`;

	return db.prepare(sql).all(params);
}

function deleteJournalRecord(db, id) {
	const row = db.prepare("SELECT id, protocol_year, protocol_number FROM protocol_journal WHERE id = ?").get(id);
	if (!row) {
		throw new Error("Запись не найдена");
	}

	// Физическое удаление (не мягкое) — журнал протоколов не требует аудита удалений
	db.prepare("DELETE FROM protocol_journal WHERE id = ?").run(id);

	return {
		id: row.id,
		protocol_year: row.protocol_year,
		protocol_number: row.protocol_number
	};
}

module.exports = {
	getProtocolYear,
	getNextProtocolNumber,
	assertProtocolNumberAvailable,
	getJournalStatsByYear,
	getMaxProtocolNumbersByYear,
	listJournal,
	deleteJournalRecord
};
