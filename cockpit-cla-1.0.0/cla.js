// Copyright © 2026 Chip Shabazian - chip@redhat.com
/* global cockpit */
(function () {
    "use strict";

    const TIMEOUT_MS = 30000;                       // same 30s limit as the Flask app
    const BINARIES = ["/bin/c", "c"];               // /bin/c first, then fall back to $PATH
    const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;   // strip colour / cursor escape codes

    const form = document.getElementById("query-form");
    const input = document.getElementById("query");
    const runBtn = document.getElementById("run");
    const newBtn = document.getElementById("new-session");
    const historyEl = document.getElementById("history");
    const statusEl = document.getElementById("status");

    let storageKey = "cla-web:history";
    let history = [];
    let running = false;

    /* ---------- persistence (replaces the Flask in-memory `sessions` dict) ---------- */

    function load() {
        try {
            const raw = window.localStorage.getItem(storageKey);
            history = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(history))
                history = [];
        } catch (e) {
            history = [];
        }
    }

    function save() {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(history));
        } catch (e) {
            /* storage full or unavailable; history just won't persist */
        }
    }

    /* ---------- running the assistant ---------- */

    function clean(text) {
        return (text || "").replace(ANSI_RE, "");
    }

    function trySpawn(bin, query) {
        return new Promise(function (resolve) {
            let timedOut = false;
            // Argument array: no shell involved, so the query can't be used for injection.
            const proc = cockpit.spawn([bin, "-p", query], { err: "message", environment: ["TERM=dumb", "NO_COLOR=1"] });
            const timer = window.setTimeout(function () {
                timedOut = true;
                proc.close("terminated");
            }, TIMEOUT_MS);

            proc.done(function (data) {
                window.clearTimeout(timer);
                resolve({ success: true, output: clean(data), error: "", returncode: 0 });
            });
            proc.fail(function (ex, data) {
                window.clearTimeout(timer);
                if (timedOut) {
                    resolve({ success: false, output: clean(data), error: "Command timed out", returncode: -1 });
                } else if (ex && ex.problem === "not-found") {
                    resolve({ notFound: true });
                } else {
                    resolve({
                        success: true,   // mirrors the original: the process ran, show its output + stderr
                        output: clean(data),
                        error: clean((ex && ex.message) || ""),
                        returncode: (ex && typeof ex.exit_status === "number") ? ex.exit_status : -1
                    });
                }
            });
        });
    }

    async function runCommand(command) {
        if (command.trim() === "")
            return { success: false, output: "", error: "Empty command provided", returncode: 1 };

        for (const bin of BINARIES) {
            const result = await trySpawn(bin, command);
            if (!result.notFound)
                return result;
        }
        return {
            success: false,
            output: "",
            error: "The 'c' command was not found. Install the RHEL Command Line Assistant (command-line-assistant) on this host.",
            returncode: 127
        };
    }

    /* ---------- rendering (textContent only, so output can never inject HTML) ---------- */

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className)
            node.className = className;
        if (text !== undefined)
            node.textContent = text;
        return node;
    }

    function renderEntry(entry) {
        const box = el("section", "entry");
        const cmd = el("div", "entry-command");
        cmd.appendChild(el("span", "prompt", "$ c"));
        cmd.appendChild(el("span", "entry-text", " " + entry.command));
        box.appendChild(cmd);

        const r = entry.result;
        if (r.output)
            box.appendChild(el("pre", "entry-output", r.output));
        if (r.error)
            box.appendChild(el("pre", "entry-error", r.error));
        if (!r.output && !r.error)
            box.appendChild(el("pre", "entry-output muted", "(no output)"));
        if (r.returncode !== 0)
            box.appendChild(el("div", "entry-rc", "exit status " + r.returncode));
        return box;
    }

    function render() {
        historyEl.replaceChildren();
        if (history.length === 0) {
            historyEl.appendChild(el("p", "empty", "No history yet. Enter a query above and press Enter."));
            return;
        }
        // newest first; the stored array stays oldest-first
        history.slice().reverse().forEach(function (entry) {
            historyEl.appendChild(renderEntry(entry));
        });
        historyEl.scrollTop = 0;
    }

    function setRunning(state) {
        running = state;
        runBtn.disabled = state;
        input.disabled = state;
        statusEl.hidden = !state;
        statusEl.textContent = state ? "Running… (30 second limit)" : "";
        if (!state)
            input.focus();
    }

    /* ---------- events ---------- */

    form.addEventListener("submit", async function (event) {
        event.preventDefault();      // Enter key and the button both land here
        if (running)
            return;
        const command = input.value;
        if (command.trim() === "")
            return;

        setRunning(true);
        const result = await runCommand(command);
        history.push({ command: command, result: result });
        save();
        input.value = "";
        setRunning(false);
        render();
    });

    newBtn.addEventListener("click", function () {
        history = [];
        save();
        render();
        input.focus();
    });

    /* ---------- init: scope history to the logged-in Cockpit user ---------- */

    function init() {
        load();
        render();
    }

    if (cockpit.user) {
        cockpit.user().then(function (u) {
            storageKey = "cla-web:history:" + (u && u.name ? u.name : "default");
            init();
        }, init);
    } else {
        init();
    }
}());
