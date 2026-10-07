// Generic Cockpit login/admin-unlock/navigate helper.
//
// This file is meant to be lifted into other Cockpit modules largely as-is —
// only MODULE_PATH (and TABS, if the module has tabs) are module-specific.
// See TESTING.md for how the suite is set up.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const COCKPIT_URL = process.env.COCKPIT_URL || 'https://your-host:9090';
const COCKPIT_USER = process.env.COCKPIT_USER || 'admin';
const COCKPIT_PASS = process.env.COCKPIT_PASS || '';

// package.json "name" is "cla", so that is the install dir / URL.
const MODULE_PATH = '/cockpit/@localhost/cla/index.html';

// `options` lets a spec log in as a different (e.g. assistant-disabled,
// non-wheel) account; with no options this is the standard login → elevate →
// navigate sequence.
async function loginToCockpit(page, { user = COCKPIT_USER, pass = COCKPIT_PASS, admin = true } = {}) {
    // waitUntil: 'networkidle' on the initial load, and a single direct
    // selector (not a list of fallbacks each burning a full timeout waiting
    // for an element that was never going to appear) — confirmed 2026-06-22
    // that a fallback-selector-list version of this function, despite
    // eventually clicking the right element, made elevation unreliable in a
    // way a flat 2s wait + this exact sequence does not. Don't reintroduce
    // the fallback-list shape without re-verifying end-to-end.
    await page.goto(COCKPIT_URL, { waitUntil: 'networkidle' });
    await page.fill('#login-user-input', user);
    await page.fill('#login-password-input', pass);
    await page.click('#login-button');
    await page.waitForFunction(
        () => !document.getElementById('login-user-input'),
        { timeout: 15000 }
    );
    // Elevate admin on the Cockpit shell page BEFORE navigating to the module
    // (most modules need root). This module never uses superuser for clad —
    // running the suite with admin unlocked is what proves its calls still go
    // out as the logged-in user, not root.
    if (admin)
        await requestAdmin(page, pass);
    // Navigate directly to the module's iframe URL — this loads the module at
    // the top level (page is used directly, no frameLocator needed).
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await page.waitForLoadState('domcontentloaded');
}

async function requestAdmin(page, pass = COCKPIT_PASS) {
    const unlock = page.locator('button:has-text("Limited access"), button:has-text("Turn on administrative access")').first();
    await unlock.waitFor({ timeout: 5000 });
    await unlock.click();
    // With passwordless sudo, Cockpit skips the password prompt and goes
    // straight to a "You now have administrative access" dialog with a Close
    // button — race both outcomes.
    const pwField = page.locator('#account-password-input, input[type="password"]').first();
    const granted = page.locator('[role="dialog"]:has-text("You now have administrative access")');
    await Promise.race([pwField.waitFor({ timeout: 10000 }), granted.waitFor({ timeout: 10000 })]);
    if (await granted.isVisible()) {
        await granted.locator('footer button:has-text("Close"), .pf-v6-c-modal-box__footer button:has-text("Close")').first()
                .click();
    } else {
        await pwField.fill(pass);
        await page.locator('button:has-text("Authenticate"), button[type="submit"]').first()
                .click();
    }
    // Flat settle wait, not a poll/probe — confirmed 2026-06-22 that
    // repeatedly probing with a privileged spawn call to detect "is it ready
    // yet" makes things worse (overlapping spawn attempts mid-handshake left
    // orphaned `sudo -k -A cockpit-bridge` processes stuck server-side). The
    // superuser handshake (init → Prompt → Answer → Current: sudo) needs this
    // long regardless; every privileged call hangs indefinitely (no error)
    // if you proceed before it settles.
    await page.waitForTimeout(2000);
}

// Returns true if the Cockpit privileged bridge appears active via the shell indicator.
async function isAdminActive(page) {
    const limited = page.locator('a:has-text("Limited access"), button:has-text("Limited access")');
    const visible = await limited.isVisible({ timeout: 2000 }).catch(() => false);
    return !visible;
}

module.exports = { loginToCockpit, requestAdmin, isAdminActive, COCKPIT_URL, MODULE_PATH };
