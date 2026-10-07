// SPDX-License-Identifier: LGPL-2.1-or-later
// Copy text to the browser's clipboard, exactly as given. Shared by the
// answer's Copy button and the code blocks' copy buttons, so both report
// success and failure the same way.
import cockpit from 'cockpit';
import { useState, useEffect, useRef } from 'react';

const _ = cockpit.gettext;

// { copied, error, copy }: copied is true for 2 s after a successful copy;
// error is the reason the last copy failed, or null.
export function useClipboard(text) {
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState(null);
    const timer = useRef(null);

    useEffect(() => () => clearTimeout(timer.current), []);

    const copy = () => {
        setError(null);
        if (!navigator.clipboard) {
            setError(_("The browser does not allow clipboard access on this page."));
            return;
        }
        navigator.clipboard.writeText(text)
                .then(() => {
                    setCopied(true);
                    clearTimeout(timer.current);
                    timer.current = setTimeout(() => setCopied(false), 2000);
                })
                .catch(ex => setError(ex.message || String(ex)));
    };

    return { copied, error, copy };
}
