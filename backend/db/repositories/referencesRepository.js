const { touchDbModified } = require("../connection");

function now() {
	return new Date().toISOString();
}

function upsertDepartment(db, department) {
	const createdAt = now();

	if (department.id) {
		db.prepare(`
			UPDATE departments
			SET code = ?,
				name = ?,
				hide_code_in_protocol = ?,
				status = 'active',
				updated_at = ?
			WHERE id = ?
		`).run(department.code || null, department.name, department.hide_code_in_protocol ? 1 : 0, createdAt, department.id);
		touchDbModified(db);
		return department.id;
	}

	const existing = db.prepare(`
		SELECT id
		FROM departments
		WHERE COALESCE(code, '') = COALESCE(?, '')
			AND name = ?
	`).get(department.code || "", department.name);

	if (existing) {
		db.prepare(`
			UPDATE departments
			SET hide_code_in_protocol = ?,
				status = 'active',
				updated_at = ?
			WHERE id = ?
		`).run(department.hide_code_in_protocol ? 1 : 0, createdAt, existing.id);

		touchDbModified(db);
		return existing.id;
	}

	const result = db.prepare(`
		INSERT INTO departments (
			code,
			name,
			hide_code_in_protocol,
			status,
			created_at,
			updated_at
		) VALUES (?, ?, ?, 'active', ?, ?)
	`).run(
		department.code || null,
		department.name,
		department.hide_code_in_protocol ? 1 : 0,
		createdAt,
		createdAt
	);

	touchDbModified(db);
	return result.lastInsertRowid;
}

function upsertKnowledgeScope(db, scope) {
	const createdAt = now();

	if (scope.id) {
		db.prepare(`
			UPDATE knowledge_scopes
			SET code = ?,
				name = ?,
				instructions_text = ?,
				status = 'active',
				updated_at = ?
			WHERE id = ?
		`).run(scope.code, scope.name || scope.code, scope.instructions_text || null, createdAt, scope.id);
		touchDbModified(db);
		return scope.id;
	}

	db.prepare(`
		INSERT INTO knowledge_scopes (
			code,
			name,
			instructions_text,
			status,
			created_at,
			updated_at
		) VALUES (
			@code,
			@name,
			@instructions_text,
			'active',
			@created_at,
			@updated_at
		)
		ON CONFLICT(code) DO UPDATE SET
			name = excluded.name,
			instructions_text = excluded.instructions_text,
			status = 'active',
			updated_at = excluded.updated_at
	`).run({
		code: scope.code,
		name: scope.name || scope.code,
		instructions_text: scope.instructions_text || null,
		created_at: createdAt,
		updated_at: createdAt
	});

	touchDbModified(db);

	return db.prepare(`SELECT id FROM knowledge_scopes WHERE code = ?`).get(scope.code).id;
}

function upsertPersonReference(db, table, person) {
	const createdAt = now();

	if (person.id) {
		db.prepare(`
			UPDATE ${table}
			SET full_name = ?,
				position = ?,
				status = 'active',
				updated_at = ?
			WHERE id = ?
		`).run(person.full_name, person.position, createdAt, person.id);
		touchDbModified(db);
		return person.id;
	}

	const existing = db.prepare(`
		SELECT id
		FROM ${table}
		WHERE full_name = ?
			AND position = ?
	`).get(person.full_name, person.position);

	if (existing) {
		db.prepare(`
			UPDATE ${table}
			SET status = 'active',
				updated_at = ?
			WHERE id = ?
		`).run(createdAt, existing.id);

		touchDbModified(db);
		return existing.id;
	}

	const result = db.prepare(`
		INSERT INTO ${table} (
			full_name,
			position,
			status,
			created_at,
			updated_at
		) VALUES (?, ?, 'active', ?, ?)
	`).run(person.full_name, person.position, createdAt, createdAt);

	touchDbModified(db);
	return result.lastInsertRowid;
}

function upsertChairman(db, chairman) {
	return upsertPersonReference(db, "commission_chairmen", chairman);
}

function upsertMember(db, member) {
	return upsertPersonReference(db, "commission_members", member);
}

