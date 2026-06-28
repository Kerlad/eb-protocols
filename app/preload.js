const { contextBridge, ipcRenderer } = require("electron");

function invoke(...args) {
	return ipcRenderer.invoke(...args);
}

contextBridge.exposeInMainWorld("ebApi", {
	employees: {
		searchByLastName: (lastName) => invoke("employees:searchByLastName", lastName),
		listAll: () => invoke("employees:listAll"),
		getById: (id) => invoke("employees:getById", id),
		create: (employee) => invoke("employees:create", employee),
		update: (id, patch) => invoke("employees:update", id, patch),
		delete: (id) => invoke("employees:delete", id),
		exportExcel: () => invoke("employees:exportExcel"),
		createTemplate: () => invoke("employees:createTemplate")
	},
	references: {
		getAll: () => invoke("references:getAll")
	},
	referencesEdit: {
		saveDepartment: (department) => invoke("references:saveDepartment", department),
		saveCommission: (commission) => invoke("references:saveCommission", commission),
		saveChairman: (chairman) => invoke("references:saveChairman", chairman),
		saveMember: (member) => invoke("references:saveMember", member),
		saveKnowledgeScope: (scope) => invoke("references:saveKnowledgeScope", scope),
		saveWorkRight: (right) => invoke("references:saveWorkRight", right),
		deleteDepartment: (id) => invoke("references:deleteDepartment", id),
		deleteChairman: (id) => invoke("references:deleteChairman", id),
		deleteMember: (id) => invoke("references:deleteMember", id),
		deleteKnowledgeScope: (id) => invoke("references:deleteKnowledgeScope", id),
		deleteWorkRight: (id) => invoke("references:deleteWorkRight", id),
		deleteCommission: (id) => invoke("references:deleteCommission", id)
	},
	protocols: {
		getDraft: (form) => invoke("protocols:getDraft", form),
		getNextNumber: (checkDate) => invoke("protocols:getNextNumber", checkDate),
		save: (form) => invoke("protocols:save", form),
		preview: (form) => invoke("protocols:preview", form)
	},
	shell: {
		openFile: (filePath) => invoke("shell:openFile", filePath)
	},
	schedule: {
		exportExcel: (year) => invoke("schedule:exportExcel", year)
	},
	journal: {
		list: (filters) => invoke("journal:list", filters),
		stats: (year) => invoke("journal:stats", year),
		exportExcel: () => invoke("journal:exportExcel"),
		delete: (id) => invoke("journal:delete", id)
	},
	sync: {
		getState: () => invoke("sync:getState"),
		test: () => invoke("sync:test"),
		status: () => invoke("sync:status"),
		upload: () => invoke("sync:upload"),
		download: () => invoke("sync:download")
	},
	settings: {
		getAll: () => invoke("settings:getAll"),
		save: (settings) => invoke("settings:save", settings),
		openDataDir: () => invoke("settings:openDataDir"),
		openProtocolsDir: () => invoke("settings:openProtocolsDir")
	},
	backups: {
		listLocal: () => invoke("backups:listLocal"),
		createLocal: (reason) => invoke("backups:createLocal", reason),
		restoreLocal: (backupPath) => invoke("backups:restoreLocal", backupPath)
	},
	security: {
		getStatus: () => invoke("security:getStatus"),
		enableDbPassword: (password) => invoke("security:enableDbPassword", password),
		disableDbPassword: () => invoke("security:disableDbPassword"),
		setFtpPassword: (password) => invoke("security:setFtpPassword", password)
	},
	events: {
		list: (filters) => invoke("events:list", filters)
	},
	template: {
		check: () => invoke("template:check"),
		testDocx: () => invoke("template:testDocx")
	},
	import: {
		excel: () => invoke("import:excel")
	},
	dashboard: {
		stats: () => invoke("dashboard:stats")
	}
});
