// SPDX-License-Identifier: LGPL-2.1-or-later
// One question and its answer, as asked in this page view. Nothing here is
// stored by the module — the record of it lives in clad's history.
import cockpit from 'cockpit';
import React, { useState, useEffect } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { CheckIcon } from "@patternfly/react-icons/dist/esm/icons/check-icon.js";
import { CopyIcon } from "@patternfly/react-icons/dist/esm/icons/copy-icon.js";

import { AlwaysReview } from './Legal.jsx';
import { Markdown } from './Markdown.jsx';
import { useClipboard } from '../lib/clipboard.js';
import { formatCount, MAX_TOTAL_CHARS } from '../lib/limits.js';

const _ = cockpit.gettext;

// Copies the answer exactly as the assistant wrote it, markdown and all.
const CopyButton = ({ text }) => {
    const { copied, error, copy } = useClipboard(text);

    return (
        <>
            <Tooltip content={_("Copy as Markdown")}>
                <Button
                    variant="secondary" size="sm" className="ct-assistant-copy"
                    icon={copied ? <CheckIcon /> : <CopyIcon />} onClick={copy}
                >
                    {copied ? _("Copied") : _("Copy")}
                </Button>
            </Tooltip>
            <span className="pf-v6-screen-reader" aria-live="polite">{copied ? _("Copied") : ""}</span>
            {error && <span className="ct-assistant-copy-error">{error}</span>}
        </>
    );
};

// The assistant's answer, verbatim, attributed, with Copy and Red Hat's
// always-review line. Shared by the Ask tab and History's expanded rows.
export const AnswerCard = ({ answer, headingLevel = "h2", footer }) => (
    <Card className="ct-assistant-answer">
        <CardHeader actions={{ actions: <CopyButton text={answer} />, hasNoOffset: false }}>
            <CardTitle>
                <Title headingLevel={headingLevel} size="md">{_("Response from the command-line assistant")}</Title>
            </CardTitle>
        </CardHeader>
        <CardBody>
            <Markdown text={answer} />
            <AlwaysReview />
        </CardBody>
        {footer && <CardFooter className="ct-assistant-history-note">{footer}</CardFooter>}
    </Card>
);

// What context went with the question, and which end of it if it was cut.
export function contextNote(context) {
    if (!context?.contextChars)
        return null;
    if (context.trimmed)
        return cockpit.format(
            context.keep === "last"
                ? _("Context: $0, the last $1 of $2 characters sent (trimmed to fit the $3-character limit).")
                : _("Context: $0, the first $1 of $2 characters sent (trimmed to fit the $3-character limit)."),
            context.source, formatCount(context.sentContextChars), formatCount(context.contextChars),
            formatCount(MAX_TOTAL_CHARS));
    return cockpit.format(_("Context: $0, $1 characters sent."), context.source, formatCount(context.contextChars));
}

// Seconds since the question was sent, counted while waiting.
const Elapsed = ({ since }) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const seconds = Math.max(0, Math.floor((now - since) / 1000));
    return <span className="ct-assistant-elapsed">{cockpit.format(_("$0 s"), seconds)}</span>;
};

export const Exchange = ({ entry, innerRef }) => {
    const note = contextNote(entry.context);
    const pending = entry.status === "pending";

    let footer;
    if (entry.historyError)
        footer = (
            <Alert variant="warning" isInline isPlain title={_("The answer was not saved to history")}>
                {entry.historyError}
            </Alert>
        );
    else if (entry.historySaved)
        footer = cockpit.format(_("Saved to chat $0."), entry.chatName);
    else
        footer = _("Saving to history…");

    return (
        <div className="ct-assistant-exchange" ref={innerRef} aria-busy={pending}>
            <div className="ct-assistant-question">
                <span className="ct-assistant-question-label">{_("Q:")}</span>
                <span className="ct-assistant-question-text">{entry.question}</span>
                {note && <div className="ct-assistant-context-note">{note}</div>}
            </div>

            {pending &&
                <div className="ct-assistant-pending">
                    <Spinner size="lg" aria-label={_("Asking the command-line assistant")} />
                    <span>{_("Asking the command-line assistant…")}</span>
                    <Elapsed since={entry.startedAt} />
                </div>}

            {entry.status === "error" &&
                <Alert
                    variant="danger" isInline className="ct-assistant-ask-error"
                    title={_("The command-line assistant returned an error")}
                >
                    {entry.error}
                </Alert>}

            {entry.status === "done" && <AnswerCard answer={entry.answer} footer={footer} />}
        </div>
    );
};
