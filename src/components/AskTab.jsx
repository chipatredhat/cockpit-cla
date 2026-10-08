// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from 'cockpit';
import React, { useState, useRef, useEffect } from 'react';
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { OutlinedQuestionCircleIcon } from "@patternfly/react-icons/dist/esm/icons/outlined-question-circle-icon.js";
import { PaperclipIcon } from "@patternfly/react-icons/dist/esm/icons/paperclip-icon.js";

import { Exchange } from './Exchange.jsx';
import { LegalNotice } from './Legal.jsx';
import { askQuestion, buildQuestion, ensureChat, writeHistory } from '../lib/clad.js';
import { getSuperuserMode, readContextFile } from '../lib/host-info.js';
import { fitToLimit, formatCount, MAX_TOTAL_CHARS } from '../lib/limits.js';

const _ = cockpit.gettext;

function errorText(ex) {
    if (ex?.problem === "too-large")
        return _("The file is too large to read as context.");
    return ex?.message || String(ex);
}

// How the context file was read, as readContextFile() could tell it.
function readAsText({ readAs, userName }) {
    if (readAs === "admin")
        return _("Read as administrator.");
    if (readAs === "user" && userName)
        return cockpit.format(_("Read as $0."), userName);
    if (readAs === "user")
        return _("Read with your own permissions.");
    return _("Read with administrative access when available.");
}

// Where the context came from, in words: a file's path, or pasted text.
function sourceText(source) {
    if (!source)
        return _("pasted text");
    if (source.edited)
        return cockpit.format(_("edited text from $0"), source.path);
    return source.path;
}

// One line of the identity sent with every question, values verbatim from
// /etc/os-release and uname -m. The checkbox (checked by default, as the `c`
// client always sends it) leaves it out of the next question.
const SystemInfoLine = ({ systemInfo, isSent, onToggle }) => (
    <div className="ct-assistant-systeminfo">
        <Checkbox
            id="ct-assistant-send-systeminfo" isChecked={isSent}
            onChange={(_ev, v) => onToggle(v)}
            label={
                <>
                    {_("Send with each question:")}{" "}
                    <strong>{systemInfo.os} {systemInfo.version}</strong>{" "}
                    (<code>{systemInfo.id}</code>) · <code>{systemInfo.arch}</code>
                </>
            }
        />
        <Popover
            bodyContent={_("Terminal output is never sent: there is no terminal session behind the web console.")}
            aria-label={_("What else is sent")}
        >
            <Button
                variant="plain" size="sm" className="ct-assistant-systeminfo-help"
                aria-label={_("What else is sent")} icon={<OutlinedQuestionCircleIcon />}
            />
        </Popover>
    </div>
);

// The context that goes with the next question. Always shown while there is
// any, so nothing is sent that the user can't see right above the Ask button.
const Attachment = ({ source, fit, keep, onKeep, onChange, onRemove }) => {
    const sentence = fit.trimmed
        ? cockpit.format(keep === "last"
            ? _("the last $0 of $1 characters will be sent.")
            : _("the first $0 of $1 characters will be sent."),
                         formatCount(fit.sentContextChars), formatCount(fit.contextChars))
        : cockpit.format(cockpit.ngettext("$0 character will be sent.", "all $0 characters will be sent.", fit.contextChars),
                         formatCount(fit.contextChars));

    return (
        <div className={"ct-assistant-attachment" + (source ? " ct-assistant-file-loaded" : "")}>
            <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
                <FlexItem className="ct-assistant-attachment-text">
                    <PaperclipIcon className="ct-assistant-attachment-icon" />{" "}
                    {source && !source.edited
                        ? <>{_("Context attached from")} <code>{source.path}</code>: {sentence}</>
                        : <>{cockpit.format(_("Context attached ($0):"), sourceText(source))} {sentence}</>}
                    {source && <>{" "}<span className="ct-assistant-file-read-as">{readAsText(source)}</span></>}
                </FlexItem>
                <FlexItem>
                    <Button variant="link" isInline onClick={onChange}>{_("Change")}</Button>
                </FlexItem>
                <FlexItem>
                    <Button variant="link" isInline onClick={onRemove}>{_("Remove")}</Button>
                </FlexItem>
            </Flex>
            {fit.trimmed &&
                <Flex
                    className="ct-assistant-keep" role="radiogroup" aria-label={_("Which part of the context to send")}
                    spaceItems={{ default: "spaceItemsLg" }} alignItems={{ default: "alignItemsCenter" }}
                >
                    <FlexItem>{_("Send:")}</FlexItem>
                    <Radio
                        id="ct-assistant-keep-last" name="ct-assistant-keep" isChecked={keep === "last"}
                        onChange={() => onKeep("last")}
                        label={cockpit.format(_("The last $0 characters"), formatCount(fit.sentContextChars))}
                    />
                    <Radio
                        id="ct-assistant-keep-first" name="ct-assistant-keep" isChecked={keep === "first"}
                        onChange={() => onKeep("first")}
                        label={cockpit.format(_("The first $0 characters"), formatCount(fit.sentContextChars))}
                    />
                </Flex>}
        </div>
    );
};

