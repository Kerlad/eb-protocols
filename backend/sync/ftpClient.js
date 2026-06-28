const ftp = require("basic-ftp");
const net = require("net");
const { URL } = require("url");
const { SocksClient } = require("socks");

function normalizeRemotePath(remotePath) {
	return String(remotePath || "/")
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/");
}

function parseProxyRule(rule) {
	if (!rule || rule === "DIRECT") return null;
	const socksMatch = rule.match(/^SOCKS([45]?)\s+([^:\s]+):(\d+)/i);
	if (socksMatch) {
		return { type: "SOCKS", version: socksMatch[1] || "5", host: socksMatch[2], port: parseInt(socksMatch[3], 10) };
	}
	const proxyMatch = rule.match(/^PROXY\s+([^:\s]+):(\d+)/i);
	if (proxyMatch) {
		return { type: "HTTP", host: proxyMatch[1], port: parseInt(proxyMatch[2], 10) };
	}
	return null;
}

function parseEnvProxy(envStr) {
	if (!envStr) return null;
	try {
		const url = new URL(envStr);
		const proto = (url.protocol || "").replace(":", "").toLowerCase();
		if (proto === "socks" || proto === "socks5" || proto === "socks4") {
			return { type: "SOCKS", version: proto === "socks4" ? "4" : "5", host: url.hostname, port: parseInt(url.port, 10) || 1080 };
		}
		return { type: "HTTP", host: url.hostname, port: parseInt(url.port, 10) || 8080 };
	} catch (e) {
		return null;
	}
}

function isNoProxy(host, noProxyStr) {
	if (!noProxyStr) return false;
	const list = noProxyStr.split(",").map(s => s.trim().toLowerCase());
	return list.some(entry => {
		if (entry === "*") return true;
		if (entry === host.toLowerCase()) return true;
		if (entry.startsWith(".") && host.toLowerCase().endsWith(entry)) return true;
		return false;
	});
}

