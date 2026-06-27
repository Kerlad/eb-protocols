function now() {
	return new Date().toISOString();
}

function addEvent(db, event) {
	const result = db.prepare(`
		INSERT INTO app_events (
			event_type,
			level,
			message,
			details,
			created_at
		) VALUES (
			@event_type,
			@level,
			@message,
			@details,
			@created_at
		)
	`).run({
		event_type: event.event_type,
		level: event.level || "info",
		message: event.message,
		details: event.details ? JSON.stringify(event.details) : null,
		created_at: now()
	});

	return result.lastInsertRowid;
}

function listEvents(db, filters = {}) {
	const where = [];
	const params = {};

	if (filters.level) {
		where.push("level = @level");
		params.level = filters.level;
	}

	if (filters.event_type) {
		where.push("event_type = @event_type");
		params.event_type = filters.event_type;
	}

	const sql = `
		SELECT *
		FROM app_events
		${where.length ? `WHERE ${where.join(" AND ")}` : ""}
		ORDER BY created_at DESC
		LIMIT 500
	`;

	return db.prepare(sql).all(params);
}

module.exports = {
	addEvent,
	listEvents
};