function upsertWorkRight(db, right) {
	const createdAt = now();

	if (right.id) {
		db.prepare(`
			UPDATE work_rights
			SET name = ?,
				protocol_text = ?,
				sort_order = ?,
				status = 'active',
				updated_at = ?
			WHERE id = ?
		`).run(right.name, right.protocol_text || right.name, right.sort_order || 0, createdAt, right.id);
		touchDbModified(db);
		return right.id;
	}

	const existing = db.prepare(`
		SELECT id
		FROM work_rights
		WHERE name = ?
	`).get(right.name);

	if (existing) {
		db.prepare(`
			UPDATE work_rights
			SET protocol_text = ?,
				sort_order = ?,
				status = 'active',
				updated_at = ?
			WHERE id = ?
		`).run(right.protocol_text || right.name, right.sort_order || 0, createdAt, existing.id);

		touchDbModified(db);
		return existing.id;
	}

	const result = db.prepare(`
		INSERT INTO work_rights (
			name,
			protocol_text,
			sort_order,
			status,
			created_at,
			updated_at
		) VALUES (?, ?, ?, 'active', ?, ?)
	`).run(right.name, right.protocol_text || right.name, right.sort_order || 0, createdAt, createdAt);

	touchDbModified(db);
	return result.lastInsertRowid;
}

function setEmployeeRight(db, employeeId, rightId, value = 1) {
	const createdAt = now();

	db.prepare(`
		INSERT INTO employee_rights (
			employee_id,
			right_id,
			value,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(employee_id, right_id) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`).run(employeeId, rightId, value ? 1 : 0, createdAt, createdAt);

	touchDbModified(db);
}

function listReferences(db) {
	return {
		departments: db.prepare(`
			SELECT *
			FROM departments
			WHERE status = 'active'
			ORDER BY code, name
		`).all(),
		knowledgeScopes: db.prepare(`
			SELECT *
			FROM knowledge_scopes
			WHERE status = 'active'
			ORDER BY code
		`).all(),
		chairmen: db.prepare(`
			SELECT *
			FROM commission_chairmen
			WHERE status = 'active'
			ORDER BY full_name
		`).all(),
		members: db.prepare(`
			SELECT *
			FROM commission_members
			WHERE status = 'active'
			ORDER BY full_name
		`).all(),
		commissions: db.prepare(`
			SELECT
				c.*,
				ch.full_name AS chairman_name,
				ch.position AS chairman_position,
				m1.full_name AS member_1_name,
				m1.position AS member_1_position,
				m2.full_name AS member_2_name,
				m2.position AS member_2_position,
				m3.full_name AS member_3_name,
				m3.position AS member_3_position
			FROM commissions c
			LEFT JOIN commission_chairmen ch ON ch.id = c.chairman_id
			LEFT JOIN commission_members m1 ON m1.id = c.member_1_id
			LEFT JOIN commission_members m2 ON m2.id = c.member_2_id
			LEFT JOIN commission_members m3 ON m3.id = c.member_3_id
			WHERE c.status = 'active'
			ORDER BY c.name
		`).all(),
		workRights: db.prepare(`
			SELECT *
			FROM work_rights
			WHERE status = 'active'
			ORDER BY sort_order ASC, name ASC
		`).all()
	};
}

function upsertCommission(db, commission) {
	const createdAt = now();

	if (commission.id) {
		db.prepare(`
			UPDATE commissions
			SET name = @name,
				chairman_id = @chairman_id,
				member_1_id = @member_1_id,
				member_2_id = @member_2_id,
				member_3_id = @member_3_id,
				status = COALESCE(@status, 'active'),
				updated_at = @updated_at
			WHERE id = @id
		`).run({
			id: commission.id,
			name: commission.name,
			chairman_id: commission.chairman_id || null,
			member_1_id: commission.member_1_id || null,
			member_2_id: commission.member_2_id || null,
			member_3_id: commission.member_3_id || null,
			status: commission.status || "active",
			updated_at: createdAt
		});

		touchDbModified(db);
		return commission.id;
	}

	const result = db.prepare(`
		INSERT INTO commissions (
			name,
			chairman_id,
			member_1_id,
			member_2_id,
			member_3_id,
			status,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
	`).run(
		commission.name,
		commission.chairman_id || null,
		commission.member_1_id || null,
		commission.member_2_id || null,
		commission.member_3_id || null,
		createdAt,
		createdAt
	);

	touchDbModified(db);
	return result.lastInsertRowid;
}

module.exports = {
	upsertDepartment,
	upsertKnowledgeScope,
	upsertChairman,
	upsertMember,
	upsertWorkRight,
	upsertCommission,
	setEmployeeRight,
	listReferences
};
