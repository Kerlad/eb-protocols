# OpenCode Prompt — EB Protocols App Improvements (EN)

<aside>
🧠

Model context budget: ~250k tokens. Work incrementally: read only the files/sections you need for the current task, keep the diff surface small, and verify after each task instead of loading the whole repo at once. All USER-FACING strings must stay in Russian; this prompt is in English only for you.

</aside>

# Role & Objective

You are a senior Electron + Node.js engineer. You are improving an existing desktop app called **«Протоколы ЭБ»** (electrical-safety knowledge-check protocols). Implement the 5 tasks below with **minimal, targeted edits**. Do NOT refactor unrelated code, do NOT rename existing IPC channels, and do NOT change the `preload.js` contract except by *adding* new bindings.

# Tech Stack & Architecture

- **Electron** app. Main process: `app/main.js` (registers `ipcMain.handle(...)` channels). Preload bridge: `app/preload.js` (exposes `ebApi` via `contextBridge`, each method calls `invoke("channel")`).
- **Renderer**: `app/renderer/index.html` (markup + a large inline `<script>` with UI helpers like `showScheduleMonth`, `applyKnowledgeScope`, `previewProtocol`) and `app/renderer/app.js` (`renderJournal`, `showUpcomingModal`, `showOverdueModal`, `mapEmployee`, export helpers, `deleteJournalRecord`, `buildProtocolForm`).
- **Backend**: `backend/import/excelImporter.js` (ExcelJS import/export), `backend/db/repositories/journalRepository.js` (SQLite via better-sqlite3), `backend/protocol/protocolService.js` (`getProtocolDraft`, `saveProtocol`, `computeNextCheckDate`), `backend/protocol/placeholderMap.js` (`buildProtocolPlaceholderMap`), `backend/protocol/docxGenerator.js` (docxtemplater, delimiters `{`/`}`).
- **Template**: `templates/Протокол.docx` (filename is Cyrillic; may be stored URL-encoded on disk).

**Status model** (from `mapEmployee` in `app.js`): `"bad"` = Просрочено (next_check_date < today); `"bad_star"` = Просрочено* (row.note === 'DATE_DEFERRED'); `"warn"` = скоро; `"ok"` = актуально. On import, `bad_star` rows have `next_check_date` shifted +14 days into the future (see `excelImporter.js`).

# Global Rules

1. Keep all user-visible text in **Russian**, matching the existing UI tone.
2. Only add new IPC channels/preload bindings; never break existing ones.
3. Make **minimal** edits. Preserve surrounding formatting/indentation (the repo uses tabs).
4. After each task: run a syntax check (`node --check <file>` for JS) and mentally walk the acceptance criteria.
5. Prefer parameterized SQL. Dates are stored as `YYYY-MM-DD`; display as `дд.мм.гггг`.
6. When editing the big inline script in `index.html`, anchor on unique substrings so you replace exactly one occurrence.

---

# Task 1 — Schedule modal: freeze window header AND column headers

**Where:** `app/renderer/index.html` — `#scheduleModal` markup, the `showScheduleMonth(monthName, list)` inline function, and `.modal` / `.modal-backdrop` CSS.

**Current behavior:** Clicking a month in «График проверок» opens `#scheduleModal`. `.modal` has `max-height:90vh; overflow-y:auto`, so scrolling the list also scrolls away the window title (`.modal-head`, text «Месяц — N чел.») and the column-header row («Работник» / «Дата проверки») which is rendered inside `#scheduleModalBody`.

**Required:** The window title and the column-header row must be firmly fixed (never scroll). Only the employee list scrolls.

**How:**

1. Split the modal into 3 zones: fixed `.modal-head`, a fixed column-header row, and a separate scrollable list container (`overflow-y:auto`, its own `max-height`).
2. Remove whole-modal scrolling for this modal (make `.modal` a flex column with `overflow:hidden`), OR make the head + header row `position:sticky; top:0; z-index:2; background:var(--app-panel)`.
3. In `showScheduleMonth`, move the column-header row out of the scrolling body into the fixed block above the list.

**Reference implementation (verified):**

Modal markup — replace:

