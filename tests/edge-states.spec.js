// DESIGN.md "Status / edge states". Each state is produced by the real
// cockpit-bridge / clad: the not-installed and daemon-error cases rewrite what
// the page asks for (tests/helpers/socket.js) so the real bridge/daemon reply
// with the real error; the disabled case uses a real account denied by a real
// D-Bus policy (TESTING.md "The disabled-user fixture").
const { test, expect } = require('@playwright/test');
const { loginToCockpit, COCKPIT_URL, MODULE_PATH } = require('./helpers/cockpit.js');
const { routeCockpitSocket, callMethod } = require('./helpers/socket.js');
const { expectStatusLabel } = require('./helpers/module.js');

// Every state keeps the page title, and the label beside it says which state
// it is (never "Connected" outside the connected state), with the (i)
// "About" button always beside it.
async function expectHeader(page, label) {
    await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible();
    await expect(page.locator('.ct-assistant-subtitle')).toHaveText('powered by RHEL Lightspeed');
    await expectStatusLabel(page, label);
    await expect(page.locator('.ct-assistant-status-connected')).toHaveCount(0);
}

test.describe('edge states', () => {
    test('not installed: install-hint empty state, page still loads', async ({ page }) => {
        await loginToCockpit(page);
        // Point every clad bus name at a name that is not activatable — exactly
        // what the bridge sees when command-line-assistant isn't installed.
        await routeCockpitSocket(page, {
            toServer: (channel, body) => {
                if (channel === '' && body.command === 'open' && body.name?.startsWith('com.redhat.lightspeed.'))
                    return { ...body, name: body.name.replace('com.redhat.lightspeed.', 'com.redhat.lightspeed.notinstalled.') };
                return undefined;
            },
        });
        await page.goto(COCKPIT_URL + MODULE_PATH);

        const empty = page.locator('.pf-v6-c-empty-state').filter({ hasText: 'The command-line assistant is not installed' });
        await expect(empty).toBeVisible({ timeout: 30000 });
        await expect(empty.locator('code')).toHaveText('dnf install command-line-assistant');
        await expectHeader(page, { text: 'Not installed', color: 'grey', icon: false });
        await expect(page.locator('#ct-assistant-question')).toHaveCount(0);
        await expect(page.getByRole('tab')).toHaveCount(0);
    });

    test('daemon error: red alert with the daemon\'s own text, Ask disabled', async ({ page }) => {
        await loginToCockpit(page);
        // Ask for uid 0's user id while running as an ordinary user: clad
        // itself refuses with its PermissionError.
        await routeCockpitSocket(page, {
            toServer: (_channel, body) => {
                if (callMethod(body) === 'GetUserId')
                    return { ...body, call: [body.call[0], body.call[1], body.call[2], [0]] };
                return undefined;
            },
        });
        await page.goto(COCKPIT_URL + MODULE_PATH);

        const alert = page.locator('.ct-assistant-status-detail');
        await expect(alert).toHaveClass(/pf-m-danger/, { timeout: 30000 });
        await expect(alert).toContainText('Could not connect to the command-line assistant');
        await expect(alert).toContainText('Unix user ID mismatch: access denied');
        // The full alert, in the page, not behind the (i).
        await expect(alert).toBeVisible();
        await expectHeader(page, { text: 'Connection error', color: 'red', icon: true });
        await page.fill('#ct-assistant-question', 'anything');
        await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
        // Not connected: Enter does nothing either.
        await page.keyboard.press('Enter');
        await expect(page.locator('#ct-assistant-question')).toHaveValue('anything');
        await expect(page.locator('.ct-assistant-exchange')).toHaveCount(0);
    });

    test('disabled for this user by the administrator', async ({ page }) => {
        const user = process.env.COCKPIT_DENIED_USER;
        const pass = process.env.COCKPIT_DENIED_PASS;
        test.skip(!user || !pass, 'COCKPIT_DENIED_USER/COCKPIT_DENIED_PASS not set — needs the disabled-user fixture on the VM');

        // Non-wheel account: no admin elevation to attempt.
        await loginToCockpit(page, { user, pass, admin: false });
        const empty = page.locator('.pf-v6-c-empty-state')
                .filter({ hasText: 'The assistant is disabled for your account' });
        await expect(empty).toBeVisible({ timeout: 30000 });
        await expect(empty.getByRole('heading')).toHaveText('The assistant is disabled for your account');
        await expect(empty).toContainText('The administrator has disabled the command-line assistant for your account.');
        await expectHeader(page, { text: 'Disabled', color: 'grey', icon: true });
        await expect(page.locator('#ct-assistant-question')).toHaveCount(0);
    });
});
