const path = require("path");
const fs = require("fs");
const { openDb, touchDbModified } = require("../db/connection");
const { getProtocolYear, getNextProtocolNumber, assertProtocolNumberAvailable } = require("./protocolNumbering");
const { buildProtocolPlaceholderMap } = require("./placeholderMap");
const docxGenerator = require("./docxGenerator");
const { buildOutputFileName } = docxGenerator;
const employeesRepository = require("../db/repositories/employeesRepository");
const syncRepository = require("../db/repositories/syncRepository");
const { addYearsLocal, todayLocal, isIsoDate } = require("../utils/dateUtils");

function now() {
	return new Date().toISOString();
}

function computeNextCheckDate(checkDate, periodYears) {
	if (!checkDate) return null;
	const years = Number(periodYears) || 1;
	return addYearsLocal(checkDate, years);
}

function getProtocolDraft(form) {
	const db = openDb();

	try {
		let employee = null;

		if (form.employee_id) {
			employee = employeesRepository.findById(db, form.employee_id);
		}

		const checkDate = form.check_date || todayLocal();
		const { protocolYear, nextNumber } = getNextProtocolNumber(db, checkDate);

		const rightsText = employee && employee.rights
			? employee.rights.map((right) => right.protocol_text).filter(Boolean).join("; ")
			: "";

		return {
			protocol_year: protocolYear,
			protocol_number: nextNumber,
			check_date: checkDate,
			next_check_date: form.next_check_date || computeNextCheckDate(checkDate, employee?.check_period_years),
			employee_id: employee?.id || null,
			full_name_snapshot: employee?.full_name || form.full_name_snapshot || "",
			workplace_snapshot: employee?.workplace_name || employee?.workplace_code || form.workplace_snapshot || "",
			position_snapshot: employee?.position || form.position_snapshot || "",
			personnel_category: employee?.personnel_category || form.personnel_category || "",
			electrical_safety_group: employee?.electrical_safety_group || form.electrical_safety_group || "",
			knowledge_scope_code: employee?.knowledge_scope_code || form.knowledge_scope_code || "",
			previous_check_date: employee?.last_check_date || form.previous_check_date || "",
			previous_result: employee?.last_result || form.previous_result || "",
			instructions_text: form.instructions_text || "",
			rights_text: rightsText
		};
	} finally {
		db.close();
	}
}

function validateProtocolForm(form) {
	form = form || {};
	const missing = [];
	const invalid = [];
	const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";

	if (!has(form.full_name_snapshot)) missing.push("ФИО работника");

	let checkOk = false;
	if (!has(form.check_date)) missing.push("дата проверки");
	else if (!isIsoDate(form.check_date)) invalid.push("дата проверки");
	else checkOk = true;

	const num = Number(form.protocol_number);
	if (!has(form.protocol_number)) missing.push("номер протокола");
	else if (!Number.isInteger(num) || num <= 0) invalid.push("номер протокола (должен быть целым числом больше 0)");

	if (!has(form.electrical_safety_group)) missing.push("группа ЭБ");
	else if (!["II", "III", "IV", "V"].includes(String(form.electrical_safety_group).trim())) invalid.push("группа ЭБ (допустимо II, III, IV, V)");

	if (!has(form.final_result)) missing.push("итоговый результат");
	if (!has(form.commission_name)) missing.push("наименование комиссии");
	if (!has(form.chairman_name)) missing.push("председатель комиссии");
	if (!has(form.member_1_name)) missing.push("член комиссии 1");

	if (!has(form.next_check_date)) missing.push("дата следующей проверки");
	else if (!isIsoDate(form.next_check_date)) invalid.push("дата следующей проверки");
	else if (checkOk && form.next_check_date <= form.check_date) invalid.push("дата следующей проверки (должна быть позже даты проверки)");

	const parts = [];
	if (missing.length) parts.push("Не заполнены поля: " + missing.join(", "));
	if (invalid.length) parts.push("Некорректные поля: " + invalid.join(", "));
	if (parts.length) throw new Error(parts.join(". "));
}

