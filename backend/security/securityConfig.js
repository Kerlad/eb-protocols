const SERVICE_NAME = "ru.eb.protocols";

const KEYS = {
	DB_PASSWORD: "db_password",
	DB_SALT: "db_salt",
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
	FTP_SECURE: "ftp.secure",
	FTP_TRANSPORT: "ftp.transport",
	FTP_ALLOW_SELF_SIGNED: "ftp.allow_self_signed",
	SFTP_HOST_FINGERPRINT: "sftp.host_fingerprint"
};

module.exports = {
	SERVICE_NAME,
	KEYS,
	SETTINGS_KEYS
};
