// SPDX-License-Identifier: LGPL-2.1-or-later
// Host facts sent with every question or shown in the status banner, and the
// user-initiated context file read. Only that file read asks for superuser
// ("try"); the host facts are world-readable and read as the logged-in user.
import cockpit from 'cockpit';

// /etc/os-release is KEY=value, values optionally quoted (os-release(5)).
export function parseOsRelease(text) {
    const result = {};
    for (const line of (text || "").split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!m)
            continue;
        let value = m[2].trim();
        const q = value[0];
        if ((q === '"' || q === "'") && value.endsWith(q) && value.length >= 2)
            value = value.slice(1, -1).replace(/\\(["'\\$`])/g, "$1");
        result[m[1]] = value;
    }
    return result;
}

// Same fields the `c` client sends: NAME, VERSION_ID, ID from os-release,
// plus the machine architecture.
export async function getSystemInfo() {
    const file = cockpit.file("/etc/os-release");
    let osRelease;
    try {
        osRelease = parseOsRelease(await file.read());
    } finally {
        file.close();
    }
    const arch = (await cockpit.spawn(["uname", "-m"], { err: "message" })).trim();
    return {
        os: osRelease.NAME || "",
        version: osRelease.VERSION_ID || "",
        id: osRelease.ID || "",
        arch,
    };
}

// The host's name as the kernel reports it (what `hostname` prints).
export async function getHostname() {
    return (await cockpit.spawn(["uname", "-n"], { err: "message" })).trim();
}

// Installed package version as rpm reports it, or null if not installed.
export async function getPackageVersion(name) {
    try {
        const out = await cockpit.spawn(
            ["rpm", "-q", "--queryformat", "%{VERSION}-%{RELEASE}", name],
            { err: "message" });
        return out.trim();
    } catch (ex) {
        if (ex.exit_status === 1)
            return null; // "package <name> is not installed"
        throw ex;
    }
}

// The session's superuser bridge, from Cockpit's internal cockpit.Superuser
// object: "none" when administrative access is off, "init" while it is
// starting, otherwise the running bridge's id (e.g. "sudo"). A superuser:
// "try" channel goes to that bridge exactly when one is running.
async function superuserCurrent() {
    const client = cockpit.dbus(null, { bus: "internal" });
    try {
        const [current] = await client.call("/superuser", "org.freedesktop.DBus.Properties", "Get",
                                            ["cockpit.Superuser", "Current"]);
        return current.v;
    } catch (ex) {
        console.warn("Could not read cockpit.Superuser Current:", ex);
        return null;
    } finally {
        client.close();
    }
}

// "admin" when a superuser bridge is running, "user" when none is, and null
// when it can't be told (unknown or still starting).
export async function getSuperuserMode() {
    const current = await superuserCurrent();
    if (current === null || current === "init")
        return null;
    return current === "none" ? "user" : "admin";
}

// Read a host file for use as question context. superuser: "try" reads it as
// root when administrative access is turned on, and as the logged-in user
// otherwise, so a root-only file then fails with the bridge's own error.
// cockpit.file() resolves to null for a file that does not exist.
// Anything past 32,000 characters gets trimmed anyway, so refuse huge files
// (problem "too-large") rather than pull them into the browser. The fsread1
// channel has no offset option, so a file is always read whole: keeping only
// its last 32,000 characters happens in the browser (lib/limits.js).
const MAX_CONTEXT_FILE_BYTES = 4 * 1024 * 1024;

// Resolves to { content, readAs }. readAs is "admin" or "user" when the
// superuser state was the same before and after the read, and null when it
// can't be told (unknown, still starting, or changed during the read).
export async function readContextFile(path) {
    const before = await superuserCurrent();
    const file = cockpit.file(path, { superuser: "try", max_read_size: MAX_CONTEXT_FILE_BYTES });
    let content;
    try {
        content = await file.read();
    } finally {
        file.close();
    }
    if (content === null)
        throw new Error(cockpit.format(cockpit.gettext("$0 does not exist."), path));
    if (content.includes("\0"))
        throw new Error(cockpit.format(cockpit.gettext("$0 appears to be a binary file."), path));

    const after = await superuserCurrent();
    let readAs = null;
    if (before === after && before !== null && before !== "init")
        readAs = before === "none" ? "user" : "admin";
    return { content, readAs };
}
