(function () {
	if (!window.ebApi) {
		console.warn("ebApi недоступен — интерфейс работает в режиме макета");
		return;
	}

	const api = window.ebApi;
	const byId = (id) => document.getElementById(id);
	const getVal = (id, fallback = "") => {
		const el = byId(id);
		return el ? (el.value || fallback) : fallback;
	};
	const setVal = (id, value) => {
		const el = byId(id);
		if (el) el.value = value == null ? "" : value;
	};

	let searchCache = [];
	let allRefs = null;

	// Bidirectional rights translation mapping
	const UI_TO_DB_RIGHTS = {
		'ответственный руководитель работ': 'отв рук-ль работ;',
		'производитель работ': 'производитель работ;',
		'оперативные переговоры': 'опер. переговоры;',
		'оперативные переключения': 'опер.переключения;',
		'в/в испытания': 'в/в испытания;',
		'механические испытания': 'мех.испытания;',
		'выполнение работ на высоте': 'вып. работ на высоте;',
		'единоличный осмотр ЭУ': 'Единоличный осмотр ЭУ;',
		'оперативный персонал': 'оперативного персонала;',
		'инспектирование': 'инспектирования;',
		'выдача нарядов-допусков': 'выдача нарядов-допусков и распоряжений;',
		'наблюдающий': 'наблюдающий;',
		'допускающий': 'допускающий;',
		'член бригады': 'член бригады;',
		'работа под напряжением': 'работа под напряжением;',
		'электросварочные работы': 'электросварочные работы;',
		'с мегомметром': 'с мегомметром;',
		'стропальщик': 'стропальщик;'
	};

	const DB_TO_UI_RIGHTS = {};
	for (const [ui, db] of Object.entries(UI_TO_DB_RIGHTS)) {
		DB_TO_UI_RIGHTS[db] = ui;
	}
	DB_TO_UI_RIGHTS['работа на высоте;'] = 'выполнение работ на высоте';

	function toast(msg) {
		if (typeof window.showToast === "function") window.showToast(msg);
		else console.log(msg);
	}

	function fmt(d) {
		if (!d) return "—";
		const parts = String(d).slice(0, 10).split("-");
		if (parts.length !== 3) return d;
		return `${parts[2]}.${parts[1]}.${parts[0]}`;
	}

	function statusByNext(nextDate) {
		if (!nextDate) return "ok";
		const days = (new Date(nextDate) - new Date()) / 86400000;
		if (days < 0) return "bad";
		if (days < 60) return "warn";
		return "ok";
	}

	function esc(s) {
		const d = document.createElement("div");
		d.textContent = s || "";
		return d.innerHTML;
	}

	function mapEmployee(row) {
		if (!row) return null;
		const isDeferred = row.note === "DATE_DEFERRED";
		const status = isDeferred ? "bad_star" : statusByNext(row.next_check_date);
		return {
			id: row.id,
			last: row.last_name || "",
			fio: row.full_name || "",
			work: row.workplace_name || row.workplace_code || "",
			pos: row.position || "",
			group: row.electrical_safety_group || "",
			lastCheck: row.last_check_date || "",
			next: row.next_check_date || "",
			period: row.check_period_years || 1,
			status: status,
			rights: Array.isArray(row.rights)
				? row.rights.map((r) => {
					const name = r.name || r.protocol_text || "";
					return DB_TO_UI_RIGHTS[name] || name;
				}).filter(Boolean)
				: [],
			knowledge_scope_code: row.knowledge_scope_code || "",
			personnel_category: row.personnel_category || "",
			last_result: row.last_result || ""
		};
	}

	window.searchWorker = async function (q, ctx) {
		const box = byId(ctx === "quick" ? "quickSuggest" : "protocolSuggest");
		if (!box) return;
		if (!q || q.length < 2) { box.classList.remove("active"); return; }
		try {
			const rows = await api.employees.searchByLastName(q);
			searchCache = (rows || []).map(mapEmployee);
			box.innerHTML = searchCache.length
				? searchCache.map((w) => `<div class="suggest-item" onclick="pickWorker(${w.id}, '${ctx}')"><div><b>${esc(w.fio)}</b><span>${esc(w.work)} · ${esc(w.pos)}</span></div><span class="status ${w.status}">${fmt(w.next)}</span></div>`).join("")
				: '<div class="suggest-item"><span>Ничего не найдено</span></div>';
			box.classList.add("active");
		} catch (e) {
			box.innerHTML = `<div class="suggest-item"><span>Ошибка: ${esc(e.message)}</span></div>`;
			box.classList.add("active");
		}
	};

	window.pickWorker = function (id, ctx) {
		window.selectWorker(id);
		const pb = byId("protocolSuggest");
		const qb = byId("quickSuggest");
		if (pb) pb.classList.remove("active");
		if (qb) qb.classList.remove("active");
		if (ctx === "quick") window.go("protocol");
	};

	window.selectWorker = async function (id) {
		let w = searchCache.find((x) => x && x.id === id);
		try {
			const full = await api.employees.getById(id);
			if (full) w = mapEmployee(full);
		} catch (e) {}
		if (!w) { toast("Не удалось загрузить работника"); return; }
		window.currentWorker = w;
		setVal("workerSearch", w.fio);
		const sel = byId("selectedWorker");
		if (sel) {
			const initials = (w.fio || "?").split(" ").map((x) => x[0] || "").slice(0, 2).join("");
			sel.innerHTML = `<div class="avatar">${esc(initials)}</div><div><b>${esc(w.fio)}</b><p class="muted" style="margin:4px 0 0">${esc(w.work)} · ${esc(w.pos)}</p></div>`;
		}
		const metaPairs = [["mw", w.work], ["mp", w.pos], ["mg", w.group], ["mlast", fmt(w.lastCheck)], ["mperiod", w.period + " год(а)"], ["mnext", fmt(w.next)]];
		metaPairs.forEach(([elId, val]) => { const el = byId(elId); if (el) el.textContent = val; });
		if (w.group) setVal("groupSelect", w.group);
		if (w.knowledge_scope_code) setVal("knowledgeScope", w.knowledge_scope_code);
		if (w.personnel_category) setVal("personnelCategory", w.personnel_category);
		if (w.last_result) setVal("previousMark", `${w.group} группа по ЭБ, ${w.last_result}`);
		if (typeof window.renderRights === "function") window.renderRights();
		if (typeof window.applyKnowledgeScope === "function" && w.knowledge_scope_code) window.applyKnowledgeScope();
		if (typeof window.calcNextDate === "function") window.calcNextDate();
		if (typeof window.previewProtocol === "function") window.previewProtocol();
	};

	function collectRightsText() {
		if (typeof window.protocolRightsText === "function") {
			const t = window.protocolRightsText();
			return t === "—" ? "" : t;
		}
		return "";
	}

	function buildProtocolForm() {
		const w = window.currentWorker || {};
		return {
			employee_id: w.id || null, protocol_number: Number(getVal("protocolNo", "")) || null,
			check_date: getVal("checkDate", ""), next_check_date: getVal("nextDate", ""),
			check_period_years: w.period || 1, full_name_snapshot: w.fio || getVal("workerSearch", ""),
			workplace_snapshot: w.work || "", position_snapshot: w.pos || "",
			reason: getVal("reasonSelect", ""), knowledge_scope_code: getVal("knowledgeScope", ""),
			instructions_text: getVal("instructionsText", ""), personnel_category: getVal("personnelCategory", ""),
			electrical_safety_group: getVal("groupSelect", ""),
			result_eb: getVal("ebMark", ""), result_ot: getVal("otMark", ""), result_pb: getVal("pbMark", ""),
			result_other: getVal("otherMark", ""), final_result: getVal("finalMark", ""),
			duplicate_duration: getVal("duplicateDuration", ""), voltage_category: getVal("voltageCategory", ""),
			commission_name: getVal("commissionName", ""),
			chairman_position: getVal("chairmanPosition", ""), chairman_name: getVal("chairmanName", ""),
			member_1_position: getVal("member1Position", ""), member_1_name: getVal("member1Name", ""),
			member_2_position: getVal("member2Position", ""), member_2_name: getVal("member2Name", ""),
			member_3_position: getVal("member3Position", ""), member_3_name: getVal("member3Name", ""),
			rights_text: collectRightsText()
		};
	}
	window.buildProtocolForm = buildProtocolForm;

	function validateProtocolForm() {
		const required = [
			{ id: "protocolNo", label: "номер протокола", check: (v) => v && Number(v) > 0 },
			{ id: "checkDate", label: "дата проверки" },
			{ id: "reasonSelect", label: "причина проверки" },
			{ id: "commissionName", label: "наименование комиссии" },
			{ id: "chairmanName", label: "ФИО председателя" },
			{ id: "knowledgeScope", label: "объём знаний" }
		];
		const errors = [];
		required.forEach(r => {
			const el = document.getElementById(r.id);
			const val = el ? el.value.trim() : "";
			const ok = r.check ? r.check(val) : !!val;
			if (el) {
				el.style.borderColor = ok ? "" : "var(--danger)";
				el.style.boxShadow = ok ? "" : "0 0 0 2px rgba(214,69,69,.25)";
			}
			if (!ok) errors.push(r.label);
		});
		return errors;
	}

	function clearValidationHighlights() {
		["protocolNo","checkDate","reasonSelect","commissionName","chairmanName","knowledgeScope"].forEach(id => {
			const el = document.getElementById(id);
			if (el) { el.style.borderColor = ""; el.style.boxShadow = ""; }
		});
	}

	window.saveProtocol = async function () {
		if (!window.currentWorker) { toast("Сначала выберите работника"); return; }
		clearValidationHighlights();
		const errors = validateProtocolForm();
		if (errors.length) { toast("Заполните: " + errors.join(", ")); return; }
		const form = buildProtocolForm();
		try {
			const res = await api.protocols.save(form);
			saveProtocolDefaults();
			const fileName = res.docx_path ? res.docx_path.split(/[\\/]/).pop() : "";
			const open = await themedConfirm(
				"Протокол сохранён",
				`Протокол №${res.protocol_number}/${res.protocol_year} ${form.full_name_snapshot}\nФайл: ${fileName}\n\nОткрыть файл?`
			);
			if (open && res.docx_path) {
				await api.shell.openFile(res.docx_path);
			}
			await refreshProtocolNumber();
			await window.renderEmployees();
			await renderJournal();
		} catch (e) { toast("Ошибка сохранения: " + e.message); }
	};

	window.editingRefIds = {
		department: null,
		commission: null,
		chairman: null,
		member: null,
		workRight: null,
		knowledgeScope: null
	};

	function addCancelButton(type, onCancel) {
		removeCancelButton(type);
		let btn = null;
		if (type === "department") btn = byId("btnSaveDept");
		else if (type === "commission") btn = byId("btnSaveComm");
		else if (type === "chairman") btn = byId("btnSaveChairman");
		else if (type === "member") btn = byId("btnSaveMember");
		else if (type === "workRight") btn = byId("btnSaveRight");
		else if (type === "knowledgeScope") btn = byId("btnSaveScope");
		
		if (btn) {
			const cancel = document.createElement("button");
			cancel.type = "button";
			cancel.className = "ghost";
			cancel.id = `btnCancel_${type}`;
			cancel.textContent = "Отмена";
			cancel.onclick = onCancel;
			cancel.style.marginLeft = "8px";
			btn.parentNode.insertBefore(cancel, btn.nextSibling);
		}
	}

	function removeCancelButton(type) {
		const cancel = byId(`btnCancel_${type}`);
		if (cancel) cancel.remove();
	}

	window.editRef = function (type, id) {
		if (!allRefs) return;
		window.editingRefIds[type] = id;
		
		if (type === "department") {
			const d = allRefs.departments.find(x => x.id === id);
			if (d) {
				setVal("newDeptCode", d.code || "");
				setVal("newDeptName", d.name || "");
				if (byId("hideDeptCode")) byId("hideDeptCode").checked = !!d.hide_code_in_protocol;
				byId("btnSaveDept").textContent = "Сохранить";
				addCancelButton("department", () => window.resetRefEdit("department"));
			}
		} else if (type === "chairman") {
			const c = allRefs.chairmen.find(x => x.id === id);
			if (c) {
				setVal("newChairName", c.full_name || "");
				setVal("newChairPos", c.position || "");
				byId("chairmanFormTitle").textContent = "Редактировать председателя";
				byId("btnSaveChairman").textContent = "Сохранить";
				addCancelButton("chairman", () => window.resetRefEdit("chairman"));
			}
		} else if (type === "member") {
			const m = allRefs.members.find(x => x.id === id);
			if (m) {
				setVal("newMemberName", m.full_name || "");
				setVal("newMemberPos", m.position || "");
				byId("memberFormTitle").textContent = "Редактировать члена комиссии";
				byId("btnSaveMember").textContent = "Сохранить";
				addCancelButton("member", () => window.resetRefEdit("member"));
			}
		} else if (type === "commission") {
			const c = allRefs.commissions.find(x => x.id === id);
			if (c) {
				setVal("newCommName", c.name || "");
				setVal("newCommChairman", c.chairman_id || "");
				setVal("newCommMember1", c.member_1_id || "");
				setVal("newCommMember2", c.member_2_id || "");
				setVal("newCommMember3", c.member_3_id || "");
				byId("commFormTitle").textContent = "Редактировать комиссию";
				byId("btnSaveComm").textContent = "Сохранить";
				addCancelButton("commission", () => window.resetRefEdit("commission"));
			}
		} else if (type === "workRight") {
			const r = allRefs.workRights.find(x => x.id === id);
			if (r) {
				setVal("newRightName", r.name || "");
				setVal("newRightText", r.protocol_text || "");
				byId("btnSaveRight").textContent = "Сохранить";
				addCancelButton("workRight", () => window.resetRefEdit("workRight"));
			}
		} else if (type === "knowledgeScope") {
			const s = allRefs.knowledgeScopes.find(x => x.id === id);
			if (s) {
				setVal("newScopeCode", s.code || "");
				setVal("newScopeName", s.name || "");
				setVal("newScopeInstructions", s.instructions_text || "");
				byId("btnSaveScope").textContent = "Сохранить";
				addCancelButton("knowledgeScope", () => window.resetRefEdit("knowledgeScope"));
			}
		}
	};

	window.resetRefEdit = function (type) {
		window.editingRefIds[type] = null;
		removeCancelButton(type);
		
		if (type === "department") {
			setVal("newDeptCode", "");
			setVal("newDeptName", "");
			if (byId("hideDeptCode")) byId("hideDeptCode").checked = false;
			byId("btnSaveDept").textContent = "+ Добавить";
		} else if (type === "chairman") {
			setVal("newChairName", "");
			setVal("newChairPos", "");
			byId("chairmanFormTitle").textContent = "Добавить председателя";
			byId("btnSaveChairman").textContent = "Добавить";
		} else if (type === "member") {
			setVal("newMemberName", "");
			setVal("newMemberPos", "");
			byId("memberFormTitle").textContent = "Добавить члена комиссии";
			byId("btnSaveMember").textContent = "Добавить";
		} else if (type === "commission") {
			setVal("newCommName", "");
			setVal("newCommChairman", "");
			setVal("newCommMember1", "");
			setVal("newCommMember2", "");
			setVal("newCommMember3", "");
			byId("commFormTitle").textContent = "Добавить комиссию";
			byId("btnSaveComm").textContent = "Сохранить комиссию";
		} else if (type === "workRight") {
			setVal("newRightName", "");
			setVal("newRightText", "");
			byId("btnSaveRight").textContent = "Добавить";
		} else if (type === "knowledgeScope") {
			setVal("newScopeCode", "");
			setVal("newScopeName", "");
			setVal("newScopeInstructions", "");
			byId("btnSaveScope").textContent = "Добавить объем знаний";
		}
	};

	window.addDepartment = async function () {
		const code = getVal("newDeptCode", "").trim();
		const name = getVal("newDeptName", "").trim();
		const hide = byId("hideDeptCode") ? byId("hideDeptCode").checked : false;
		if (!name) { toast("Введите название подразделения"); return; }
		try {
			const id = window.editingRefIds.department;
			await api.referencesEdit.saveDepartment({ id, code: code || null, name, hide_code_in_protocol: hide ? 1 : 0 });
			window.resetRefEdit("department");
			await renderRefs();
			toast(id ? "Подразделение обновлено" : "Подразделение сохранено");
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	window.addChairman = async function () {
		const name = getVal("newChairName", "").trim();
		const pos = getVal("newChairPos", "").trim();
		if (!name || !pos) { toast("Заполните ФИО и должность"); return; }
		try {
			const id = window.editingRefIds.chairman;
			await api.referencesEdit.saveChairman({ id, full_name: name, position: pos });
			window.resetRefEdit("chairman");
			await renderRefs();
			await loadReferences();
			toast(id ? "Председатель обновлен" : "Председатель добавлен");
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	window.addMember = async function () {
		const name = getVal("newMemberName", "").trim();
		const pos = getVal("newMemberPos", "").trim();
		if (!name || !pos) { toast("Заполните ФИО и должность"); return; }
		try {
			const id = window.editingRefIds.member;
			await api.referencesEdit.saveMember({ id, full_name: name, position: pos });
			window.resetRefEdit("member");
			await renderRefs();
			await loadReferences();
			toast(id ? "Член комиссии обновлен" : "Член комиссии добавлен");
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	window.addWorkRight = async function () {
		const name = getVal("newRightName", "").trim();
		const text = getVal("newRightText", "").trim();
		if (!name || !text) { toast("Заполните название и текст в протоколе"); return; }
		try {
			const id = window.editingRefIds.workRight;
			await api.referencesEdit.saveWorkRight({ id, name, protocol_text: text });
			window.resetRefEdit("workRight");
			await renderRefs();
			await loadReferences();
			toast(id ? "Право работы обновлено" : "Право работы добавлено");
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	window.addKnowledgeScope = async function () {
		const code = getVal("newScopeCode", "").trim();
		const name = getVal("newScopeName", "").trim();
		const inst = getVal("newScopeInstructions", "").trim();
		if (!code || !name) { toast("Заполните код и наименование"); return; }
		try {
			const id = window.editingRefIds.knowledgeScope;
			await api.referencesEdit.saveKnowledgeScope({ id, code, name, instructions_text: inst });
			window.resetRefEdit("knowledgeScope");
			await renderRefs();
			await loadReferences();
			toast(id ? "Объем знаний обновлен" : "Объем знаний добавлен");
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	function saveProtocolDefaults() {
		localStorage.setItem("eb_proto_commission", getVal("commissionName"));
		localStorage.setItem("eb_proto_scope", getVal("knowledgeScope"));
	}

	function restoreProtocolDefaults() {
		const comm = localStorage.getItem("eb_proto_commission");
		const scope = localStorage.getItem("eb_proto_scope");
		if (comm) setVal("commissionName", comm);
		if (scope) setVal("knowledgeScope", scope);
		if (comm && typeof window.pickCommission === "function") window.pickCommission(comm);
		if (scope && typeof window.applyKnowledgeScope === "function") window.applyKnowledgeScope();
	}

	async function refreshProtocolNumber() {
		try {
			const checkDate = getVal("checkDate", "") || new Date().toISOString().slice(0, 10);
			const res = await api.protocols.getNextNumber(checkDate);
			if (res && res.nextNumber) { setVal("protocolNo", res.nextNumber); if (typeof window.previewProtocol === "function") window.previewProtocol(); }
		} catch (e) { console.warn("refreshProtocolNumber:", e.message); }
	}
	window.refreshProtocolNumber = refreshProtocolNumber;

	window.renderEmployees = async function () {
		const tbody = byId("employeesRows");
		if (!tbody) return;
		try {
			const rows = await api.employees.listAll();
			const list = (rows || []).map(mapEmployee).filter((w) => w != null).sort((a, b) => a.fio.localeCompare(b.fio, "ru"));
			if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">База пуста. Импортируйте данные из Excel.</td></tr>'; return; }
		tbody.innerHTML = list.map((w) => {
				const label = w.status === "bad_star" ? "Просрочено*" : w.status === "bad" ? "просрочено" : w.status === "warn" ? "скоро" : "актуально";
				return `<tr>
					<td style="vertical-align:middle;text-align:left"><b>${esc(w.fio)}</b></td>
					<td style="vertical-align:middle;text-align:left">${esc(w.work)}</td>
					<td style="vertical-align:middle;text-align:left">${esc(w.pos)}</td>
					<td style="vertical-align:middle;text-align:left">${esc(w.group)}</td>
					<td style="vertical-align:middle;text-align:left">${fmt(w.lastCheck)}</td>
					<td style="vertical-align:middle;text-align:left">${fmt(w.next)}</td>
					<td style="vertical-align:middle;text-align:center"><span class="status ${w.status}">${label}</span></td>
					<td style="white-space:nowrap;width:1%;vertical-align:middle">
						<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
							<button class="ghost" style="padding:3px 8px;font-size:11px" onclick="go('protocol');selectWorker(${w.id})">Протокол</button>
							<button class="ghost" style="padding:3px 8px;font-size:11px" onclick="editEmployee(${w.id})">Редактировать</button>
							<button class="ghost" style="padding:3px 8px;font-size:11px;color:var(--danger)" onclick="deleteEmployee(${w.id})">Удалить</button>
						</div>
					</td>
				</tr>`;
			}).join("");
		} catch (e) { tbody.innerHTML = `<tr><td colspan="8" class="muted">Ошибка: ${esc(e.message)}</td></tr>`; }
	};

	window.filterEmployees = function (q) {
		const tbody = byId("employeesRows");
		if (!tbody) return;
		const rows = tbody.querySelectorAll("tr");
		const cleanQ = q.trim().toLowerCase();
		
		for (const r of rows) {
			const text = r.textContent.toLowerCase();
			if (text.includes(cleanQ)) {
				r.style.display = "";
			} else {
				r.style.display = "none";
			}
		}
	};

	window.openFile = async function (filePath) {
		try {
			await api.shell.openFile(filePath);
		} catch (e) {
			toast("Не удалось открыть файл: " + e.message);
		}
	};

	async function renderJournal() {
		const table = document.querySelector("#journal table");
		if (!table) return;
		try {
			const rows = await api.journal.list({});
			const head = "<tr><th>№</th><th>ФИО</th><th>Дата</th><th>Группа</th><th>Оценка</th><th>Следующая</th><th>Файл</th></tr>";
			if (!rows || !rows.length) { table.innerHTML = head + '<tr><td colspan="7" class="muted">Пока нет протоколов</td></tr>'; return; }
			table.innerHTML = head + rows.map((r) => {
				const docxLink = r.docx_path ? `<a href="#" style="color:var(--notion-blue);text-decoration:underline" onclick="openFile('${r.docx_path.replace(/\\/g, '\\\\')}')">DOCX</a>` : "—";
				return `<tr><td>${r.protocol_number}</td><td>${esc(r.full_name_snapshot)}</td><td>${fmt(r.check_date)}</td><td>${esc(r.electrical_safety_group)}</td><td><span class="status ok">${esc(r.final_result)}</span></td><td>${fmt(r.next_check_date)}</td><td>${docxLink}</td><td style="white-space:nowrap;text-align:right;width:1%"><button class="ghost" style="color:var(--danger);border-color:var(--danger);padding:4px 10px;font-size:12px" onclick="deleteJournalRecord(${r.id},'${esc(r.full_name_snapshot)}',${r.protocol_number})">Удалить</button></td></tr>`;
			}).join("");
		} catch (e) { console.warn("renderJournal:", e.message); }
	}
	window.renderJournal = renderJournal;

	window.deleteJournalRecord = async function (id, fio, number) {
		const result = await themedConfirm(
			"Удаление протокола",
			`Для удаления протокола №${number} (${fio}) введите слово УДАЛИТЬ:`,
			"УДАЛИТЬ"
		);
		if (result !== "УДАЛИТЬ") {
			if (result !== false) toast("Удаление отменено: введено неверное слово");
			return;
		}
		try {
			await api.journal.delete(id);
			toast(`Протокол №${number} (${fio}) удалён`);
			await renderJournal();
			await loadDashboard();
		} catch (e) {
			toast("Ошибка удаления: " + e.message);
		}
	};

	const origGo = window.go;
	window.go = function (id) {
		if (typeof origGo === "function") origGo(id);
		if (id === "protocol") { refreshProtocolNumber(); setTimeout(restoreProtocolDefaults, 200); }
		if (id === "journal") renderJournal();
		if (id === "employees") window.renderEmployees();
		if (id === "refs") renderRefs();
		if (id === "dashboard") loadDashboard();
		if (id === "schedule") renderSchedule();
		if (id === "settings") loadAppSettings();
	};
	document.querySelectorAll(".nav button").forEach((b) => { b.onclick = () => window.go(b.dataset.view); });

	function fillSelect(id, values, keepFirstEmpty = true) {
		const sel = byId(id);
		if (!sel || !values || !values.length) return;
		const current = sel.value;
		const opts = (keepFirstEmpty ? [""] : []).concat(values);
		sel.innerHTML = opts.map((v) => `<option>${esc(v)}</option>`).join("");
		if (values.includes(current)) sel.value = current;
	}

	async function loadReferences() {
		try {
			const refs = await api.references.getAll();
			if (!refs) return;
			allRefs = refs;
			window._allRefs = refs;

			const chairmenNames = (refs.chairmen || []).map((c) => c.full_name);
			const chairmenPos = Array.from(new Set((refs.chairmen || []).map((c) => c.position)));
			const memberNames = (refs.members || []).map((m) => m.full_name);
			const memberPos = Array.from(new Set((refs.members || []).map((m) => m.position)));
			const scopes = (refs.knowledgeScopes || []).map((s) => s.code);
			if (chairmenNames.length) { fillSelect("chairmanName", chairmenNames); fillSelect("chairmanPosition", chairmenPos); }
			if (memberNames.length) { ["member1Name", "member2Name", "member3Name"].forEach((id) => fillSelect(id, memberNames)); ["member1Position", "member2Position", "member3Position"].forEach((id) => fillSelect(id, memberPos)); }
			if (scopes.length) { fillSelect("knowledgeScope", scopes); fillSelect("empScope", scopes); }
			const depts = (refs.departments || []).map((d) => d.name);
			if (depts.length) fillSelect("empWorkplace", depts);

			window._workRightsFromDb = (refs.workRights || []).map(r => {
				const uiName = DB_TO_UI_RIGHTS[r.name] || r.name;
				return { id: r.id, name: r.name, protocol_text: r.protocol_text, uiName: uiName };
			});
			if (typeof window.renderRights === "function") window.renderRights();

			const commissionsList = (refs.commissions || []).map(c => c.name);
			fillSelect("commissionName", commissionsList);
			
			const fillSelectWithIds = (id, optionsList) => {
				const sel = byId(id);
				if (!sel) return;
				sel.innerHTML = '<option></option>' + optionsList.map(opt => `<option value="${opt.id}">${esc(opt.full_name)} (${esc(opt.position)})</option>`).join("");
			};
			
			fillSelectWithIds("newCommChairman", refs.chairmen || []);
			fillSelectWithIds("newCommMember1", refs.members || []);
			fillSelectWithIds("newCommMember2", refs.members || []);
			fillSelectWithIds("newCommMember3", refs.members || []);
		} catch (e) { console.warn("loadReferences:", e.message); }
	}

	// === Dashboard ===
	window.loadDashboard = async function () {
		try {
			const stats = await api.dashboard.stats();
			const y = stats.year || new Date().getFullYear();
			const el = (id) => byId(id);
			if (el("dashProtocols")) el("dashProtocols").textContent = stats.journalCount;
			if (el("dashMaxNum")) el("dashMaxNum").textContent = stats.maxNumber ? `следующий №${stats.maxNumber + 1}` : "—";
			if (el("dashUpcoming")) el("dashUpcoming").textContent = stats.upcoming;
			if (el("dashOverdue")) el("dashOverdue").textContent = stats.overdue;
			if (el("dashTotal")) el("dashTotal").textContent = stats.total;
			if (el("dashYear")) el("dashYear").textContent = y;
			
			if (el("dashTableOverdue")) el("dashTableOverdue").textContent = stats.overdue;
			if (el("dashTableUpcoming")) el("dashTableUpcoming").textContent = stats.upcoming;
			if (el("dashTableActual")) el("dashTableActual").textContent = stats.actual || 0;

			// Render mini-chart dynamically if monthCounts is present
			const chart = byId("dashChart");
			if (chart && Array.isArray(stats.monthCounts)) {
				const maxVal = Math.max(...stats.monthCounts, 1);
				chart.innerHTML = stats.monthCounts.map((count) => {
					const pct = Math.round((count / maxVal) * 80) + 15; // scale height (15% to 95%)
					return `<div class="mini-bar" style="height:${pct}%"><span>${count}</span></div>`;
				}).join("");
			}
		} catch (e) { console.warn("loadDashboard:", e.message); }
	};

	// === Import Excel ===
	window.doImportExcel = async function () {
		try {
			toast("Выберите Excel-файл...");
			const report = await api.import.excel();
			if (!report || report.canceled) return;
			let msg = `Импорт завершён: +${report.employeesCreated} создано, ${report.employeesUpdated} обновлено, прав: ${report.workRights}`;
			if (report.errors && report.errors.length) {
				const modal = document.getElementById("importErrorsModal");
				const summary = document.getElementById("importErrorsSummary");
				const body = document.getElementById("importErrorsBody");
				summary.textContent = `Найдено ошибок: ${report.errors.length}`;
				body.innerHTML = report.errors.map(e =>
					`<div style="padding:8px 10px;border-bottom:1px solid var(--notion-border-soft);font-size:13px;color:var(--notion-text)">${esc(e)}</div>`
				).join("");
				modal.classList.add("active");
			} else {
				toast(msg);
			}
			await loadReferences();
			await window.renderEmployees();
			await loadDashboard();
		} catch (e) { toast("Ошибка импорта: " + e.message); }
	};

	// === Add & Edit Employee ===
	window.editingEmployeeId = null;

	window.showAddEmployeeModal = function () {
		if (!allRefs || !allRefs.departments || !allRefs.departments.length) {
			toast("Заполните подразделения в разделе «Справочники»");
		}
		if (!allRefs || !allRefs.knowledgeScopes || !allRefs.knowledgeScopes.length) {
			toast("Заполните объёмы знаний в разделе «Справочники»");
		}
		window.editingEmployeeId = null;
		const modal = byId("addEmployeeModal");
		if (modal) {
			modal.classList.add("active");

			const titleEl = document.querySelector("#addEmployeeModal h3");
			if (titleEl) titleEl.textContent = "Добавить работника";
			
			// Clear fields
			["empLastName", "empFirstName", "empMiddleName", "empWorkplace", "empPosition", "empLastCheck", "empNextCheck"].forEach((id) => setVal(id, ""));
			setVal("empPeriod", "1");
			
			// Populate rights checkboxes in the modal
			const box = byId("empRightsBox");
			if (box && allRefs && allRefs.workRights) {
				box.innerHTML = allRefs.workRights.map(r => 
					`<div class="right-item"><input type="checkbox" data-right-id="${r.id}" id="add_emp_right_${r.id}"><label for="add_emp_right_${r.id}">${esc(r.name)}</label></div>`
				).join("");
			}
		}
	};

	window.editEmployee = async function (id) {
		try {
			const full = await api.employees.getById(id);
			if (!full) return;
			
			window.editingEmployeeId = id;
			
			const titleEl = document.querySelector("#addEmployeeModal h3");
			if (titleEl) titleEl.textContent = "Редактировать работника";
			
			setVal("empLastName", full.last_name || "");
			setVal("empFirstName", full.first_name || "");
			setVal("empMiddleName", full.middle_name || "");
			setVal("empWorkplace", full.workplace_name || full.workplace_code || "");
			setVal("empPosition", full.position || "");
			setVal("empGroup", full.electrical_safety_group || "");
			setVal("empCategory", full.personnel_category || "");
			setVal("empScope", full.knowledge_scope_code || "");
			setVal("empPeriod", full.check_period_years || 1);
			setVal("empLastCheck", full.last_check_date || "");
			setVal("empNextCheck", full.next_check_date || "");
			
			const modal = byId("addEmployeeModal");
			if (modal) modal.classList.add("active");
			
			const box = byId("empRightsBox");
			if (box && allRefs && allRefs.workRights) {
				const checkedIds = (full.rights || []).map(r => r.id);
				box.innerHTML = allRefs.workRights.map(r => 
					`<div class="right-item"><input type="checkbox" data-right-id="${r.id}" id="add_emp_right_${r.id}" ${checkedIds.includes(r.id) ? 'checked' : ''}><label for="add_emp_right_${r.id}">${esc(r.name)}</label></div>`
				).join("");
			}
		} catch (e) {
			toast("Ошибка загрузки данных: " + e.message);
		}
	};

	window.closeAddEmployeeModal = function () {
		const modal = byId("addEmployeeModal");
		if (modal) modal.classList.remove("active");
		window.editingEmployeeId = null;
		const titleEl = document.querySelector("#addEmployeeModal h3");
		if (titleEl) titleEl.textContent = "Добавить работника";
	};

	window.submitAddEmployee = async function () {
		let lastCheck = getVal("empLastCheck") || null;
		let nextCheck = getVal("empNextCheck") || null;
		let dateDeferred = false;

		if (!lastCheck) {
			lastCheck = "2000-01-01";
		}

		if (lastCheck === "2000-01-01") {
			const today = new Date();
			today.setDate(today.getDate() + 14);
			nextCheck = today.toISOString().slice(0, 10);
			dateDeferred = true;
		} else if (!nextCheck) {
			const cat = getVal("empCategory") || "";
			const period = cat.includes("Административно") ? 3 : 1;
			const d = new Date(lastCheck + "T00:00:00");
			d.setFullYear(d.getFullYear() + period);
			nextCheck = d.toISOString().slice(0, 10);
		}

		const today = new Date().toISOString().slice(0, 10);
		if (nextCheck && nextCheck < today) {
			const deferred = new Date();
			deferred.setDate(deferred.getDate() + 14);
			nextCheck = deferred.toISOString().slice(0, 10);
			dateDeferred = true;
		}

		const employee = {
			last_name: getVal("empLastName").trim(),
			first_name: getVal("empFirstName").trim(),
			middle_name: getVal("empMiddleName").trim() || null,
			full_name: [getVal("empLastName").trim(), getVal("empFirstName").trim(), getVal("empMiddleName").trim()].filter(Boolean).join(" "),
			workplace_code: getVal("empWorkplace").trim() || null,
			workplace_name: getVal("empWorkplace").trim() || null,
			position: getVal("empPosition").trim() || null,
			electrical_safety_group: getVal("empGroup") || null,
			personnel_category: getVal("empCategory") || null,
			knowledge_scope_code: getVal("empScope").trim() || null,
			last_check_date: lastCheck,
			next_check_date: nextCheck,
			check_period_years: Number(getVal("empPeriod", "1")) || 1,
			note: dateDeferred ? "DATE_DEFERRED" : null,
			rights: [...document.querySelectorAll("#empRightsBox input:checked")].map(i => Number(i.dataset.rightId))
		};
		if (!employee.last_name || !employee.first_name) { toast("Укажите фамилию и имя"); return; }
		try {
			if (window.editingEmployeeId) {
				await api.employees.update(window.editingEmployeeId, employee);
				toast("Работник обновлен");
			} else {
				await api.employees.create(employee);
				toast("Работник добавлен");
			}
			closeAddEmployeeModal();
			["empLastName", "empFirstName", "empMiddleName", "empWorkplace", "empPosition", "empLastCheck", "empNextCheck"].forEach((id) => setVal(id, ""));
			setVal("empPeriod", "1");
			await window.renderEmployees();
			await loadDashboard();
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	window.deleteEmployee = async function (id) {
		if (!await themedConfirm("Удаление работника", "Вы уверены, что хотите удалить работника?")) return;
		try {
			await api.employees.delete(id);
			toast("Работник удален");
			await window.renderEmployees();
			await loadDashboard();
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	window.exportEmployeesExcel = async function () {
		try {
			const res = await api.employees.exportExcel();
			if (!res || res.canceled) return;
			toast(`Экспортировано ${res.count} работников в ${res.filePath.split(/[\\/]/).pop()}`);
		} catch (e) { toast("Ошибка экспорта: " + e.message); }
	};

	window.createEmployeesTemplate = async function () {
		try {
			const res = await api.employees.createTemplate();
			if (!res || res.canceled) return;
			toast("Шаблон создан: " + res.filePath.split(/[\\/]/).pop());
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	// === Reference tables from DB ===
	window.renderRefs = async function () {
		try {
			const refs = await api.references.getAll();
			if (!refs) return;
			allRefs = refs;
			const deptTbody = byId("departmentsRows");
			if (deptTbody) {
				deptTbody.innerHTML = (refs.departments || []).map((d) =>
					`<tr><td>${esc(d.code) || '<span class="dept-code-empty">пусто</span>'}</td><td>${esc(d.name)}</td><td>${d.hide_code_in_protocol ? esc(d.name) : (esc(d.code) + ' — ' + esc(d.name))}</td><td><span class="status ok">активно</span></td><td style="white-space:nowrap;text-align:right;width:1%"><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="editRef('department',${d.id})">Ред.</button><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="deleteRef('department',${d.id})">Удалить</button></td></tr>`
				).join("") || '<tr><td colspan="5" class="muted">Нет подразделений</td></tr>';
			}
			const chairTbody = byId("chairmenRows");
			if (chairTbody) {
				chairTbody.innerHTML = (refs.chairmen || []).map((c) =>
					`<tr><td>${esc(c.full_name)}</td><td>${esc(c.position)}</td><td><span class="status ok">активно</span></td><td style="white-space:nowrap;text-align:right;width:1%"><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="editRef('chairman',${c.id})">Ред.</button><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="deleteRef('chairman',${c.id})">Удалить</button></td></tr>`
				).join("") || '<tr><td colspan="4" class="muted">Нет председателей</td></tr>';
			}
			const memberTbody = byId("membersRows");
			if (memberTbody) {
				memberTbody.innerHTML = (refs.members || []).map((m) =>
					`<tr><td>${esc(m.full_name)}</td><td>${esc(m.position)}</td><td><span class="status ok">активно</span></td><td style="white-space:nowrap;text-align:right;width:1%"><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="editRef('member',${m.id})">Ред.</button><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="deleteRef('member',${m.id})">Удалить</button></td></tr>`
				).join("") || '<tr><td colspan="4" class="muted">Нет членов комиссии</td></tr>';
			}
			const scopeTbody = byId("knowledgeScopesRows");
			if (scopeTbody) {
				scopeTbody.innerHTML = (refs.knowledgeScopes || []).map((s) =>
					`<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${esc(s.instructions_text)}</td><td><span class="status ok">активно</span></td><td style="white-space:nowrap;text-align:right;width:1%"><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="editRef('knowledgeScope',${s.id})">Ред.</button><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="deleteRef('knowledgeScope',${s.id})">Удалить</button></td></tr>`
				).join("") || '<tr><td colspan="5" class="muted">Нет объёмов знаний</td></tr>';
			}
			const rightTbody = byId("workRightsRows");
			if (rightTbody) {
				rightTbody.innerHTML = (refs.workRights || []).map((r) =>
					`<tr><td>${esc(r.name)}</td><td>${esc(r.protocol_text)}</td><td><span class="status ok">да</span></td><td style="white-space:nowrap;text-align:right;width:1%"><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="editRef('workRight',${r.id})">Ред.</button><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="deleteRef('workRight',${r.id})">Удалить</button></td></tr>`
				).join("") || '<tr><td colspan="4" class="muted">Нет прав</td></tr>';
			}
			const commTbody = byId("commissionsRows");
			if (commTbody) {
				commTbody.innerHTML = (refs.commissions || []).map((c) =>
					`<tr>
						<td>${esc(c.name)}</td>
						<td>${esc(c.chairman_name)}</td>
						<td>${[c.member_1_name, c.member_2_name, c.member_3_name].filter(Boolean).map(esc).join(', ')}</td>
						<td style="white-space:nowrap;text-align:right;width:1%"><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="editRef('commission',${c.id})">Ред.</button><button class="ghost" style="padding:4px 10px;font-size:12px" onclick="deleteRef('commission',${c.id})">Удалить</button></td>
					</tr>`
				).join("") || '<tr><td colspan="4" class="muted">Нет комиссий</td></tr>';
			}
		} catch (e) { console.warn("renderRefs:", e.message); }
	};

	window.deleteRef = async function (type, id) {
		if (!await themedConfirm("Удаление записи", "Вы уверены, что хотите удалить запись из справочника?")) return;
		try {
			await api.referencesEdit["delete" + type.charAt(0).toUpperCase() + type.slice(1)](id);
			toast("Удалено");
			await renderRefs();
			await loadReferences();
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	window.addCommission = async function () {
		const name = getVal("newCommName", "").trim();
		const chairman_id = Number(getVal("newCommChairman")) || null;
		const member_1_id = Number(getVal("newCommMember1")) || null;
		const member_2_id = Number(getVal("newCommMember2")) || null;
		const member_3_id = Number(getVal("newCommMember3")) || null;
		
		if (!name) { toast("Введите название комиссии"); return; }
		try {
			const id = window.editingRefIds.commission;
			await api.referencesEdit.saveCommission({
				id,
				name,
				chairman_id,
				member_1_id,
				member_2_id,
				member_3_id
			});
			window.resetRefEdit("commission");
			await renderRefs();
			await loadReferences();
			toast(id ? "Комиссия обновлена" : "Комиссия сохранена");
		} catch (e) { toast("Ошибка: " + e.message); }
	};

	window.pickCommission = function (name) {
		if (!allRefs || !allRefs.commissions) return;
		const comm = allRefs.commissions.find(c => c.name === name);
		if (!comm) return;
		
		setVal("chairmanName", comm.chairman_name || "");
		setVal("chairmanPosition", comm.chairman_position || "");
		setVal("member1Name", comm.member_1_name || "");
		setVal("member1Position", comm.member_1_position || "");
		setVal("member2Name", comm.member_2_name || "");
		setVal("member2Position", comm.member_2_position || "");
		setVal("member3Name", comm.member_3_name || "");
		setVal("member3Position", comm.member_3_position || "");
		
		if (typeof window.previewProtocol === "function") window.previewProtocol();
	};

	window.syncCommissionPerson = function (prefix, source, changed) {
		if (!allRefs || !allRefs[source]) return;
		const nameEl = byId(prefix + "Name");
		const posEl = byId(prefix + "Position");
		if (!nameEl || !posEl) return;

		if (changed === "name") {
			const name = nameEl.value;
			const person = allRefs[source].find((p) => p.full_name === name);
			if (person && person.position) {
				posEl.value = person.position;
			}
		} else if (changed === "position") {
			const pos = posEl.value;
			const persons = allRefs[source].filter((p) => p.position === pos);
			if (persons.length === 1) {
				nameEl.value = persons[0].full_name;
			}
		}
		if (typeof window.previewProtocol === "function") window.previewProtocol();
	};

	// === Calendar & Schedule rendering ===
	window.renderSchedule = async function () {
		const cal = byId("calendar");
		if (!cal) return;

		const now = new Date();
		const currentYear = now.getFullYear();
		const select = byId("scheduleYearSelect");

		if (select && select.options.length === 0) {
			const years = [currentYear, currentYear + 1];
			if (now.getMonth() === 0 && now.getDate() === 1) {
				years.push(currentYear + 2);
			}
			select.innerHTML = years.map(y => `<option value="${y}" ${y === currentYear ? "selected" : ""}>${y}</option>`).join("");
		}

		const year = Number(getVal("scheduleYearSelect", currentYear));
		try {
			const employees = await api.employees.listAll();
			const list = (employees || []).map(mapEmployee).filter(w => w && w.next);

			const yearList = list.filter(w => new Date(w.next).getFullYear() === year);

			const months = [
				"Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
				"Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
			];

			const grouped = Array.from({ length: 12 }, () => []);
			for (const w of yearList) {
				const parts = w.next.split("-");
				const monthIdx = parseInt(parts[1], 10) - 1;
				if (monthIdx >= 0 && monthIdx < 12) {
					grouped[monthIdx].push(w);
				}
			}

		cal.innerHTML = months.map((mName, mIdx) => {
				const mList = grouped[mIdx];
				const count = mList.length;
				const clickable = count > 0
					? `<div style="cursor:pointer;text-align:center;padding:18px 0" onclick="showScheduleMonth('${mName}',window._scheduleGrouped[${mIdx}])"><span style="font-size:36px;font-weight:700;color:var(--notion-blue);line-height:1">${count}</span><div style="font-size:12px;color:var(--muted);margin-top:4px">чел.</div></div>`
					: `<div style="text-align:center;padding:18px 0"><span style="font-size:36px;font-weight:700;color:var(--notion-text-faint);line-height:1">0</span><div style="font-size:12px;color:var(--muted);margin-top:4px">нет проверок</div></div>`;
				return `<div class="month">
					<h4 style="margin:0 0 6px">${mName}</h4>
					${clickable}
				</div>`;
			}).join("");
			window._scheduleGrouped = grouped;
		} catch (e) {
			cal.innerHTML = `<div class="muted">Ошибка: ${esc(e.message)}</div>`;
		}
	};

	window.exportScheduleExcel = async function () {
		const year = Number(getVal("scheduleYearSelect", new Date().getFullYear()));
		toast(`Экспорт графика за ${year} год...`);
		try {
			const res = await api.schedule.exportExcel(year);
			if (res && res.ok) {
				toast("График успешно экспортирован: " + res.filePath);
			} else if (res && res.canceled) {
				toast("Экспорт отменен");
			}
		} catch (e) {
			toast("Ошибка экспорта: " + e.message);
		}
	};

	window.exportJournalExcel = async function () {
		toast("Экспорт журнала проверок...");
		try {
			const res = await api.journal.exportExcel();
			if (res && res.ok) {
				toast("Журнал успешно экспортирован: " + res.filePath);
			} else if (res && res.canceled) {
				toast("Экспорт отменен");
			}
		} catch (e) {
			toast("Ошибка экспорта: " + e.message);
		}
	};

	// === Settings Panel ===
	window.loadAppSettings = async function () {
		try {
			const settings = await api.settings.getAll();
			setVal("ftpHost", settings.ftp_host || "");
			setVal("ftpPort", settings.ftp_port || "21");
			setVal("ftpUser", settings.ftp_user || "");
			setVal("ftpPassword", settings.ftp_password || "");
			setVal("ftpPath", settings.ftp_path || "");
			setVal("libreofficePath", settings.libreoffice_path || "");
			
			await refreshDbEncryptionStatus();
		} catch (e) {
			console.warn("loadAppSettings failed:", e.message);
		}
	};

	window.saveAppSettings = async function () {
		const settings = {
			ftp_host: getVal("ftpHost").trim(),
			ftp_port: getVal("ftpPort").trim(),
			ftp_user: getVal("ftpUser").trim(),
			ftp_password: getVal("ftpPassword").trim(),
			ftp_path: getVal("ftpPath").trim(),
			libreoffice_path: getVal("libreofficePath").trim()
		};
		try {
			await api.settings.save(settings);
			if (settings.ftp_password) {
				await api.security.setFtpPassword(settings.ftp_password);
			}
			toast("Настройки сохранены");
		} catch (e) {
			toast("Ошибка сохранения настроек: " + e.message);
		}
	};

	window.testFtpConnection = async function () {
		toast("Проверка подключения к FTP...");
		try {
			const res = await api.sync.test();
			if (res && res.ok) {
				toast("FTP соединение успешно установлено!");
			} else {
				toast("Ошибка подключения: " + (res?.error || "неизвестная ошибка"));
			}
		} catch (e) {
			const msg = e.message || String(e);
			if (msg.includes("ECONNREFUSED")) {
				toast("FTP-сервер недоступен. Проверьте хост и порт.");
			} else if (msg.includes("ENOTFOUND")) {
				toast("Хост FTP не найден. Проверьте адрес.");
			} else if (msg.includes("ETIMEDOUT")) {
				toast("Превышено время ожидания. Проверьте сетевое подключение.");
			} else {
				toast("Ошибка FTP: " + msg.split("\n")[0]);
			}
		}
	};

	window.syncUpload = async function () {
		if (!await themedConfirm("Выгрузка на FTP", "Выгрузить текущую локальную БД на FTP сервер? Это заменит файл на сервере.")) return;
		toast("Выгрузка БД в облако...");
		try {
			const res = await api.sync.upload();
			if (res && res.ok) {
				toast("База данных успешно выгружена!");
				await loadAppSettings();
			} else {
				toast("Ошибка выгрузки: " + (res?.error || "неизвестная ошибка"));
			}
		} catch (e) {
			const msg = e.message || String(e);
			if (msg.includes("ECONNREFUSED")) toast("FTP-сервер недоступен. Проверьте хост и порт.");
			else if (msg.includes("ENOTFOUND")) toast("Хост FTP не найден.");
			else toast("Ошибка FTP: " + msg.split("\n")[0]);
		}
	};

	window.syncDownload = async function () {
		if (!await themedConfirm("Загрузка с FTP", "Скачать БД с FTP сервера и заменить текущую локальную? Локальные изменения будут сохранены в бэкап.")) return;
		toast("Загрузка БД из облака...");
		try {
			const res = await api.sync.download();
			if (res && res.ok) {
				toast("База данных успешно загружена и обновлена!");
				await window.renderEmployees();
				await renderJournal();
				await loadDashboard();
			} else {
				toast("Ошибка загрузки: " + (res?.error || "неизвестная ошибка"));
			}
		} catch (e) {
			const msg = e.message || String(e);
			if (msg.includes("ECONNREFUSED")) toast("FTP-сервер недоступен. Проверьте хост и порт.");
			else if (msg.includes("ENOTFOUND")) toast("Хост FTP не найден.");
			else toast("Ошибка FTP: " + msg.split("\n")[0]);
		}
	};

	window.refreshDbEncryptionStatus = async function () {
		const statusEl = byId("dbEncryptionStatus");
		if (!statusEl) return;
		try {
			const status = await api.security.getStatus();
			if (status.warning) {
				statusEl.textContent = "⚠️ " + status.warning;
				statusEl.className = "status bad";
			} else if (status.dbPasswordEnabled) {
				statusEl.textContent = "ВКЛЮЧЕНО (База зашифрована)";
				statusEl.className = "status ok";
			} else {
				statusEl.textContent = "ВЫКЛЮЧЕНО (База не зашифрована)";
				statusEl.className = "status warn";
			}
		} catch (e) {
			statusEl.textContent = "Ошибка определения";
			statusEl.className = "status bad";
		}
	};

	window.enableDbEncryption = async function () {
		const pwd = getVal("dbPassword").trim();
		if (!pwd) { toast("Введите пароль"); return; }
		try {
			await api.security.enableDbPassword(pwd);
			toast("Шифрование базы данных успешно включено");
			setVal("dbPassword", "");
			await refreshDbEncryptionStatus();
		} catch (e) {
			toast("Ошибка шифрования: " + e.message);
		}
	};

	window.disableDbEncryption = async function () {
		if (!await themedConfirm("Отключение шифрования", "Вы действительно хотите расшифровать базу данных?")) return;
		try {
			await api.security.disableDbPassword();
			toast("Шифрование базы данных успешно отключено");
			setVal("dbPassword", "");
			await refreshDbEncryptionStatus();
		} catch (e) {
			toast("Ошибка отключения шифрования: " + e.message);
		}
	};

	async function init() {
		await loadReferences();
		await window.renderEmployees();
		await renderJournal();
		await refreshProtocolNumber();
		await renderRefs();
		await loadDashboard();
		console.log("Интерфейс связан с бэкендом");
	}

	window.generatePreviewDocx = async function () {
		clearValidationHighlights();
		const errors = validateProtocolForm();
		if (errors.length) { toast("Для предпросмотра заполните: " + errors.join(", ")); return; }
		if (!window.currentWorker) { toast('Сначала выберите работника'); return; }
		const form = buildProtocolForm();
		try {
			const res = await api.protocols.preview(form);
			if (res && res.docx_path) {
				await api.shell.openFile(res.docx_path);
			}
		} catch (e) { toast('Ошибка формирования DOCX: ' + e.message); }
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();

