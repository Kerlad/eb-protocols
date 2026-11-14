const SftpClient = require('ssh2-sftp-client');
const net = require('net');
const crypto = require('crypto');
const { SocksClient } = require('socks');

function normalizeRemotePath(remotePath) {
	return String(remotePath || "/")
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/");
}

async function createSocksProxy(proxy, targetHost, targetPort) {
	const { socket } = await SocksClient.createConnection({
		proxy: { host: proxy.host, port: proxy.port, type: proxy.version === "4" ? 4 : 5 },
		command: "connect",
		destination: { host: targetHost, port: targetPort }
	});
	return socket;
}

async function createHttpTunnel(proxy, targetHost, targetPort) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(proxy.port, proxy.host, () => {
			socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
			let data = "";
			socket.on("data", (chunk) => {
				data += chunk.toString();
				if (data.includes("\r\n\r\n")) {
					const statusLine = data.split("\r\n")[0];
					const match = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
					if (match && match[1] === "200") {
						resolve(socket);
					} else {
						socket.destroy();
						reject(new Error(`HTTP CONNECT failed: ${statusLine}`));
					}
				}
			});
			socket.setTimeout(10000, () => {
				socket.destroy();
				reject(new Error("HTTP CONNECT timeout"));
			});
		});
		socket.on("error", reject);
	});
}

const HOST_KEY_CHANGED_MESSAGE =
	"Ключ сервера изменился. Если сервер переустановлен, очистите отпечаток в настройках.";

// T2.10: чистая проверка ключа хоста; fingerprint = sha256 в base64
function verifyHostKey(stored, keyBuffer) {
	const fingerprint = crypto.createHash("sha256").update(keyBuffer).digest("base64");
	if (!stored) return { ok: true, fingerprint, isNew: true };
	return { ok: stored === fingerprint, fingerprint, isNew: false };
}

async function withSftpClient(config, handler) {
	const sftp = new SftpClient();
	let hostKeyMismatch = false;
	try {
		const connConfig = {
			host: config.host,
			port: config.port || 22,
			username: config.user,
			password: config.password,
			readyTimeout: config.timeout || 10000,
			strictVendor: false,
			hostVerifier: (key) => {
				const result = verifyHostKey(config.hostFingerprint, key);
				if (!result.ok) {
					hostKeyMismatch = true;
					return false;
				}
				if (result.isNew && typeof config.onNewHostFingerprint === "function") {
					try { config.onNewHostFingerprint(result.fingerprint); } catch (e) { /* не блокируем подключение */ }
				}
				return true;
			}
		};

		if (config._proxyInfo) {
			const proxy = config._proxyInfo;
			if (proxy.type === "SOCKS") {
				const socket = await createSocksProxy(proxy, config.host, config.port || 22);
				connConfig.socket = socket;
			} else if (proxy.type === "HTTP") {
				const socket = await createHttpTunnel(proxy, config.host, config.port || 22);
				connConfig.socket = socket;
			}
		}

		try {
			await sftp.connect(connConfig);
		} catch (error) {
			if (hostKeyMismatch) throw new Error(HOST_KEY_CHANGED_MESSAGE);
			throw error;
		}
		return await handler(sftp);
	} finally {
		try { await sftp.end(); } catch (e) {}
	}
}

async function testConnection(config) {
	return withSftpClient(config, async (sftp) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		const exists = await sftp.exists(remoteDir);
		if (!exists) {
			await sftp.mkdir(remoteDir, true);
		}
		const list = await sftp.list(remoteDir);
		return {
			ok: true,
			remoteDir,
			entries: list.length,
			transport: "SFTP",
			proxy: config._proxyInfo ? `${config._proxyInfo.type} ${config._proxyInfo.host}:${config._proxyInfo.port}` : "DIRECT"
		};
	});
}

// упрощённая диагностика: SFTP проверяется тем же тестом подключения
async function diagnoseConnection(config) {
	const steps = [];
	try {
		const result = await testConnection(config);
		steps.push({ step: "SFTP", ok: true, message: `Подключено, записей в папке: ${result.entries}` });
		return { ok: true, steps, summary: "SFTP: подключение успешно", transport: "SFTP" };
	} catch (error) {
		steps.push({ step: "SFTP", ok: false, message: error.message });
		return { ok: false, steps, summary: "SFTP: " + error.message, transport: "SFTP" };
	}
}

async function uploadFile(config, localPath, remoteName) {
	return withSftpClient(config, async (sftp) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		const exists = await sftp.exists(remoteDir);
		if (!exists) await sftp.mkdir(remoteDir, true);
		const remotePath = normalizeRemotePath(remoteDir + "/" + remoteName);
		await sftp.put(localPath, remotePath);
		return { ok: true, remoteName };
	});
}

// T2.9: замена файла на сервере после выгрузки под временным именем
async function replaceFile(config, tempName, remoteName) {
	return withSftpClient(config, async (sftp) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		const tempPath = normalizeRemotePath(remoteDir + "/" + tempName);
		const remotePath = normalizeRemotePath(remoteDir + "/" + remoteName);
		if (await sftp.exists(remotePath)) {
			await sftp.delete(remotePath);
		}
		await sftp.rename(tempPath, remotePath);
		return { ok: true, remoteName };
	});
}

async function downloadFile(config, remoteName, localPath) {
	return withSftpClient(config, async (sftp) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		const remotePath = normalizeRemotePath(remoteDir + "/" + remoteName);
		await sftp.get(remotePath, localPath);
		return { ok: true, localPath };
	});
}

async function fileExists(config, remoteName) {
	return withSftpClient(config, async (sftp) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		const remotePath = normalizeRemotePath(remoteDir + "/" + remoteName);
		const exists = await sftp.exists(remotePath);
		return exists;
	});
}

module.exports = {
	normalizeRemotePath,
	verifyHostKey,
	HOST_KEY_CHANGED_MESSAGE,
	testConnection,
	diagnoseConnection,
	uploadFile,
	replaceFile,
	downloadFile,
	fileExists
};