```html
<div id="scheduleModal" class="modal-backdrop"><div class="modal" style="max-width:600px"><div class="modal-head"><div><h3 id="scheduleModalTitle">Работники</h3></div><button class="ghost" onclick="document.getElementById('scheduleModal').classList.remove('active')">Закрыть</button></div><div id="scheduleModalBody" class="modal-list"></div></div></div>
```

with:

```html
<div id="scheduleModal" class="modal-backdrop"><div class="modal" style="max-width:600px;display:flex;flex-direction:column;max-height:85vh;overflow:hidden"><div class="modal-head" style="flex:0 0 auto"><div><h3 id="scheduleModalTitle">Работники</h3></div><button class="ghost" onclick="document.getElementById('scheduleModal').classList.remove('active')">Закрыть</button></div><div id="scheduleModalHeadRow" style="flex:0 0 auto"></div><div id="scheduleModalBody" class="modal-list" style="flex:1 1 auto;overflow-y:auto;margin-top:0"></div></div></div>
```

In `showScheduleMonth`, replace:

```jsx
const body=document.getElementById('scheduleModalBody');
body.innerHTML=sorted.length?
`<div style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px 12px;border-bottom:2px solid var(--notion-border);font-weight:700;font-size:13px"><span>Работник</span><span>Дата проверки</span></div>`+
sorted.map(w=>{
```

with:

```jsx
const headRow=document.getElementById('scheduleModalHeadRow');
if(headRow)headRow.innerHTML=sorted.length?`<div style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px 12px;border-bottom:2px solid var(--notion-border);font-weight:700;font-size:13px"><span>Работник</span><span>Дата проверки</span></div>`:'';
const body=document.getElementById('scheduleModalBody');
body.innerHTML=sorted.length?
sorted.map(w=>{
```

**Acceptance:** In a month with many people, scrolling the list keeps the window title and «Работник»/«Дата проверки» visible at the top.

---

# Task 2 — «Просрочено» list must include statuses «Просрочено» AND «Просрочено*»

**Where:** `app/renderer/app.js` — `window.showOverdueModal`. Also `app/main.js` — `dashboard:stats` handler (for counter consistency).

**Current behavior:** Filter is `list.filter(w => w && w.next && w.next < today)`. `bad_star` employees have `next_check_date` shifted +14 days into the future, so they never match and are missing from the list.

**Required:** Include BOTH `bad` and `bad_star`. Keep the modal title and badges as «Просрочено» (no asterisk in the list title).

**How:**

1. Replace the filter with a status check: `list.filter(w => w && (w.status === 'bad' || w.status === 'bad_star'))`.
2. Keep modal title `Просрочено — N чел.`, badges class `status bad`, text «Просрочено».
3. In `dashboard:stats`, widen the overdue count so the tile matches the list length, e.g.:

```jsx
const overdue = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND (next_check_date < ? OR note = 'DATE_DEFERRED')").get(now).c;
```

**Acceptance:** «Просрочено*» employees appear in the «Просрочено» list; list title is «Просрочено»; dashboard counter equals the number of rows in the list.

---

# Task 3 — Export the «Скоро» list (due within next 30 days) to Excel

Model this on the existing schedule/journal export.

- `backend/import/excelImporter.js` — add `exportUpcomingToExcel(filePath)`.
- `app/main.js` — add IPC handler `employees:exportUpcomingExcel` (with `dialog.showSaveDialog`, modeled on `schedule:exportExcel`).
- `app/preload.js` — add binding `exportUpcomingExcel: () => invoke("employees:exportUpcomingExcel")` inside the `employees` block.
- `app/renderer/app.js` — add `window.exportUpcomingExcel` and an «Экспорт в Excel» button inside the «Скоро» modal (`showUpcomingModal`).

**«Скоро» definition:** `next_check_date` within `[today; today+30]`, `status != 'deleted'` (matches `showUpcomingModal` / `dashboard:stats`).

**Reference implementation (verified):**

`backend/import/excelImporter.js` — add before `module.exports`, then add `exportUpcomingToExcel,` to the exports object:

```jsx
async function exportUpcomingToExcel(filePath) {
	const db = openDb();
	try {
		const today = new Date().toISOString().slice(0, 10);
		const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
		const employees = db.prepare(`
			SELECT *
			FROM employees
			WHERE status != 'deleted'
				AND next_check_date IS NOT NULL
				AND next_check_date >= ? AND next_check_date <= ?
			ORDER BY next_check_date ASC, full_name ASC
		`).all(today, in30);

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Скоро (30 дней)");
		sheet.columns = [
			{ header: "ФИО", key: "full_name", width: 35 },
			{ header: "Подразделение", key: "workplace", width: 20 },
			{ header: "Должность", key: "position", width: 25 },
			{ header: "Группа ЭБ", key: "safety_group", width: 12 },
			{ header: "Категория", key: "category", width: 25 },
			{ header: "Объем знаний", key: "scope", width: 15 },
			{ header: "Дата последней проверки", key: "last_check", width: 18 },
			{ header: "Дата следующей проверки", key: "next_check", width: 18 }
		];
		sheet.getRow(1).font = { bold: true };
		sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
		for (const emp of employees) {
			sheet.addRow({
				full_name: emp.full_name,
				workplace: emp.workplace_name || emp.workplace_code || "",
				position: emp.position || "",
				safety_group: emp.electrical_safety_group || "",
				category: emp.personnel_category || "",
				scope: emp.knowledge_scope_code || "",
				last_check: emp.last_check_date ? emp.last_check_date.split("-").reverse().join(".") : "",
				next_check: emp.next_check_date ? emp.next_check_date.split("-").reverse().join(".") : ""
			});
		}
		await workbook.xlsx.writeFile(filePath);
		return { ok: true, count: employees.length };
	} finally {
		db.close();
	}
}
```

> NOTE: mirror the exact column keys/source fields used by the existing `exportScheduleToExcel` in this file. If the real employee columns differ (e.g. `workplace_name`), align them with that function — do not invent field names.
> 

`app/main.js` — add before `employees:createTemplate`:

```jsx
ipcMain.handle("employees:exportUpcomingExcel", async () => {
	const result = await dialog.showSaveDialog(mainWindow, {
		title: "Экспорт списка «Скоро» (30 дней)",
		defaultPath: path.join(app.getPath("documents"), `Скоро_обучение_30дней_${new Date().getFullYear()}.xlsx`),
		filters: [{ name: "Excel", extensions: ["xlsx"] }]
	});
	if (result.canceled || !result.filePath) return { canceled: true };
	const { exportUpcomingToExcel } = require("../backend/import/excelImporter");
	const report = await exportUpcomingToExcel(result.filePath);
	return { ok: true, filePath: result.filePath, count: report.count };
});
```

`app/preload.js` — inside the `employees` block, after `exportExcel`:

```jsx
exportUpcomingExcel: () => invoke("employees:exportUpcomingExcel"),
```

`app/renderer/app.js` — add before `window.exportJournalExcel`:

```jsx
window.exportUpcomingExcel = async function () {
	toast("Экспорт списка «Скоро» (30 дней)...");
	try {
		const res = await api.employees.exportUpcomingExcel();
		if (res && res.ok) {
			toast("Список «Скоро» экспортирован: " + res.filePath);
		} else if (res && res.canceled) {
			toast("Экспорт отменен");
		}
	} catch (e) {
		toast("Ошибка экспорта: " + e.message);
	}
};
```

And in `showUpcomingModal`, at the top of the non-empty `body`, before the scrollable list `<div>`:

```html
<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="ghost" style="padding:5px 12px;font-size:12px" onclick="exportUpcomingExcel()">Экспорт в Excel</button></div>
```

**Acceptance:** From the «Скоро» window you can export .xlsx; the file contains exactly the employees due within the next 30 days; dates formatted as дд.мм.гггг.

---

# Task 4 — Restore «delete journal record» in the UI

**Where:** `app/renderer/index.html` (`#journal` table) and `app/renderer/app.js` (`renderJournal`).

**Diagnosis:** Backend/API are fully present and working: `journalRepository.deleteJournalRecord(db, id)`, IPC `journal:delete` (with logging + `touchDbModified`), preload `journal.delete(id)`, and `window.deleteJournalRecord(id, fio, number)` with `themedConfirm` (requires typing the word «УДАЛИТЬ»). The ONLY problem: there is no delete button in the UI. `renderJournal` builds 8 `<td>` per row with no action, `<thead>` has 8 columns ending in «Файл», and the empty-state uses `table.innerHTML` which wipes `<thead>`.

**How:**

1. In `index.html` `<thead>`, add a column: `<th style="width:60px">Действия</th>` (now 9 columns).
2. In `renderJournal`, add a `<td>` per row with a delete button calling `deleteJournalRecord(r.id, <escaped fio>, r.protocol_number)`. Escape the FIO safely for an `onclick` attribute (handle quotes/apostrophes). `journal.list` returns `SELECT *`, so `id` is available.
3. Fix the empty-state: write to `tbody` (not the whole table) and set `colspan="9"`.
4. After delete, keep the existing `renderJournal()` + `loadDashboard()` calls.

**Reference implementation (verified):**

`index.html` thead — replace `...<th>Файл</th></tr></thead><tbody id="journalRows"></tbody>` with:

```html
<th>Файл</th><th style="width:60px">Действия</th></tr></thead><tbody id="journalRows"></tbody>
```

`app/renderer/app.js` — replace `renderJournal` with:

```jsx
async function renderJournal() {
	const table = document.querySelector("#journal table");
	if (!table) return;
	const tbody = table.querySelector("tbody");
	if (!tbody) return;
	try {
		const rows = await api.journal.list({});
		if (!rows || !rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">Пока нет протоколов</td></tr>'; return; }
		tbody.innerHTML = rows.map((r) => {
			const docxLink = r.docx_path ? `<a href="#" style="color:var(--notion-blue);text-decoration:underline" onclick="openFile('${r.docx_path.replace(/\\/g, '\\\\')}')">DOCX</a>` : "—";
			const reasonShort = (r.reason || "").includes("Внеоч") ? "Внеоч" : "Очер";
			const fioArg = JSON.stringify(r.full_name_snapshot || "").replace(/"/g, "&quot;");
			return `<tr><td style="text-align:center">${r.protocol_number}</td><td style="text-align:center">${esc(r.full_name_snapshot)}</td><td style="text-align:center;font-size:12px">${reasonShort}</td><td style="text-align:center">${fmt(r.check_date)}</td><td style="text-align:center">${esc(r.electrical_safety_group)}</td><td style="text-align:center">${esc(r.final_result)}</td><td style="text-align:center">${fmt(r.next_check_date)}</td><td style="text-align:center">${docxLink}</td><td style="text-align:center"><button class="ghost" style="padding:3px 8px;font-size:11px;color:var(--danger)" onclick="deleteJournalRecord(${r.id}, ${fioArg}, ${r.protocol_number})">Удалить</button></td></tr>`;
		}).join("");
	} catch (e) { console.warn("renderJournal:", e.message); }
}
```

> IMPORTANT: verify the current `renderJournal` uses these exact `<td>` fields (`protocol_number`, `full_name_snapshot`, `reason`, `check_date`, `electrical_safety_group`, `final_result`, `next_check_date`, `docx_path`). If field names differ in the actual file, keep the existing 8 cells intact and only ADD the 9th action `<td>` + the `fioArg` line + the tbody/colspan fix.
> 

**Acceptance:** Each journal row has an «Удалить» button; clicking it opens the «УДАЛИТЬ» confirmation; after confirming, the record disappears from journal + DB and dashboard counters refresh; the table header does not disappear when the journal is empty.

---

# Task 5 — Normative documents not pulled into the protocol (`{инструкции}`)

This concerns the «normative documents / instructions» field — placeholder `{инструкции}` in `templates/Протокол.docx`.

**Verified during review (all formally correct):**

- UI: `<textarea id="instructionsText">` in `index.html`.
- `applyKnowledgeScope()` fills the field from the selected knowledge scope — BUT only when the value is non-empty (`if(instText) ...value=instText`), and the fallback object `const knowledgeInstructions={}` is empty.
- `buildProtocolForm()` (`app.js`): `instructions_text: getVal("instructionsText", "")`.
- `saveProtocol()` (`protocolService.js`): `instructions_text: form.instructions_text || null`.
- `buildProtocolPlaceholderMap()` (`placeholderMap.js`): `"инструкции": form.instructions_text || ""`.
- The template DOES contain `{инструкции}`, split into runs `{` + `инструкции` + `}` — exactly like the WORKING `{ФИО}`. docxtemplater joins such split runs, so template + mapping key are correct.

**Conclusion:** The bug is NOT the placeholder name or template. `instructions_text` is empty/default at generation time (knowledge scopes in the DB apparently have no `instructions_text`, and `applyKnowledgeScope` only overwrites on a non-empty value).

**How:**

1. Add a temporary diagnostic log in `saveProtocol` before generation to confirm what actually reaches the template.
2. Guarantee population in `applyKnowledgeScope()`: set the textarea reliably (use the scope's `instructions_text` from the reference if present; otherwise a meaningful text) instead of only overwriting on non-empty. Verify whether the knowledge-scope reference actually stores `instructions_text`.
3. Add `instructions_text` to `getProtocolDraft()`'s return object (currently missing, unlike other fields) for preview/draft consistency.
4. Quick generation test: run `docxGenerator.renderProtocolDocx` on the real template with a test map where `инструкции` is non-empty, and confirm the text appears in the .docx. ONLY if the test proves the split-run is the culprit, retype the `{инструкции}` placeholder as a single run in the template (unlikely per review).

**Reference implementation (verified):**

`index.html` — replace:

```jsx
function applyKnowledgeScope(){const s=v('knowledgeScope','');const refs=window._allRefs;let instText='';if(refs&&refs.knowledgeScopes){const scope=refs.knowledgeScopes.find(x=>x.code===s);if(scope&&scope.instructions_text)instText=scope.instructions_text;}if(!instText&&knowledgeInstructions[s])instText=knowledgeInstructions[s];if(instText)document.getElementById('instructionsText').value=instText;previewProtocol();}
```

with:

```jsx
function applyKnowledgeScope(){const s=v('knowledgeScope','');const refs=window._allRefs;const ta=document.getElementById('instructionsText');let instText='';if(refs&&refs.knowledgeScopes){const scope=refs.knowledgeScopes.find(x=>x.code===s);if(scope&&scope.instructions_text)instText=scope.instructions_text;}if(!instText&&knowledgeInstructions[s])instText=knowledgeInstructions[s];if(s){ta.value=instText||('Перечень нормативных документов согласно объему знаний «'+s+'»');}else if(!ta.value){ta.value='Перечень нормативных документов согласно объему знаний';}previewProtocol();}
```

`protocolService.js` — in `getProtocolDraft()` return object add (after `previous_result`):

```jsx
instructions_text: form.instructions_text || "",
```

`protocolService.js` — in `saveProtocol()`, after `const placeholderMap = buildProtocolPlaceholderMap(record);`:

```jsx
console.log("[protocol] instructions_text =", JSON.stringify(record.instructions_text), "| placeholder =", JSON.stringify(placeholderMap["инструкции"]));
```

**Acceptance:** When generating a protocol, the .docx block «провела проверку знаний нормативных документов, инструкций: … {инструкции}» shows the actual document list from the selected knowledge scope (not empty and not just the default placeholder).

---

# Verification (run after all tasks)

- `node --check` on every edited JS file: `app/main.js`, `app/preload.js`, `app/renderer/app.js`, `backend/import/excelImporter.js`, `backend/protocol/protocolService.js`.
- `backend/protocol/placeholderMap.js` should NOT need changes (`"инструкции": form.instructions_text || ""` already exists).
- If the app runs (`npm start`), manually walk each acceptance criterion.
- Confirm no existing IPC channel or preload method was renamed/removed.

# Final checklist

- [ ]  Task 1: schedule window title + column headers frozen, only list scrolls
- [ ]  Task 2: «Просрочено» includes «Просрочено» + «Просрочено*», title stays «Просрочено», dashboard counter matches
- [ ]  Task 3: «Скоро» (30 days) Excel export (backend + IPC + preload + button)
- [ ]  Task 4: journal delete button restored (thead +1 column, tbody instead of whole table, colspan 9)
- [ ]  Task 5: `{инструкции}` populated in the protocol, confirmed by log/generation test