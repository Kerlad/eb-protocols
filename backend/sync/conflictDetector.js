function toNumber(value) {
	const num = Number(value);
	return Number.isFinite(num) ? num : 0;
}

function toTime(value) {
	if (!value) return 0;
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : 0;
}

function compareDbState(local, remote) {
	if (!remote) {
		return {
			status: "no_remote",
			recommendation: "upload",
			details: "Удаленная база отсутствует — можно выгрузить локальную"
		};
	}

	const localRevision = toNumber(local.syncRevision);
	const remoteRevision = toNumber(remote.syncRevision);
	const localModified = toTime(local.lastModifiedAt);
	const remoteModified = toTime(remote.lastModifiedAt);
	const localSynced = toTime(local.lastSyncedAt);

	const localCount = toNumber(local.journalCountTotal);
	const remoteCount = toNumber(remote.journalCountTotal);

	if (localRevision === remoteRevision && localCount === remoteCount) {
		return {
			status: "in_sync",
			recommendation: "none",
			details: "Локальная и удаленная базы совпадают"
		};
	}

	const localChangedSinceSync = localModified > localSynced;
	const remoteChangedSinceSync = remoteModified > localSynced;

	if (localChangedSinceSync && remoteChangedSinceSync) {
		return {
			status: "conflict",
			recommendation: "manual",
			details: "Изменения есть и локально, и на сервере — требуется ручное решение",
			localCount,
			remoteCount
		};
	}

	if (remoteRevision > localRevision || remoteModified > localModified) {
		return {
			status: "remote_newer",
			recommendation: "download",
			details: "На сервере более свежая версия",
			localCount,
			remoteCount
		};
	}

	return {
		status: "local_newer",
		recommendation: "upload",
		details: "Локальная версия новее",
		localCount,
		remoteCount
	};
}

module.exports = {
	compareDbState
};