// Between exchanges saved to different chats, so a new chat doesn't look
// like it already holds the questions asked before the switch.
const ChatDivider = ({ chatName }) => (
    <div className="ct-assistant-chat-divider">
        <Divider />
        <span className="ct-assistant-chat-divider-text">
            {cockpit.format(_("Asked earlier on this page, saved to chat $0"), chatName)}
        </span>
    </div>
);

// Scroll a just-answered exchange up if little or none of it is on screen.
function revealAnswer(el) {
    const rect = el.getBoundingClientRect();
    const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (visible < Math.min(rect.height, 200))
        el.scrollIntoView({ block: "start" });
}

// chatName is the chat selected in the header; each question is written into
// the chat that was selected when it was asked. onChatUsed lets the header
// re-read the chat list (the web console's chat may have just been created).
// focusRequest: bumped by the page to move focus to the question box.
export const AskTab = ({ canAsk, userId, managed, chatName, onChatUsed, systemInfo, systemInfoError, focusRequest }) => {
    const [question, setQuestion] = useState("");
    const [context, setContext] = useState("");
    // A read file: { path, readAs, userName, edited }; null for pasted text.
    const [source, setSource] = useState(/** @type {Object|null} */ (null));
    const [keep, setKeep] = useState("first"); // which end of the context survives a trim
    const [sendSystemInfo, setSendSystemInfo] = useState(true); // the systeminfo line below the form
    const [contextExpanded, setContextExpanded] = useState(false);
    const [showPath, setShowPath] = useState(false);
    const [filePath, setFilePath] = useState("");
    const [fileBusy, setFileBusy] = useState(false);
    const [fileError, setFileError] = useState(null); // { text, hint }
    const [entries, setEntries] = useState(/** @type {Object[]} */ ([]));
    const [announcement, setAnnouncement] = useState("");
    const [blocked, setBlocked] = useState(false); // Enter pressed while Ask can't run
    const [fileReads, setFileReads] = useState(0);
    const nextId = useRef(0);
    const askRef = useRef(null);
    const contextRef = useRef(null);
    const newestRef = useRef(null);

    const fit = fitToLimit(question, context, keep);
    const busy = entries.some(e => e.status === "pending");

    let disabledReason = null;
    if (!canAsk)
        disabledReason = _("Not connected to the command-line assistant.");
    else if (!systemInfo)
        disabledReason = systemInfoError
            ? _("The system information sent with each question could not be read.")
            : _("Reading the system information sent with each question…");
    else if (busy)
        disabledReason = _("Waiting for the current answer. Your question stays in the box until you ask it.");
    else if (question.trim() === "")
        disabledReason = _("Type a question to ask.");
    else if (fit.questionTooLong)
        disabledReason = cockpit.format(_("The question is over the $0-character limit."), formatCount(MAX_TOTAL_CHARS));
    const askDisabled = disabledReason !== null;

    const newest = entries[0];
    useEffect(() => {
        if (newest?.status === "pending")
            newestRef.current?.scrollIntoView({ block: "nearest" });
        else if (newest && newestRef.current)
            revealAnswer(newestRef.current);
    }, [newest?.id, newest?.status]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keeping the last characters: show that end of the context.
    useEffect(() => {
        if (contextExpanded && keep === "last" && contextRef.current)
            contextRef.current.scrollTop = contextRef.current.scrollHeight;
    }, [contextExpanded, keep, fileReads]);

    useEffect(() => {
        if (focusRequest)
            setTimeout(() => document.getElementById("ct-assistant-question")?.focus(), 0);
    }, [focusRequest]);

    const updateEntry = (id, changes) =>
        setEntries(list => list.map(e => (e.id === id ? { ...e, ...changes } : e)));

    const removeContext = () => {
        setContext("");
        setSource(null);
        setKeep("first");
    };

    const onContextChange = value => {
        if (!value) {
            removeContext();
            return;
        }
        if (!context) {
            // New pasted text: a user who pastes usually pastes what they mean.
            setSource(null);
            setKeep("first");
        } else if (source && !source.edited) {
            setSource({ ...source, edited: true });
        }
        setContext(value);
    };

    const readFile = async () => {
        const path = filePath.trim();
        setFileError(null);
        setFileBusy(true);
        try {
            const { content, readAs } = await readContextFile(path);
            let userName = null;
            if (readAs === "user") {
                try {
                    userName = (await cockpit.user()).name;
                } catch (ex) {
                    console.warn("Could not look up the user name:", ex);
                }
            }
            setContext(content);
            setSource({ path, readAs, userName, edited: false });
            setKeep("last"); // logs grow at the end
            setFileReads(n => n + 1);
            setContextExpanded(false);
            setTimeout(() => document.getElementById("ct-assistant-question")?.focus(), 0);
        } catch (ex) {
            let hint = null;
            if (ex?.problem === "access-denied" && await getSuperuserMode() === "user")
                hint = _("Turn on administrative access to read root-only files.");
            setFileError({ text: errorText(ex), hint });
        } finally {
            setFileBusy(false);
        }
    };

    const ask = async () => {
        const sentQuestion = question;
        const sentChat = chatName;
        const sent = fitToLimit(sentQuestion, context, keep);
        const id = nextId.current++;
        // Newest first: the answer appears right under the Ask box. The
        // context stays attached (and shown) for a follow-up.
        setEntries(list => [{
            id,
            chatName: sentChat,
            question: sentQuestion,
            context: {
                source: sourceText(source),
                contextChars: sent.contextChars,
                sentContextChars: sent.sentContextChars,
                trimmed: sent.trimmed,
                keep,
            },
            status: "pending",
            startedAt: Date.now(),
        }, ...list]);
        setQuestion("");
        setBlocked(false);
        setAnnouncement(_("Asking the command-line assistant…"));

        let chatId, answer;
        try {
            // Resolve the chat first, as upstream `c` does, so a failure here
            // doesn't throw away an answer we already paid for.
            chatId = await ensureChat(userId, sentChat);
            onChatUsed();
            answer = await askQuestion(userId,
                                       buildQuestion(sentQuestion, sent.context,
                                                     sendSystemInfo ? systemInfo : null));
        } catch (ex) {
            updateEntry(id, { status: "error", error: errorText(ex) });
            setAnnouncement(_("The command-line assistant returned an error."));
            return;
        }
        updateEntry(id, { status: "done", answer });
        setAnnouncement(_("Answer received from the command-line assistant."));

        try {
            await writeHistory(chatId, userId, sentQuestion, answer);
            updateEntry(id, { historySaved: true });
        } catch (ex) {
            updateEntry(id, { historyError: errorText(ex) });
        }
    };

    const onSubmit = ev => {
        ev.preventDefault();
        if (askDisabled)
            setBlocked(true);
        else
            ask();
    };

    // Enter asks, through the same guard as the Ask button; Shift+Enter is a newline.
    const onQuestionKeyDown = ev => {
        if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing)
            onSubmit(ev);
    };

    const openEditor = () => {
        setContextExpanded(true);
        setTimeout(() => contextRef.current?.focus(), 0);
    };

    const tooLongTitle = cockpit.format(_("The question alone is $0 characters, over the $1-character limit"),
                                        formatCount(fit.questionChars), formatCount(MAX_TOTAL_CHARS));

    let lastChat = chatName;
    const exchangeList = [];
    entries.forEach((e, idx) => {
        if (e.chatName !== lastChat) {
            exchangeList.push(<ChatDivider key={"divider-" + e.id} chatName={e.chatName} />);
            lastChat = e.chatName;
        }
        exchangeList.push(<Exchange key={e.id} entry={e} innerRef={idx === 0 ? newestRef : undefined} />);
    });

    return (
        <div className="ct-assistant-ask">
            <div className="pf-v6-screen-reader ct-assistant-announcer" role="status" aria-live="polite">
                {announcement}
            </div>

            {systemInfoError &&
                <Alert variant="danger" isInline title={_("Could not read the system information sent with each question")}>
                    {systemInfoError}
                </Alert>}

            <Card className="ct-assistant-form-card">
                <CardBody>
                    <Form onSubmit={onSubmit} className="ct-assistant-form">
                        <FormGroup
                            label={_("Ask the command-line assistant")} fieldId="ct-assistant-question"
                            labelInfo={
                                <span className="ct-assistant-saved-to">
                                    {_("Saved to chat:")} <strong>{chatName}</strong>
                                </span>
                            }
                        >
                            <TextArea
                                id="ct-assistant-question" value={question} resizeOrientation="vertical"
                                onChange={(_ev, v) => { setQuestion(v); setBlocked(false) }}
                                onKeyDown={onQuestionKeyDown}
                                rows={3} autoResize
                                aria-label={_("Question")}
                            />
                        </FormGroup>

                        {context &&
                            <Attachment
                                source={source} fit={fit} keep={keep} onKeep={setKeep}
                                onChange={openEditor} onRemove={removeContext}
                            />}

                        <Flex
                            className="ct-assistant-actions" spaceItems={{ default: "spaceItemsMd" }}
                            alignItems={{ default: "alignItemsCenter" }}
                        >
                            <FlexItem>
                                <Button
                                    variant="primary" type="submit" ref={askRef}
                                    isAriaDisabled={askDisabled} isLoading={busy}
                                >
                                    {_("Ask")}
                                </Button>
                                {disabledReason && <Tooltip content={disabledReason} triggerRef={askRef} />}
                            </FlexItem>
                            {(busy || (blocked && askDisabled)) &&
                                <FlexItem className="ct-assistant-ask-status">
                                    {busy && <span>{_("Asking…")}</span>}
                                    {blocked && askDisabled && <span className="ct-assistant-blocked">{disabledReason}</span>}
                                </FlexItem>}
                            <FlexItem>
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Enter to ask, Shift+Enter for a new line. Each question is answered on its own: earlier questions and answers on this page are not sent as context.")}
                                    </HelperTextItem>
                                </HelperText>
                            </FlexItem>
                        </Flex>

                        {fit.questionTooLong &&
                            <Alert variant="danger" isInline className="ct-assistant-trim-notice" title={tooLongTitle}>
                                {_("The question is never trimmed. Shorten it to ask.")}
                            </Alert>}

                        <ExpandableSection
                            toggleText={_("Add context (paste text or read a file on this host)")}
                            isExpanded={contextExpanded}
                            onToggle={(_ev, v) => setContextExpanded(v)}
                            className="ct-assistant-context"
                        >
                            <Flex className="ct-assistant-context-toolbar" spaceItems={{ default: "spaceItemsMd" }}>
                                <Button variant="link" isInline onClick={() => setShowPath(!showPath)} aria-expanded={showPath}>
                                    {_("Read a file on this host…")}
                                </Button>
                                <Button variant="link" isInline isDisabled={!context} onClick={removeContext}>
                                    {_("Clear")}
                                </Button>
                            </Flex>

                            {showPath &&
                                <div className="ct-assistant-path">
                                    <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'nowrap' }}>
                                        <FlexItem grow={{ default: 'grow' }}>
                                            <TextInput
                                                id="ct-assistant-context-file" value={filePath}
                                                onChange={(_ev, v) => setFilePath(v)}
                                                onKeyDown={ev => {
                                                    if (ev.key === "Enter") {
                                                        ev.preventDefault();
                                                        if (!fileBusy && filePath.trim())
                                                            readFile();
                                                    }
                                                }}
                                                placeholder={_("e.g. /var/log/messages")} aria-label={_("File path")}
                                            />
                                        </FlexItem>
                                        <FlexItem>
                                            <Button
                                                variant="secondary" isLoading={fileBusy}
                                                isDisabled={fileBusy || filePath.trim() === ""} onClick={readFile}
                                            >
                                                {_("Read file")}
                                            </Button>
                                        </FlexItem>
                                    </Flex>
                                    <HelperText>
                                        <HelperTextItem>
                                            {_("Uses administrative access when it is on. The file's contents replace the context text.")}
                                        </HelperTextItem>
                                    </HelperText>
                                </div>}

                            {fileError &&
                                <Alert variant="danger" isInline isPlain title={_("Could not read the file")}>
                                    {fileError.text}
                                    {fileError.hint && <div className="ct-assistant-file-hint">{fileError.hint}</div>}
                                </Alert>}

                            <TextArea
                                id="ct-assistant-context-text" value={context} rows={6} resizeOrientation="vertical"
                                ref={contextRef} onChange={(_ev, v) => onContextChange(v)}
                                aria-label={_("Context text")}
                            />
                        </ExpandableSection>

                        <div className="ct-assistant-sent">
                            <LegalNotice managed={managed} />
                            <Flex
                                justifyContent={{ default: 'justifyContentSpaceBetween' }}
                                alignItems={{ default: 'alignItemsCenter' }}
                            >
                                <FlexItem>
                                    {systemInfo &&
                                        <SystemInfoLine
                                            systemInfo={systemInfo} isSent={sendSystemInfo}
                                            onToggle={setSendSystemInfo}
                                        />}
                                </FlexItem>
                                {context && !fit.questionTooLong &&
                                    <FlexItem className="ct-assistant-counter">
                                        {cockpit.format(_("$0 context + $1 question / $2 characters"),
                                                        formatCount(fit.sentContextChars), formatCount(fit.questionChars),
                                                        formatCount(MAX_TOTAL_CHARS))}
                                    </FlexItem>}
                            </Flex>
                        </div>
                    </Form>
                </CardBody>
            </Card>

            {entries.length > 0 &&
                <div className="ct-assistant-exchanges">
                    {exchangeList}
                </div>}
        </div>
    );
};
