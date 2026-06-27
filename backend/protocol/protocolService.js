const path = require("path");
const { openDb, touchDbModified } = require("../db/connection");
const { getProtocolYear, getNextProtocolNumber, assertProtocolNumberAvailable } = require("./protocolNumbering");
const { buildProtocolPlaceholderMap } = require("./placeholderMap");
const { renderProtocolDocx, buildOutputFileName } = require("./docxGenerator");
const employeesRepository = require("../db/repositories/employeesRepository");
const syncRepository = require("../db/repositories/syncRepository");

function now() {
	return new Date().toISOString();
}

function addDays(dateStr, days) {
	const date = new Date(dateStr);
	date.setDate(date.getDate() + days);
	return date.toISOString().slice(0, 10);
}

function addYears(dateStr, years) {
	const date = new Date(dateStr);
	date.setFullYear(date.getFullYear() + years);
	return date.toISOString().slice(0, 10);
}

function computeNextCheckDate(checkDate, periodYears) {
	if (!checkDate) return null;
	const years = Number(periodYears) || 1;
	return addYears(checkDate, years);
}

function getProtocolDraft(form) {
	const db = openDb();

	try {
		let employee = null;

		if (form.employee_id) {
			employee = employeesRepository.findById(db, form.employee_id);
		}

		const checkDate = form.check_date || now().slice(0, 10);
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
			rights_text: rightsText
		};
	} finally {
		db.close();
	}
}

async function saveProtocol(form, options = {}) {
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
			rights_text: form.rights_text || null
		};

		const placeholderMap = buildProtocolPlaceholderMap(record);
		const protocolsDir = options.protocolsDir || path.join(process.cwd(), "data", "protocols");
		const outputPath = path.join(protocolsDir, buildOutputFileName(record));

		renderProtocolDocx({
			form: record,
			placeholderMap,
			outputPath
		});

		record.docx_path = outputPath;

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

		return {
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

