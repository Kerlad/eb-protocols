function getProtocolYear(checkDate) {
	if (!checkDate) {
		throw new Error("Дата проверки обязательна для расчета года протокола");
	}
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
	const row = db.prepare(`
		SELECT id, full_name_snapshot, check_date
		FROM protocol_journal
		WHERE protocol_year = ?
			AND protocol_number = ?
	`).get(protocolYear, protocolNumber);

	if (row) {
		throw new Error(
			`Протокол №${protocolNumber} за ${protocolYear} год уже существует`
		);
	}
}

module.exports = {
	getProtocolYear,
	getNextProtocolNumber,
	assertProtocolNumberAvailable
};
