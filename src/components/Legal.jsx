// SPDX-License-Identifier: LGPL-2.1-or-later
// Red Hat's own legal text, exactly as upstream `c` prints it
// (command_line_assistant LEGAL_NOTICE, LEGAL_NOTICE_RHSM and
// ALWAYS_LEGAL_MESSAGE, 0.5.2). Not translated and never dismissible —
// remembering a dismissal would be state. See DESIGN.md "Legal text".
import React from 'react';

import { showsRedHatSentence } from '../lib/clad.js';

export const LEGAL_NOTICE = "This feature uses AI technology. Do not include any personal information or other sensitive information in your input.";
export const LEGAL_NOTICE_RHSM = "Interactions may be used to improve Red Hat's products or services.";
export const ALWAYS_LEGAL_MESSAGE = "Always review AI-generated content prior to use.";

// Shown with the question form. The RHSM line whenever `c` of the installed
// build prints it: on a Red Hat endpoint (IsRedHatManagedEndpoint), and
// always on builds without that method (before 0.5.2).
export const LegalNotice = ({ managed }) => (
    <div className="ct-assistant-disclosure">
        <div className="ct-assistant-legal-notice">{LEGAL_NOTICE}</div>
        {showsRedHatSentence(managed) && <div className="ct-assistant-legal-rhsm">{LEGAL_NOTICE_RHSM}</div>}
    </div>
);

// Shown after every answer.
export const AlwaysReview = () => (
    <p className="ct-assistant-always-review">{ALWAYS_LEGAL_MESSAGE}</p>
);
