function formatDateLocal(date) {
	const d = date instanceof Date ? date : new Date(date);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function addDaysLocal(dateStr, days) {
	const date = new Date(dateStr + "T00:00:00");
	date.setDate(date.getDate() + days);
	return formatDateLocal(date);
}

function addYearsLocal(dateStr, years) {
	const date = new Date(dateStr + "T00:00:00");
	date.setFullYear(date.getFullYear() + years);
	return formatDateLocal(date);
}

function todayLocal() {
	return formatDateLocal(new Date());
}

function toLocalDate(isoString) {
	if (!isoString) return null;
	return isoString.slice(0, 10);
}

module.exports = {
	formatDateLocal,
	addDaysLocal,
	addYearsLocal,
	todayLocal,
	toLocalDate
};
