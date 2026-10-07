// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from 'cockpit';
import React from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { CheckCircleIcon } from "@patternfly/react-icons/dist/esm/icons/check-circle-icon.js";
import { ExclamationCircleIcon } from "@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon.js";
import { ExternalLinkAltIcon } from "@patternfly/react-icons/dist/esm/icons/external-link-alt-icon.js";
import { LockIcon } from "@patternfly/react-icons/dist/esm/icons/lock-icon.js";
import { InfoCircleIcon } from "@patternfly/react-icons/dist/esm/icons/info-circle-icon.js";
import { PackageIcon } from "@patternfly/react-icons/dist/esm/icons/package-icon.js";

import { MIN_VERSION, showsRedHatSentence } from '../lib/clad.js';

const _ = cockpit.gettext;

export const FEEDBACK_ADDRESS = "cla-feedback@redhat.com";
// Problems with this module itself (the metainfo's bugtracker URL).
export const ISSUES_URL = "https://github.com/chipatredhat/cockpit-cla/issues";

// The label beside the page title, one per state. It says what the state is;
// what to do about it is in the body below the title (StatusDetail).
function stateLabel(state) {
    switch (state) {
    case "loading":
        return { color: "grey", text: _("Connecting…") };
    case "connected":
        return { color: "green", icon: <CheckCircleIcon />, text: _("Connected") };
    case "not-installed":
        return { color: "grey", text: _("Not installed") };
    case "unsupported":
        return { color: "grey", text: _("Unsupported version") };
    case "disabled":
        // An administrator's choice, not a fault.
        return { color: "grey", icon: <LockIcon />, text: _("Disabled") };
    default:
        return { color: "red", icon: <ExclamationCircleIcon />, text: _("Connection error") };
    }
}

// What `c feedback` prints (command_line_assistant/commands/feedback.py,
// 0.5.2, identical on RHEL 9 and 10): the notice, with Red Hat's extra
// sentence when `c` of the installed build adds it (showsRedHatSentence),
// then the address.
const Feedback = ({ managed }) => {
    const [before, after] = _("To submit feedback, use the following email address: $0.").split("$0");
    return (
        <div className="ct-assistant-feedback">
            <Title headingLevel="h2" size="md" className="ct-assistant-feedback-title">
                {_("Feedback on the command-line assistant")}
            </Title>
            <p className="ct-assistant-feedback-notice">
                {_("Do not include any personal information or other sensitive information in your feedback.")}
                {showsRedHatSentence(managed) &&
                    <span className="ct-assistant-feedback-managed">
                        {" " + _("Feedback may be used to improve Red Hat's products or services.")}
                    </span>}
            </p>
            <p className="ct-assistant-feedback-address">
                {before}<a href={"mailto:" + FEEDBACK_ADDRESS}>{FEEDBACK_ADDRESS}</a>{after}
            </p>
        </div>
    );
};

// Problems with this web console module go to its issue tracker, not to the
// assistant's feedback address.
const ModuleFeedback = () => (
    <div className="ct-assistant-module-feedback">
        <Title headingLevel="h2" size="md" className="ct-assistant-feedback-title">{_("Feedback on this page")}</Title>
        <p>
            <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
                {_("Report a problem with this module")} <ExternalLinkAltIcon />
            </a>
        </p>
    </div>
);

// The state label and, always beside it, the (i) "About" popover. Each line in
// it is shown only once it is known: the endpoint once clad has answered
// IsRedHatManagedEndpoint (never on builds without it, which give no way to
// know), each version once rpm has reported it.
export const StatusLabel = ({ state, about }) => {
    const label = stateLabel(state);
    const endpointKnown = typeof about.managed === "boolean";
    return (
        <span className={"ct-assistant-status ct-assistant-status-" + state}>
            <Label color={label.color} icon={label.icon} isCompact className="ct-assistant-status-label">
                {label.text}
            </Label>
            <Popover
                className="ct-assistant-about" aria-label={_("About")} position="bottom-end"
                bodyContent={
                    <>
                        {endpointKnown &&
                            <div className="ct-assistant-endpoint">
                                {about.managed ? _("Red Hat managed endpoint") : _("Not a Red Hat managed endpoint")}
                            </div>}
                        {about.version &&
                            <div className="ct-assistant-version">
                                {cockpit.format(_("command-line-assistant $0"), about.version)}
                            </div>}
                        {about.moduleVersion &&
                            <div className="ct-assistant-module-version">
                                {cockpit.format(_("cockpit-cla $0"), about.moduleVersion)}
                            </div>}
                        {(endpointKnown || about.version || about.moduleVersion) &&
                            <Divider className="ct-assistant-about-divider" />}
                        <Feedback managed={about.managed} />
                        <ModuleFeedback />
                    </>
                }
            >
                <Button
                    variant="plain" size="sm" className="ct-assistant-about-button"
                    aria-label={_("About")} icon={<InfoCircleIcon />}
                />
            </Popover>
        </span>
    );
};

// What to do about a state that is not "connected": shown below the title.
export const StatusDetail = ({ status }) => {
    switch (status.state) {
    case "loading":
    case "connected":
        return null;

    case "not-installed":
        return (
            <EmptyState
                className="ct-assistant-status-detail" headingLevel="h2" icon={PackageIcon}
                titleText={_("The command-line assistant is not installed")}
            >
                <EmptyStateBody>
                    <p>{_("This page is a web console front end for the RHEL command-line assistant (the c command). Install it to use this page:")}</p>
                    <p><code>dnf install command-line-assistant</code></p>
                </EmptyStateBody>
            </EmptyState>
        );

    case "unsupported":
        return (
            <EmptyState
                className="ct-assistant-status-detail" headingLevel="h2" icon={PackageIcon}
                titleText={_("Unsupported version of the command-line assistant")}
            >
                <EmptyStateBody>
                    <p>
                        {cockpit.format(_("This page needs command-line-assistant $0 or newer."), MIN_VERSION)}
                        {status.installed &&
                            <span className="ct-assistant-installed-version">
                                {" " + cockpit.format(_("Installed: $0."), status.installed)}
                            </span>}
                    </p>
                    <p><code>sudo dnf upgrade command-line-assistant</code></p>
                </EmptyStateBody>
            </EmptyState>
        );

    case "disabled":
        return (
            <EmptyState
                className="ct-assistant-status-detail" headingLevel="h2" icon={LockIcon}
                titleText={_("The assistant is disabled for your account")}
            >
                <EmptyStateBody>
                    {_("The administrator has disabled the command-line assistant for your account.")}
                </EmptyStateBody>
            </EmptyState>
        );

    default:
        return (
            <Alert
                className="ct-assistant-status-detail" variant="danger" isInline
                title={_("Could not connect to the command-line assistant")}
            >
                {status.error}
            </Alert>
        );
    }
};
