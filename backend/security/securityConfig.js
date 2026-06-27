const SERVICE_NAME = "ru.eb.protocols";

const KEYS = {
	DB_PASSWORD: "db_password",
	FTP_PASSWORD: "ftp_password",
	AUTO_LOGIN: "auto_login"
};

const SETTINGS_KEYS = {
	DB_ENCRYPTION_ENABLED: "security.db_encryption_enabled",
	AUTO_LOGIN_ENABLED: "security.auto_login_enabled",
	FTP_HOST: "ftp.host",
	FTP_PORT: "ftp.port",
	FTP_USER: "ftp.user",
	FTP_REMOTE_DIR: "ftp.remote_dir",
	FTP_SECURE: "ftp.secure"
};

module.exports = {
	SERVICE_NAME,
	KEYS,
	SETTINGS_KEYS
};
