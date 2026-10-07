// SPDX-License-Identifier: LGPL-2.1-or-later
// clad's history for the logged-in user, across every chat (the web
// console's and the c command's). Re-read from clad each time the tab is
// shown; nothing is kept by the module. Stored answers are as untrusted as live
// ones, so they go through the same Markdown renderer.
import cockpit from 'cockpit';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import {
    Toolbar, ToolbarContent, ToolbarGroup, ToolbarItem
} from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
import { SortByDirection } from "@patternfly/react-table/dist/esm/components/Table/index.js";
import { DownloadIcon } from "@patternfly/react-icons/dist/esm/icons/download-icon.js";
import { HistoryIcon } from "@patternfly/react-icons/dist/esm/icons/history-icon.js";
import { SyncAltIcon } from "@patternfly/react-icons/dist/esm/icons/sync-alt-icon.js";
import { ListingTable } from 'cockpit-components-table';

import { AnswerCard } from './Exchange.jsx';
import { clearAllHistory, clearHistory, getHistory, isHistoryNotEnabled } from '../lib/clad.js';
import { getHostname } from '../lib/host-info.js';
import { downloadText, historyFilename, historyMarkdown } from '../lib/history-export.js';

const _ = cockpit.gettext;

// The table's columns, in order, and what each sorts by.
const SORT_KEYS = [e => e.createdAt, e => e.question, e => e.chatName];

// The same order ListingTable gives its rows: ascending by the column's
// sort key (a stable sort), then reversed for descending.
function sortEntries(entries, index, direction) {
    const key = SORT_KEYS[index] || SORT_KEYS[0];
    const sorted = [...entries].sort((a, b) => key(a).localeCompare(key(b)));
    return direction === SortByDirection.asc ? sorted : sorted.reverse();
}

function matches(entry, needle) {
    return entry.question.toLowerCase().includes(needle) || entry.response.toLowerCase().includes(needle);
}

// The question is already in the row; the expanded row is the answer, in the
// same card the Ask tab uses.
const HistoryAnswer = ({ entry }) => (
    <div className="ct-assistant-history-entry">
        <AnswerCard answer={entry.response} headingLevel="h3" />
    </div>
);

