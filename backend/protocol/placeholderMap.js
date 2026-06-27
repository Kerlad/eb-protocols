function formatDate(value) {
	if (!value) return "";

	if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) {
		const [year, month, day] = String(value).slice(0, 10).split("-");
		return `${day}.${month}.${year}`;
	}

	return String(value);
}

function buildProtocolPlaceholderMap(form) {
	return {
		"Номер": String(form.protocol_number || ""),
		"Дата": formatDate(form.check_date),
		"Причина": form.reason || "",
		"Комиссия": form.commission_name || "",
		"Объем_знаний": form.knowledge_scope_code || "",

		"Должность_ПК": form.chairman_position || "",
		"ПК": form.chairman_name || "",

		"Должность_ЧК_1": form.member_1_position || "",
		"ЧК_1": form.member_1_name || "",
		"Должность_ЧК_2": form.member_2_position || "",
		"ЧК_2": form.member_2_name || "",
		"Должность_ЧК_3": form.member_3_position || "",
		"ЧК_3": form.member_3_name || "",

		"инструкции": form.instructions_text || "",

		"ФИО": form.full_name_snapshot || "",
		"Место_Работы": form.workplace_snapshot || "",
		"Должность": form.position_snapshot || "",
		"Дата_пред_проверки": formatDate(form.previous_check_date),
		"пред_оценка": form.previous_result || "",

		"оценка_ЭБ": form.result_eb || "",
		"оценка_ОТ": form.result_ot || "",
		"оценка_ПБ": form.result_pb || "",
		"другие_ИОТ": form.result_other || "",

		"оценка": form.final_result || "",
		"Группа_ЭБ": form.electrical_safety_group || "",
		"Прод_Дублир": form.duplicate_duration || "",
		"категория": form.personnel_category || "",
		"права": form.rights_text || "",
		"категория_ЭУ": form.voltage_category || "",
		"След_Дата": formatDate(form.next_check_date)
	};
}

module.exports = {
	buildProtocolPlaceholderMap,
	formatDate
};
