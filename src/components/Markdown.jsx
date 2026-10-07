// SPDX-License-Identifier: LGPL-2.1-or-later
// Renders lib/markdown.js's AST as React elements. Every piece of answer text
// lands in a React text node — never innerHTML / dangerouslySetInnerHTML — so
// HTML inside an answer is displayed literally, not interpreted.
import cockpit from 'cockpit';
import React from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { CheckIcon } from "@patternfly/react-icons/dist/esm/icons/check-icon.js";
import { CopyIcon } from "@patternfly/react-icons/dist/esm/icons/copy-icon.js";

import { useClipboard } from '../lib/clipboard.js';
import { parseMarkdown, isSafeUrl } from '../lib/markdown.js';

const _ = cockpit.gettext;

// A fenced code block, with a button that copies its code exactly: no fence,
// no language tag, nothing added. Copy only, never run.
const CodeBlock = ({ text }) => {
    const { copied, error, copy } = useClipboard(text);

    return (
        <div className="ct-md-codeblock">
            <pre className="ct-md-pre"><code>{text}</code></pre>
            <Tooltip content={_("Copy code")}>
                <Button
                    variant="plain" size="sm" className="ct-md-copy-code" aria-label={_("Copy code")}
                    icon={copied ? <CheckIcon /> : <CopyIcon />} onClick={copy}
                >
                    {copied ? _("Copied") : null}
                </Button>
            </Tooltip>
            <span className="pf-v6-screen-reader" aria-live="polite">{copied ? _("Copied") : ""}</span>
            {error && <div className="ct-md-copy-error">{error}</div>}
        </div>
    );
};

function renderInline(nodes) {
    return nodes.map((n, idx) => {
        switch (n.type) {
        case "text":
            return <React.Fragment key={idx}>{n.value}</React.Fragment>;
        case "code":
            return <code key={idx} className="ct-md-code">{n.value}</code>;
        case "strong":
            return <strong key={idx}>{renderInline(n.children)}</strong>;
        case "em":
            return <em key={idx}>{renderInline(n.children)}</em>;
        case "del":
            return <del key={idx}>{renderInline(n.children)}</del>;
        case "break":
            return <br key={idx} />;
        case "link":
            // Unsafe schemes (javascript:, data:, …) keep their text but lose the link.
            if (!isSafeUrl(n.url))
                return <React.Fragment key={idx}>{renderInline(n.children)}</React.Fragment>;
            return (
                <a key={idx} href={n.url} target="_blank" rel="noopener noreferrer">
                    {renderInline(n.children)}
                </a>
            );
        default:
            return null;
        }
    });
}

function renderBlocks(blocks, tight = false) {
    return blocks.map((b, idx) => {
        switch (b.type) {
        case "heading": {
            // Answer headings sit inside a card that already has an h2 title
            const Tag = "h" + Math.min(b.level + 2, 6);
            return <Tag key={idx} className="ct-md-heading">{renderInline(b.children)}</Tag>;
        }
        case "paragraph":
            return tight
                ? <React.Fragment key={idx}>{renderInline(b.children)}</React.Fragment>
                : <p key={idx}>{renderInline(b.children)}</p>;
        case "code":
            return <CodeBlock key={idx} text={b.text} />;
        case "hr":
            return <hr key={idx} />;
        case "blockquote":
            return <blockquote key={idx}>{renderBlocks(b.children)}</blockquote>;
        case "list": {
            const items = b.items.map((item, i) => <li key={i}>{renderBlocks(item, !b.loose)}</li>);
            return b.ordered
                ? <ol key={idx} start={b.start !== 1 ? b.start : undefined}>{items}</ol>
                : <ul key={idx}>{items}</ul>;
        }
        case "table":
            return (
                <div key={idx} className="ct-md-table-wrap">
                    <table className="ct-md-table">
                        <thead>
                            <tr>
                                {b.header.map((h, i) =>
                                    <th key={i} className={b.align[i] ? "ct-md-align-" + b.align[i] : undefined}>
                                        {renderInline(h)}
                                    </th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {b.rows.map((row, r) =>
                                <tr key={r}>
                                    {row.map((cell, i) =>
                                        <td key={i} className={b.align[i] ? "ct-md-align-" + b.align[i] : undefined}>
                                            {renderInline(cell)}
                                        </td>)}
                                </tr>)}
                        </tbody>
                    </table>
                </div>
            );
        default:
            return null;
        }
    });
}

export const Markdown = ({ text }) => (
    <div className="ct-markdown">
        {renderBlocks(parseMarkdown(text))}
    </div>
);
