function parseInputSheet(worksheet) {
	const departments = [];
	const reasons = [];
	const chairmen = [];
	const members = [];
	const knowledgeScopes = [];

	worksheet.eachRow((row, rowNumber) => {
		if (rowNumber === 1) return;

		const departmentCode = String(row.getCell(1).value || "").trim();
		const departmentName = String(row.getCell(2).value || "").trim();

		if (departmentCode || departmentName) {
			departments.push({
				code: departmentCode,
				name: departmentName || departmentCode,
				hide_code_in_protocol: 0
			});
		}

		const reason = String(row.getCell(4).value || "").trim();
		if (reason) reasons.push({ name: reason });

		const chairmanName = String(row.getCell(6).value || "").trim();
		const chairmanPosition = String(row.getCell(7).value || "").trim();

		if (chairmanName || chairmanPosition) {
			chairmen.push({
				full_name: chairmanName,
				position: chairmanPosition
			});
		}

		const memberName = String(row.getCell(9).value || "").trim();
		const memberPosition = String(row.getCell(10).value || "").trim();

		if (memberName || memberPosition) {
			members.push({
				full_name: memberName,
				position: memberPosition
			});
		}

		const knowledgeScopeCode = String(row.getCell(12).value || "").trim();
		const instructions = String(row.getCell(13).value || "").trim();

		if (knowledgeScopeCode || instructions) {
			knowledgeScopes.push({
				code: knowledgeScopeCode,
				name: knowledgeScopeCode,
				instructions_text: instructions
			});
		}
	});

	return {
		departments,
		reasons,
		chairmen,
		members,
		knowledgeScopes
	};
}

module.exports = {
	parseInputSheet
};
