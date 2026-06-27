PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employees (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	last_name TEXT NOT NULL,
	first_name TEXT NOT NULL,
	middle_name TEXT,
	full_name TEXT NOT NULL,
	workplace_code TEXT,
	workplace_name TEXT,
	position TEXT,
	knowledge_scope_code TEXT,
	personnel_category TEXT,
	electrical_safety_group TEXT,
	last_check_date TEXT,
	next_check_date TEXT,
	check_period_years INTEGER DEFAULT 1,
	last_result TEXT,
	status TEXT DEFAULT 'active',
	note TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	code TEXT,
	name TEXT NOT NULL,
	hide_code_in_protocol INTEGER DEFAULT 0,
	status TEXT DEFAULT 'active',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_scopes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	code TEXT NOT NULL UNIQUE,
	name TEXT,
	instructions_text TEXT,
	status TEXT DEFAULT 'active',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commission_chairmen (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	full_name TEXT NOT NULL,
	position TEXT NOT NULL,
	status TEXT DEFAULT 'active',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commission_members (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	full_name TEXT NOT NULL,
	position TEXT NOT NULL,
	status TEXT DEFAULT 'active',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commissions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	chairman_id INTEGER,
	member_1_id INTEGER,
	member_2_id INTEGER,
	member_3_id INTEGER,
	status TEXT DEFAULT 'active',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (chairman_id) REFERENCES commission_chairmen(id),
	FOREIGN KEY (member_1_id) REFERENCES commission_members(id),
	FOREIGN KEY (member_2_id) REFERENCES commission_members(id),
	FOREIGN KEY (member_3_id) REFERENCES commission_members(id)
);

CREATE TABLE IF NOT EXISTS work_rights (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	protocol_text TEXT NOT NULL,
	sort_order INTEGER DEFAULT 0,
	status TEXT DEFAULT 'active',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_rights (
	employee_id INTEGER NOT NULL,
	right_id INTEGER NOT NULL,
	value INTEGER DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (employee_id, right_id),
	FOREIGN KEY (employee_id) REFERENCES employees(id),
	FOREIGN KEY (right_id) REFERENCES work_rights(id)
);

CREATE TABLE IF NOT EXISTS protocol_journal (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	protocol_year INTEGER NOT NULL,
	protocol_number INTEGER NOT NULL,
	employee_id INTEGER,
	full_name_snapshot TEXT NOT NULL,
	workplace_snapshot TEXT,
	position_snapshot TEXT,
	check_date TEXT NOT NULL,
	next_check_date TEXT,
	reason TEXT,
	knowledge_scope_code TEXT,
	instructions_text TEXT,
	personnel_category TEXT,
	electrical_safety_group TEXT,
	result_eb TEXT,
	result_ot TEXT,
	result_pb TEXT,
	result_other TEXT,
	final_result TEXT,
	duplicate_duration TEXT,
	voltage_category TEXT,
	commission_name TEXT,
	chairman_position TEXT,
	chairman_name TEXT,
	member_1_position TEXT,
	member_1_name TEXT,
	member_2_position TEXT,
	member_2_name TEXT,
	member_3_position TEXT,
	member_3_name TEXT,
	rights_text TEXT,
	docx_path TEXT,
	pdf_path TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (protocol_year, protocol_number),
	FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS sync_state (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	last_opened_at TEXT,
	last_modified_at TEXT,
	last_synced_at TEXT,
	last_sync_direction TEXT,
	last_sync_user TEXT,
	last_sync_device TEXT,
	db_version TEXT,
	sync_revision INTEGER DEFAULT 0,
	remote_file_timestamp TEXT,
	sync_status TEXT,
	sync_error TEXT,
	local_journal_count_total INTEGER DEFAULT 0,
	remote_journal_count_total INTEGER DEFAULT 0,
	local_journal_count_current_year INTEGER DEFAULT 0,
	remote_journal_count_current_year INTEGER DEFAULT 0,
	local_max_protocol_number_current_year INTEGER DEFAULT 0,
	remote_max_protocol_number_current_year INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS backup_history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	backup_type TEXT NOT NULL,
	path TEXT NOT NULL,
	created_at TEXT NOT NULL,
	reason TEXT,
	db_revision INTEGER,
	status TEXT,
	note TEXT
);

CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	event_type TEXT NOT NULL,
	level TEXT NOT NULL DEFAULT 'info',
	message TEXT NOT NULL,
	details TEXT,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employees_last_name ON employees(last_name);
CREATE INDEX IF NOT EXISTS idx_employees_full_name ON employees(full_name);
CREATE INDEX IF NOT EXISTS idx_employees_next_check_date ON employees(next_check_date);
CREATE INDEX IF NOT EXISTS idx_protocol_journal_year_number ON protocol_journal(protocol_year, protocol_number);
CREATE INDEX IF NOT EXISTS idx_protocol_journal_check_date ON protocol_journal(check_date);
CREATE INDEX IF NOT EXISTS idx_app_events_created_at ON app_events(created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_type ON app_events(event_type);
