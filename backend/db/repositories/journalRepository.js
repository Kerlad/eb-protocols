const path = require("path");
const fs = require("fs");
const employeesRepository = require("./employeesRepository");
const eventsRepository = require("./eventsRepository");
const { resolveProtocolFile } = require("../../protocol/protocolFiles");
const { isFailedResult } = require("../../utils/checkPeriod");

function getProtocolYear(checkDate) {
	return Number(String(checkDate).slice(0, 4));
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

// Файл не удаляем, а переименовываем в <имя>.deleted; отсутствие файла не ошибка
function markFileDeleted(protocolsDir, storedPath) {
	if (!storedPath) return null;
	try {
		const full = resolveProtocolFile(protocolsDir, storedPath);
		if (!full) return null;
		let target = full + ".deleted";
		if (fs.existsSync(target)) target = `${full}.${Date.now()}.deleted`;
		fs.renameSync(full, target);
		return target;
	} catch (error) {
		return null;
	}
}

// T2.6: удаление возвращает карточку работника к предыдущему протоколу, файлы остаются как .deleted
function deleteJournalRecord(db, id, options = {}) {
	const row = db.prepare(`
		SELECT id, protocol_year, protocol_number, employee_id, docx_path, pdf_path, full_name_snapshot
		FROM protocol_journal WHERE id = ?
	`).get(id);
	if (!row) {
		throw new Error("Запись не найдена");
	}

	let warning = null;
	let restoredFrom = null;

	const tx = db.transaction(() => {
		db.prepare("DELETE FROM protocol_journal WHERE id = ?").run(id);

		if (row.employee_id) {
			const prev = db.prepare(`
				SELECT id, protocol_number, protocol_year, check_date, next_check_date, final_result, electrical_safety_group
				FROM protocol_journal
				WHERE employee_id = ?
				ORDER BY check_date DESC, id DESC
				LIMIT 1
			`).get(row.employee_id);

			if (prev) {
				const patch = {
					last_check_date: prev.check_date,
					next_check_date: prev.next_check_date,
					last_result: prev.final_result
				};
				if (prev.electrical_safety_group && !isFailedResult(prev.final_result)) {
					patch.electrical_safety_group = prev.electrical_safety_group;
				}
				employeesRepository.updateEmployee(db, row.employee_id, patch);
				restoredFrom = `№${prev.protocol_number}/${prev.protocol_year}`;
			} else {
				warning = "У работника не осталось других протоколов: карточка (даты проверки, оценка, группа) не изменена, проверьте её вручную.";
			}
		}

		eventsRepository.addEvent(db, {
			event_type: "protocol_deleted",
			level: warning ? "warning" : "info",
			message: `Удален протокол №${row.protocol_number}/${row.protocol_year}`,
			details: {
				id: row.id,
				protocol_year: row.protocol_year,
				protocol_number: row.protocol_number,
				employee_id: row.employee_id,
				card_restored_from: restoredFrom,
				warning
			}
		});
	});
	tx();

	const protocolsDir = options.protocolsDir || require("../../paths").getProtocolsDir();
	const renamed = [row.docx_path, row.pdf_path]
		.map((p) => markFileDeleted(protocolsDir, p))
		.filter(Boolean);

	return {
		id: row.id,
		protocol_year: row.protocol_year,
		protocol_number: row.protocol_number,
		warning,
		renamed_files: renamed
	};
}

function getLastByEmployeeId(db, employeeId) {
	return db.prepare(`
		SELECT final_result, electrical_safety_group, check_date
		FROM protocol_journal
		WHERE employee_id = ?
		ORDER BY check_date DESC, protocol_number DESC
		LIMIT 1
	`).get(employeeId);
}

module.exports = {
	getProtocolYear,
	getNextProtocolNumber,
	assertProtocolNumberAvailable,
	getJournalStatsByYear,
	getMaxProtocolNumbersByYear,
	listJournal,
	deleteJournalRecord,
	getLastByEmployeeId
};
