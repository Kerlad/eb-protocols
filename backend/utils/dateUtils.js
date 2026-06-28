function formatDateLocal(date) {
	const d = date instanceof Date ? date : new Date(date);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function addYearsLocal(dateStr, years) {
	const date = new Date(dateStr + "T00:00:00");
	date.setFullYear(date.getFullYear() + years);
	return formatDateLocal(date);
}

module.exports = {
	formatDateLocal,
	addYearsLocal
};
