const { touchDbModified } = require("../connection");

function now() {
	return new Date().toISOString();
}

function createEmployee(db, employee) {
	const createdAt = now();

	const result = db.prepare(`
		INSERT INTO employees (
			last_name,
			first_name,
			middle_name,
			full_name,
			workplace_code,
			workplace_name,
			position,
			knowledge_scope_code,
			personnel_category,
			electrical_safety_group,
			last_check_date,
			next_check_date,
			check_period_years,
			last_result,
			status,
			note,
			created_at,
			updated_at
		) VALUES (
			@last_name,
			@first_name,
			@middle_name,
			@full_name,
			@workplace_code,
			@workplace_name,
			@position,
			@knowledge_scope_code,
			@personnel_category,
			@electrical_safety_group,
			@last_check_date,
			@next_check_date,
			@check_period_years,
			@last_result,
			@status,
			@note,
			@created_at,
			@updated_at
		)
	`).run({
		last_name: employee.last_name,
		first_name: employee.first_name,
		middle_name: employee.middle_name || null,
		full_name: employee.full_name,
		workplace_code: employee.workplace_code || null,
		workplace_name: employee.workplace_name || null,
		position: employee.position || null,
		knowledge_scope_code: employee.knowledge_scope_code || null,
		personnel_category: employee.personnel_category || null,
		electrical_safety_group: employee.electrical_safety_group || null,
		last_check_date: employee.last_check_date || null,
		next_check_date: employee.next_check_date || null,
		check_period_years: employee.check_period_years || 1,
		last_result: employee.last_result || null,
		status: employee.status || "active",
		note: employee.note || null,
		created_at: createdAt,
		updated_at: createdAt
	});

	const employeeId = result.lastInsertRowid;

	if (Array.isArray(employee.rights)) {
		const stmt = db.prepare(`
			INSERT OR IGNORE INTO employee_rights (
				employee_id,
				right_id,
				value,
				created_at,
				updated_at
			) VALUES (?, ?, 1, ?, ?)
		`);
		for (const rightId of employee.rights) {
			stmt.run(employeeId, rightId, createdAt, createdAt);
		}
	}

	touchDbModified(db);

	return employeeId;
}

function findByLastName(db, lastName) {
	return db.prepare(`
		SELECT *
		FROM employees
		WHERE LOWER(last_name) LIKE LOWER(?)
			AND status != 'deleted'
		ORDER BY full_name ASC
		LIMIT 20
	`).all(`%${lastName}%`);
}

function findById(db, id) {
	const employee = db.prepare(`
		SELECT *
		FROM employees
		WHERE id = ?
	`).get(id);

	if (!employee) return null;

	const rights = db.prepare(`
		SELECT
			wr.id,
			wr.name,
			wr.protocol_text,
			wr.sort_order
		FROM employee_rights er
		JOIN work_rights wr ON wr.id = er.right_id
		WHERE er.employee_id = ?
			AND er.value = 1
			AND wr.status = 'active'
		ORDER BY wr.sort_order ASC, wr.name ASC
	`).all(id);

	return {
		...employee,
		rights
	};
}

function findExistingEmployee(db, employee) {
	return db.prepare(`
		SELECT *
		FROM employees
		WHERE full_name = ?
			AND COALESCE(workplace_code, '') = COALESCE(?, '')
			AND COALESCE(position, '') = COALESCE(?, '')
		LIMIT 1
	`).get(employee.full_name, employee.workplace_code || "", employee.position || "");
}

function updateEmployee(db, id, patch) {
	if (!patch || typeof patch !== "object") {
		return;
	}

	const allowed = [
		"last_name", "first_name", "middle_name", "full_name", "workplace_code",
		"workplace_name", "position", "knowledge_scope_code", "personnel_category",
		"electrical_safety_group", "last_check_date", "next_check_date",
		"check_period_years", "last_result", "status", "note"
	];

	const keys = Object.keys(patch).filter((key) => allowed.includes(key));
	const hasRights = patch.rights !== undefined;

	if (keys.length > 0) {
		const updates = keys.map((key) => `${key} = @${key}`).join(", ");
		db.prepare(`
			UPDATE employees
			SET ${updates},
				updated_at = @updated_at
			WHERE id = @id
		`).run({
			...patch,
			id,
			updated_at: now()
		});
	}

	if (hasRights) {
		db.prepare("DELETE FROM employee_rights WHERE employee_id = ?").run(id);
		if (Array.isArray(patch.rights)) {
			const stmt = db.prepare(`
				INSERT OR IGNORE INTO employee_rights (
					employee_id,
					right_id,
					value,
					created_at,
					updated_at
				) VALUES (?, ?, 1, ?, ?)
			`);
			const t = now();
			for (const rightId of patch.rights) {
				stmt.run(id, rightId, t, t);
			}
		}
	}

	if (keys.length > 0 || hasRights) {
		touchDbModified(db);
	}
}

function upsertEmployee(db, employee) {
	const existing = findExistingEmployee(db, employee);

	if (existing) {
		updateEmployee(db, existing.id, employee);
		return { id: existing.id, action: "updated" };
	}

	return { id: createEmployee(db, employee), action: "created" };
}

function listAll(db) {
	return db.prepare(`
		SELECT *
		FROM employees
		WHERE status != 'deleted'
		ORDER BY full_name ASC
	`).all();
}

module.exports = {
	createEmployee,
	upsertEmployee,
	findByLastName,
	findById,
	findExistingEmployee,
	updateEmployee,
	listAll
};