const ClearModal = ({ title, onClose, onConfirm, confirmLabel, children }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const confirm = async () => {
        setError(null);
        setBusy(true);
        try {
            await onConfirm();
        } catch (ex) {
            setError(ex?.message || String(ex));
            setBusy(false);
        }
    };

    return (
        <Modal isOpen onClose={onClose} variant="small" className="ct-assistant-clear-modal">
            <ModalHeader title={title} titleIconVariant="warning" />
            <ModalBody>
                {children}
                {error && <Alert variant="danger" isInline title={_("Could not clear the history")}>{error}</Alert>}
            </ModalBody>
            <ModalFooter>
                <Button variant="danger" onClick={confirm} isLoading={busy} isDisabled={busy}>{confirmLabel}</Button>
                <Button variant="link" onClick={onClose} isDisabled={busy}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};

export const HistoryTab = ({ userId, chatName, chatExists, active }) => {
    const [entries, setEntries] = useState(/** @type {Object[]|null} */ (null));
    const [error, setError] = useState(null);
    const [notEnabled, setNotEnabled] = useState(null);
    const [search, setSearch] = useState("");
    const [scope, setScope] = useState("all"); // "all" | "chat"
    const [dialog, setDialog] = useState(null); // "chat" | "all"
    const [hostname, setHostname] = useState(null);
    const [exportError, setExportError] = useState(null);
    const loadId = useRef(0);
    const clearChatRef = useRef(null);
    // The table's current sort, so Export writes the rows in the order shown.
    const sortRef = useRef({ index: 0, direction: SortByDirection.desc });

    useEffect(() => {
        getHostname()
                .then(setHostname)
                .catch(ex => console.warn("Could not read the host name:", ex));
    }, []);

    const load = useCallback(async () => {
        const requestId = ++loadId.current;
        try {
            const list = await getHistory(userId);
            if (requestId !== loadId.current)
                return;
            setEntries(list.map((e, idx) => ({ ...e, key: String(idx) })));
            setError(null);
            setNotEnabled(null);
        } catch (ex) {
            if (requestId !== loadId.current)
                return;
            setEntries([]);
            if (isHistoryNotEnabled(ex))
                setNotEnabled(ex.message);
            else
                setError(ex?.message || String(ex));
        }
    }, [userId]);

    useEffect(() => {
        if (active && userId)
            load();
    }, [active, userId, load]);

    const closeDialog = () => setDialog(null);

    if (notEnabled)
        return (
            <Alert
                variant="info" isInline className="ct-assistant-history-disabled"
                title={_("History is not enabled in the command-line assistant's configuration")}
            >
                {notEnabled}
            </Alert>
        );

    const all = entries || [];
    const scoped = scope === "chat" ? all.filter(e => e.chatName === chatName) : all;
    const needle = search.trim().toLowerCase();
    const shown = needle ? scoped.filter(e => matches(e, needle)) : scoped;

    const countText = shown.length === scoped.length
        ? cockpit.format(cockpit.ngettext("$0 entry", "$0 entries", scoped.length), scoped.length)
        : cockpit.format(_("Showing $0 of $1 entries"), shown.length, scoped.length);

    // clad stamps created-at with its own clock, in the host's time zone, and
    // with no zone in the value (verified on RHEL 9 and 10).
    const columns = [
        { title: _("Time (host's local time)"), sortable: true, props: { width: 20 } },
        { title: _("Question"), sortable: true, props: { width: 60 } },
        { title: _("Chat"), sortable: true, props: { width: 15 } },
    ];

    const rowsByKey = {};
    const rows = shown.map(e => (rowsByKey[e.key] = {
        props: { key: e.key, className: "ct-assistant-history-row" },
        columns: [
            { title: <span className="ct-assistant-history-time">{e.createdAt}</span>, sortKey: e.createdAt },
            { title: <span className="ct-assistant-history-question">{e.question}</span>, sortKey: e.question },
            { title: <span className="ct-assistant-history-chat">{e.chatName}</span>, sortKey: e.chatName },
        ],
        hasPadding: true,
        expandedContent: <HistoryAnswer entry={e} />,
    }));

    const sortRows = (tableRows, direction, index) => {
        sortRef.current = { index, direction };
        if (shown.length === 0)
            return tableRows; // ListingTable's "no entries" caption row
        return sortEntries(shown, index, direction).map(e => rowsByKey[e.key]);
    };

    // Exactly the entries in the table now (scope, search and sort), verbatim.
    const exportShown = () => {
        setExportError(null);
        const exportedAt = new Date();
        const scopeName = scope === "chat" ? chatName : null;
        const { index, direction } = sortRef.current;
        const entries = sortEntries(shown, index, direction);
        const filter = search.trim();
        try {
            downloadText(historyFilename({ hostname, scope: scopeName, exportedAt }),
                         historyMarkdown({ hostname, scope: scopeName, filter, exportedAt, entries }));
        } catch (ex) {
            setExportError(ex?.message || String(ex));
        }
    };

    // Clearing acts on the chat selected in the header, so it is only offered
    // while the table is scoped to that chat.
    const clearChatReason = scope !== "chat"
        ? cockpit.format(_("Select Only $0 to clear that chat."), chatName)
        : !chatExists
            ? cockpit.format(_("There is no chat named $0 yet."), chatName)
            : null;

    const toolbar = (
        <Toolbar className="ct-assistant-history-toolbar">
            <ToolbarContent>
                <ToolbarItem>
                    <SearchInput
                        className="ct-assistant-history-search" aria-label={_("Search history")}
                        placeholder={_("Search history")}
                        value={search} onChange={(_ev, v) => setSearch(v)} onClear={() => setSearch("")}
                    />
                </ToolbarItem>
                <ToolbarItem>
                    <ToggleGroup aria-label={_("Which chats")}>
                        <ToggleGroupItem
                            text={_("All chats")} buttonId="ct-assistant-history-scope-all"
                            isSelected={scope === "all"} onChange={() => setScope("all")}
                        />
                        <ToggleGroupItem
                            text={cockpit.format(_("Only $0"), chatName)} buttonId="ct-assistant-history-scope-chat"
                            isSelected={scope === "chat"} onChange={() => setScope("chat")}
                        />
                    </ToggleGroup>
                </ToolbarItem>
                <ToolbarItem className="ct-assistant-history-count" alignSelf="center">{entries && countText}</ToolbarItem>
                <ToolbarGroup align={{ default: "alignEnd" }}>
                    <ToolbarItem>
                        <Button variant="plain" icon={<SyncAltIcon />} aria-label={_("Refresh history")} onClick={load} />
                    </ToolbarItem>
                    <ToolbarItem>
                        <Button
                            variant="secondary" className="ct-assistant-export" icon={<DownloadIcon />}
                            isDisabled={shown.length === 0} onClick={exportShown}
                        >
                            {_("Export")}
                        </Button>
                    </ToolbarItem>
                    <ToolbarItem>
                        <Button
                            variant="secondary" ref={clearChatRef} className="ct-assistant-clear-chat"
                            isAriaDisabled={clearChatReason !== null} onClick={() => setDialog("chat")}
                        >
                            {cockpit.format(_("Clear chat $0…"), chatName)}
                        </Button>
                        {clearChatReason && <Tooltip content={clearChatReason} triggerRef={clearChatRef} />}
                    </ToolbarItem>
                    <ToolbarItem>
                        <Button variant="secondary" isDisabled={all.length === 0} onClick={() => setDialog("all")}>
                            {_("Clear all history")}
                        </Button>
                    </ToolbarItem>
                </ToolbarGroup>
            </ToolbarContent>
        </Toolbar>
    );

    let body;
    if (entries === null)
        body = <ListingTable key="loading" columns={columns} rows={[]} loading={_("Loading history…")} />;
    else if (all.length === 0 && !error)
        body = (
            <EmptyState headingLevel="h2" icon={HistoryIcon} titleText={_("No history")} className="ct-assistant-history-empty">
                <EmptyStateBody>
                    {_("Questions asked here or with the c command, and their answers, appear here.")}
                </EmptyStateBody>
            </EmptyState>
        );
    else
        body = (
            <ListingTable
                key="history"
                aria-label={_("History")} className="ct-assistant-history-table"
                columns={columns} rows={rows}
                sortBy={{ index: 0, direction: SortByDirection.desc }} sortMethod={sortRows}
                emptyCaption={needle ? _("No entries match the search") : _("No entries in this chat")}
            />
        );

    return (
        <div className="ct-assistant-history">
            {error &&
                <Alert variant="danger" isInline title={_("Could not read the history")}>{error}</Alert>}
            {exportError &&
                <Alert variant="danger" isInline title={_("Could not export the history")}>{exportError}</Alert>}
            {toolbar}
            {body}

            {dialog === "chat" &&
                <ClearModal
                    title={cockpit.format(_("Clear the history of the chat named $0?"), chatName)}
                    confirmLabel={_("Clear chat")} onClose={closeDialog}
                    onConfirm={async () => { await clearHistory(userId, chatName); closeDialog(); load() }}
                >
                    <p>
                        {cockpit.format(_("This removes every entry in the chat named $0 from your history, including ones asked with the c command. The chat is kept. The text stays in the assistant's database on this host, readable only by root."), chatName)}
                    </p>
                </ClearModal>}
            {dialog === "all" &&
                <ClearModal
                    title={_("Clear all history?")}
                    confirmLabel={_("Clear all history")} onClose={closeDialog}
                    onConfirm={async () => { await clearAllHistory(userId); closeDialog(); load() }}
                >
                    <p>
                        {_("This removes all of your entries from every chat, including the c command's history. Your chats are kept. The text stays in the assistant's database on this host, readable only by root.")}
                    </p>
                </ClearModal>}
        </div>
    );
};