async function saveProtocol(form, options = {}) {
	validateProtocolForm(form);
	const db = openDb();

	try {
		const checkDate = form.check_date;
		if (!checkDate) {
			throw new Error("Не указана дата проверки");
		}

		const protocolYear = getProtocolYear(checkDate);
		const protocolNumber = Number(form.protocol_number);

		if (!protocolNumber) {
			throw new Error("Не указан номер протокола");
		}

		assertProtocolNumberAvailable(db, protocolYear, protocolNumber);

		const isPrimary = form.reason === "Первичная";

		const record = {
			protocol_year: protocolYear,
			protocol_number: protocolNumber,
			employee_id: form.employee_id || null,
			full_name_snapshot: form.full_name_snapshot,
			workplace_snapshot: form.workplace_snapshot || null,
			position_snapshot: form.position_snapshot || null,
			check_date: checkDate,
			next_check_date: form.next_check_date || computeNextCheckDate(checkDate, form.check_period_years),
			reason: form.reason || null,
			knowledge_scope_code: form.knowledge_scope_code || null,
			instructions_text: form.instructions_text || null,
			personnel_category: form.personnel_category || null,
			electrical_safety_group: form.electrical_safety_group || null,
			result_eb: form.result_eb || null,
			result_ot: form.result_ot || null,
			result_pb: form.result_pb || null,
			result_other: form.result_other || null,
			final_result: form.final_result || null,
			duplicate_duration: form.duplicate_duration || null,
			voltage_category: form.voltage_category || null,
			commission_name: form.commission_name || null,
			chairman_position: form.chairman_position || null,
			chairman_name: form.chairman_name || null,
			member_1_position: form.member_1_position || null,
			member_1_name: form.member_1_name || null,
			member_2_position: form.member_2_position || null,
			member_2_name: form.member_2_name || null,
			member_3_position: form.member_3_position || null,
			member_3_name: form.member_3_name || null,
			rights_text: form.rights_text || null,
			previous_check_date: isPrimary ? null : (form.previous_check_date || null),
			previous_result: isPrimary ? null : (form.previous_result || null)
		};

		const placeholderMap = buildProtocolPlaceholderMap(record);
		const protocolsDir = options.protocolsDir || require("../paths").getProtocolsDir();
		const outputPath = path.join(protocolsDir, buildOutputFileName(record));

		record.docx_path = outputPath;

		// Прежние значения работника: нужны, чтобы откатить обновление, если DOCX не создался
		const prevEmployee = record.employee_id ? employeesRepository.findById(db, record.employee_id) : null;

		const tx = db.transaction(() => {
			const createdAt = now();

			db.prepare(`
				INSERT INTO protocol_journal (
					protocol_year, protocol_number, employee_id, full_name_snapshot,
					workplace_snapshot, position_snapshot, check_date, next_check_date,
					reason, knowledge_scope_code, instructions_text, personnel_category,
					electrical_safety_group, result_eb, result_ot, result_pb, result_other,
					final_result, duplicate_duration, voltage_category, commission_name,
					chairman_position, chairman_name, member_1_position, member_1_name,
					member_2_position, member_2_name, member_3_position, member_3_name,
					rights_text, docx_path, created_at, updated_at
				) VALUES (
					@protocol_year, @protocol_number, @employee_id, @full_name_snapshot,
					@workplace_snapshot, @position_snapshot, @check_date, @next_check_date,
					@reason, @knowledge_scope_code, @instructions_text, @personnel_category,
					@electrical_safety_group, @result_eb, @result_ot, @result_pb, @result_other,
					@final_result, @duplicate_duration, @voltage_category, @commission_name,
					@chairman_position, @chairman_name, @member_1_position, @member_1_name,
					@member_2_position, @member_2_name, @member_3_position, @member_3_name,
					@rights_text, @docx_path, @created_at, @updated_at
				)
			`).run({ ...record, created_at: createdAt, updated_at: createdAt });

			if (record.employee_id) {
				employeesRepository.updateEmployee(db, record.employee_id, {
					last_check_date: record.check_date,
					next_check_date: record.next_check_date,
					last_result: record.final_result
				});
			}

			const stats = syncRepository.getLocalDbStats(db);
			syncRepository.updateSyncState(db, {
				local_journal_count_total: stats.journal_count_total,
				local_journal_count_current_year: stats.journal_count_current_year,
				local_max_protocol_number_current_year: stats.max_protocol_number_current_year
			});

			touchDbModified(db);
		});

		tx();

		try {
			docxGenerator.renderProtocolDocx({
				form: record,
				placeholderMap,
				outputPath
			});
		} catch (error) {
			// DOCX не создан: убираем запись журнала и возвращаем прежние данные работника
			db.prepare("DELETE FROM protocol_journal WHERE protocol_year = ? AND protocol_number = ?")
				.run(protocolYear, protocolNumber);
			if (prevEmployee) {
				employeesRepository.updateEmployee(db, prevEmployee.id, {
					last_check_date: prevEmployee.last_check_date,
					next_check_date: prevEmployee.next_check_date,
					last_result: prevEmployee.last_result
				});
			}
			try {
				const stats = syncRepository.getLocalDbStats(db);
				syncRepository.updateSyncState(db, {
					local_journal_count_total: stats.journal_count_total,
					local_journal_count_current_year: stats.journal_count_current_year,
					local_max_protocol_number_current_year: stats.max_protocol_number_current_year
				});
			} catch (e) { /* не критично */ }
			try { fs.unlinkSync(outputPath); } catch (e) { /* файла может не быть */ }
			throw error;
		}

		// Generate PDF asynchronously outside of the SQL transaction block
		let pdfPath = null;
		try {
			const { generatePdf } = require("./pdfGenerator");
			pdfPath = await generatePdf(outputPath);
			db.prepare("UPDATE protocol_journal SET pdf_path = ? WHERE protocol_year = ? AND protocol_number = ?")
				.run(pdfPath, protocolYear, protocolNumber);
		} catch (error) {
			console.warn("PDF generation skipped/failed:", error.message);
		}

		const saved = db.prepare("SELECT id FROM protocol_journal WHERE protocol_year = ? AND protocol_number = ?")
			.get(protocolYear, protocolNumber);

		return {
			id: saved ? saved.id : null,
			protocol_year: protocolYear,
			protocol_number: protocolNumber,
			docx_path: outputPath,
			pdf_path: pdfPath
		};
	} finally {
		db.close();
	}
}

module.exports = {
	getProtocolDraft,
	saveProtocol,
	validateProtocolForm,
	computeNextCheckDate,
	generatePreviewDocx
};

async function generatePreviewDocx(form, options = {}) {
	const { renderProtocolDocx, buildOutputFileName } = require('./docxGenerator');
	const { buildProtocolPlaceholderMap } = require('./placeholderMap');
	const os = require('os');
	const path = require('path');
	const fs = require('fs');

	const placeholderMap = buildProtocolPlaceholderMap(form);
	const tempDir = os.tmpdir();
	const outputPath = path.join(tempDir, 'Preview_' + buildOutputFileName(form));

	renderProtocolDocx({
		form: form,
		placeholderMap,
		outputPath
	});

	return { docx_path: outputPath };
}

