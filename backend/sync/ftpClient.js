const ftp = require("basic-ftp");
const net = require("net");
const { URL } = require("url");

function normalizeRemotePath(remotePath) {
	return String(remotePath || "/")
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/");
}

function parseProxyRule(rule) {
	if (!rule || rule === "DIRECT") return null;
	const match = rule.match(/^(PROXY|SOCKS)\s+([^:\s]+):(\d+)/i);
	if (match) {
		return { type: match[1].toUpperCase(), host: match[2], port: parseInt(match[3], 10) };
	}
	return null;
}

function parseEnvProxy(envStr) {
	if (!envStr) return null;
	try {
		const url = new URL(envStr);
		return { type: "HTTP", host: url.hostname, port: parseInt(url.port, 10) || 8080 };
	} catch (e) {
		return null;
	}
}

async function createTunnel(proxy, targetHost, targetPort) {
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
						reject(new Error(`Proxy CONNECT failed: ${data.split("\r\n")[0]}`));
					}
				}
			});
			socket.setTimeout(10000, () => {
				socket.destroy();
				reject(new Error("Proxy CONNECT timeout"));
			});
		});
		socket.on("error", reject);
	});
}

async function connectWithConfig(config, client) {
	const proxy = config._proxyInfo;
	if (proxy) {
		console.log(`[ftp] Connecting via ${proxy.type} proxy ${proxy.host}:${proxy.port}`);
		const socket = await createTunnel(proxy, config.host, config.port || 21);
		await client.access({
			host: config.host,
			port: config.port || 21,
			user: config.user,
			password: config.password,
			secure: config.secure || false,
			secureOptions: config.secure ? { rejectUnauthorized: config.allowSelfSigned ? false : true } : undefined,
			socket: socket
		});
	} else {
		await client.access({
			host: config.host,
			port: config.port || 21,
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
	const clientConfig = { ...config, _proxyInfo: proxyInfo };

	const client = new ftp.Client(clientConfig.timeout || 60000);
	client.ftp.verbose = Boolean(clientConfig.verbose);

	try {
		await connectWithConfig(clientConfig, client);
		return await handler(client);
	} catch (error) {
		const msg = error.message || String(error);
		if ((msg.includes("EPSV") || msg.includes("522")) && !clientConfig._pasvRetried) {
			console.log("[ftp] EPSV failed, retrying with PASV fallback");
			try { client.close(); } catch (e) {}
			const client2 = new ftp.Client(clientConfig.timeout || 60000);
			client2.ftp.verbose = true;
			try {
				await connectWithConfig(clientConfig, client2);
				client2.ftp.pasv = true;
				const retryResult = await handler(client2);
				return retryResult;
			} finally {
				client2.close();
			}
		}
		throw error;
	} finally {
		try { client.close(); } catch (e) {}
	}
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
			proxy: config._proxyInfo ? `${config._proxyInfo.host}:${config._proxyInfo.port}` : "DIRECT"
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
	testConnection,
	uploadFile,
	downloadFile,
	fileExists
};