async function createSocksSocket(proxy, targetHost, targetPort) {
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
			const connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`;
			socket.write(connectReq);
			let data = "";
			socket.on("data", (chunk) => {
				data += chunk.toString();
				if (data.includes("\r\n\r\n")) {
					if (data.includes("200")) {
						resolve(socket);
					} else {
						socket.destroy();
						reject(new Error(`HTTP CONNECT failed: ${data.split("\r\n")[0]}`));
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

async function createProxySocket(proxy, targetHost, targetPort) {
	if (proxy.type === "SOCKS") {
		return createSocksSocket(proxy, targetHost, targetPort);
	}
	return createHttpTunnel(proxy, targetHost, targetPort);
}

async function connectWithConfig(config, client) {
	const proxy = config._proxyInfo;
	const host = config.host;
	const port = config.port || 21;

	if (proxy) {
		console.log(`[ftp] Connecting via ${proxy.type} proxy ${proxy.host}:${proxy.port} → ${host}:${port}`);
		const socket = await createProxySocket(proxy, host, port);
		await client.access({
			host, port,
			user: config.user,
			password: config.password,
			secure: config.secure || false,
			secureOptions: config.secure ? { rejectUnauthorized: config.allowSelfSigned ? false : true } : undefined,
			socket
		});
	} else {
		await client.access({
			host, port,
			user: config.user,
			password: config.password,
			secure: config.secure || false,
			secureOptions: config.secure ? { rejectUnauthorized: config.allowSelfSigned ? false : true } : undefined
		});
	}
}

async function withClient(config, handler) {
	let proxyInfo = config._proxyInfo;
	if (!proxyInfo && config._proxyRule) {
		proxyInfo = parseProxyRule(config._proxyRule);
	}
	if (!proxyInfo && config._envProxy) {
		proxyInfo = parseEnvProxy(config._envProxy);
	}
	if (proxyInfo && isNoProxy(config.host, config._noProxy)) {
		console.log(`[ftp] ${config.host} in NO_PROXY, connecting directly`);
		proxyInfo = null;
	}
	const clientConfig = { ...config, _proxyInfo: proxyInfo };

	const client = new ftp.Client(clientConfig.timeout || 60000);
	client.ftp.verbose = Boolean(clientConfig.verbose);

	try {
		await connectWithConfig(clientConfig, client);
		return await handler(client);
	} catch (error) {
		const msg = error.message || String(error);
		if ((msg.includes("EPSV") || msg.includes("522") || msg.includes("data connection")) && !clientConfig._pasvRetried) {
			console.log(`[ftp] Data channel failed (${msg.slice(0, 80)}), retrying with explicit PASV options`);
			try { client.close(); } catch (e) {}
			const retryConfig = { ...clientConfig, _pasvRetried: true };
			const client2 = new ftp.Client(retryConfig.timeout || 60000);
			client2.ftp.verbose = Boolean(retryConfig.verbose);
			try {
				await connectWithConfig(retryConfig, client2);
				return await handler(client2);
			} finally {
				try { client2.close(); } catch (e) {}
			}
		}
		throw error;
	} finally {
		try { client.close(); } catch (e) {}
	}
}

async function diagnoseConnection(config) {
	const results = [];
	let proxyInfo = config._proxyInfo;
	if (!proxyInfo && config._proxyRule) proxyInfo = parseProxyRule(config._proxyRule);
	if (!proxyInfo && config._envProxy) proxyInfo = parseEnvProxy(config._envProxy);

	results.push({ step: "Прокси", ok: true, detail: proxyInfo ? `${proxyInfo.type} ${proxyInfo.host}:${proxyInfo.port}` : "DIRECT (без прокси)" });
	results.push({ step: "NO_PROXY", ok: true, detail: config._noProxy || "не задан" });

	try {
		const host = config.host;
		const port = config.port || 21;
		if (proxyInfo) {
			results.push({ step: "TCP через прокси", ok: true, detail: `Туннель ${proxyInfo.host}:${proxyInfo.port} → ${host}:${port}` });
			const socket = await createProxySocket(proxyInfo, host, port);
			socket.destroy();
			results.push({ step: "TCP через прокси", ok: true, detail: "Канал управления установлен" });
		} else {
			await new Promise((resolve, reject) => {
				const s = net.connect(port, host, () => { s.destroy(); resolve(); });
				s.setTimeout(5000, () => { s.destroy(); reject(new Error("Таймаут TCP")); });
				s.on("error", reject);
			});
			results.push({ step: "TCP напрямую", ok: true, detail: `${host}:${port} доступен` });
		}
	} catch (e) {
		results.push({ step: "TCP", ok: false, detail: `Ошибка: ${e.message}` });
	}

	try {
		await withClient(config, async (client) => {
			await client.ensureDir(normalizeRemotePath(config.remoteDir || "/"));
			const list = await client.list();
			results.push({ step: "FTP LIST", ok: true, detail: `${list.length} записей в ${config.remoteDir || "/"}` });
		});
		results.push({ step: "Итог", ok: true, detail: "Все операции выполнены успешно" });
	} catch (e) {
		const msg = e.message || String(e);
		let hint = "";
		if (msg.includes("ECONNREFUSED")) hint = "Порт закрыт. Проверьте адрес и портFTP-сервера.";
		else if (msg.includes("ETIMEDOUT")) hint = "Таймаут. Проверьте сетевое подключение и фаервол.";
		else if (msg.includes("ENOTFOUND")) hint = "Хост не найден. Проверьте DNS.";
		else if (msg.includes("530")) hint = "Ошибка аутентификации. Проверьте логин/пароль.";
		else if (msg.includes("EPSV") || msg.includes("522")) hint = "Проблема с пассивным режимом. Попробуйте настроить FTPS или SFTP.";
		else if (msg.includes("CONNECT")) hint = "Прокси отклонил соединение. Проверьте тип прокси и доступ к порту.";
		results.push({ step: "FTP операция", ok: false, detail: `${msg.slice(0, 120)}${hint ? " → " + hint : ""}` });
	}

	return { results, proxy: proxyInfo ? `${proxyInfo.type} ${proxyInfo.host}:${proxyInfo.port}` : "DIRECT" };
}

async function testConnection(config) {
	return withClient(config, async (client) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		await client.ensureDir(remoteDir);
		const list = await client.list();
		return {
			ok: true,
			remoteDir,
			entries: list.length,
			proxy: config._proxyInfo ? `${config._proxyInfo.type} ${config._proxyInfo.host}:${config._proxyInfo.port}` : "DIRECT"
		};
	});
}

async function uploadFile(config, localPath, remoteName) {
	return withClient(config, async (client) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		await client.ensureDir(remoteDir);
		await client.uploadFrom(localPath, remoteName);
		return { ok: true, remoteName };
	});
}

async function downloadFile(config, remoteName, localPath) {
	return withClient(config, async (client) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		await client.ensureDir(remoteDir);
		await client.downloadTo(localPath, remoteName);
		return { ok: true, localPath };
	});
}

async function fileExists(config, remoteName) {
	return withClient(config, async (client) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		await client.ensureDir(remoteDir);
		const list = await client.list();
		return list.some((entry) => entry.name === remoteName);
	});
}

module.exports = {
	normalizeRemotePath,
	parseProxyRule,
	parseEnvProxy,
	isNoProxy,
	testConnection,
	uploadFile,
	downloadFile,
	fileExists,
	diagnoseConnection
};
