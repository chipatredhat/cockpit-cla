// DESIGN.md "Supported command-line-assistant versions". The first test
// asserts what the page shows for the build installed on the test host; the
// others stub clad's replies so each build's behaviour is covered on any host
// running a supported build.
const { test, expect } = require('@playwright/test');
const { loginToCockpit, COCKPIT_URL, MODULE_PATH } = require('./helpers/cockpit.js');
const { routeCockpitSocket, callMethod } = require('./helpers/socket.js');
const { openAbout, expectStatusLabel, localAsk, ssh } = require('./helpers/module.js');
const { cladBuild, expectEndpointLine } = require('./helpers/clad-build.js');

const LEGAL_NOTICE_RHSM = "Interactions may be used to improve Red Hat's products or services.";
const FEEDBACK_NOTICE = 'Do not include any personal information or other sensitive information in your feedback.';
const FEEDBACK_MANAGED = "Feedback may be used to improve Red Hat's products or services.";
const UPGRADE_COMMAND = 'sudo dnf upgrade command-line-assistant';
const NEEDS = 'This page needs command-line-assistant 0.4.2 or newer.';

// What clad (dasbus) replies for a method its build does not have.
function unknownMethod(method) {
    return ['org.freedesktop.DBus.Error.UnknownMethod', [`No such method “${method}”`]];
}

// Answer `method` with a D-Bus error, everything else from the real clad.
function failing(method, error, more = {}) {
    return {
        ...more,
        answer: (channel, body) => {
            if (callMethod(body) === method)
                return { error, id: body.id };
            return more.answer ? more.answer(channel, body) : undefined;
        },
    };
}

// The page's rpm query for command-line-assistant runs `argv` instead,
// through the real bridge.
function rpmRunning(argv) {
    return {
        toServer: (channel, body) => {
            if (channel === '' && body.command === 'open' && Array.isArray(body.spawn) &&
                body.spawn[0] === 'rpm' && body.spawn.at(-1) === 'command-line-assistant')
                return { ...body, spawn: argv };
            return undefined;
        },
    };
}

async function openWith(page, route) {
    await loginToCockpit(page);
    await routeCockpitSocket(page, route);
    await page.goto(COCKPIT_URL + MODULE_PATH);
}

// Never the generic connection error for a missing method.
async function expectNoConnectionError(page) {
    await expect(page.locator('.ct-assistant-status-error')).toHaveCount(0);
    await expect(page.getByText('Connection error')).toHaveCount(0);
    await expect(page.getByText('Could not connect to the command-line assistant')).toHaveCount(0);
    await expect(page.getByText(/No such method/)).toHaveCount(0);
}

// The "Unsupported version" state: grey label, the upgrade hint as the whole
// page, with "Installed: <v>." when rpm reported a version.
async function expectUnsupported(page, installed) {
    await expectStatusLabel(page, { text: 'Unsupported version', color: 'grey', icon: false });
    const empty = page.locator('.ct-assistant-status-detail');
    await expect(empty).toHaveClass(/pf-v6-c-empty-state/);
    await expect(empty.getByRole('heading')).toHaveText('Unsupported version of the command-line assistant');
    await expect(empty.locator('p').first()).toHaveText(installed ? `${NEEDS} Installed: ${installed}.` : NEEDS);
    await expect(empty.locator('.ct-assistant-installed-version')).toHaveCount(installed ? 1 : 0);
    await expect(empty.locator('code')).toHaveText(UPGRADE_COMMAND);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.locator('#ct-assistant-question')).toHaveCount(0);
    await expect(page.locator('#ct-assistant-chat-toggle')).toHaveCount(0);
    await expectNoConnectionError(page);
}

async function expectFeedbackSentence(about, shown) {
    await expect(about.locator('.ct-assistant-feedback-notice'))
            .toHaveText(shown ? `${FEEDBACK_NOTICE} ${FEEDBACK_MANAGED}` : FEEDBACK_NOTICE);
}

test.describe('command-line-assistant builds', () => {
    test('the installed build: the state and text that build supports', async ({ page }, testInfo) => {
        await loginToCockpit(page);
        await expect(page.locator('.ct-assistant-status .pf-v6-c-label')).not.toHaveText('Connecting…', { timeout: 30000 });
        const expected = await cladBuild(page);
        testInfo.annotations.push({ type: 'command-line-assistant', description: expected.build });

        // clad's own method list agrees with what the page assumes of the build.
        if (process.env.COCKPIT_SSH) {
            const methods = ssh('busctl --system introspect com.redhat.lightspeed.chat /com/redhat/lightspeed/chat com.redhat.lightspeed.chat');
            expect(/\.IsRedHatManagedEndpoint\s+method/.test(methods)).toBe(expected.hasManagedMethod);
            expect(/\.IsChatAvailable\s+method/.test(methods)).toBe(expected.supported);
        }

        if (!expected.supported) {
            // Before 0.4.2 (D1): the upgrade hint, never an error.
            await expectUnsupported(page, expected.build);
            await page.screenshot({ path: testInfo.outputPath('unsupported-version.png') });
            const about = await openAbout(page);
            await expect(about.locator('.ct-assistant-version')).toHaveText(`command-line-assistant ${expected.build}`);
            // No IsRedHatManagedEndpoint here either; `c` of this build always adds the sentence.
            await expect(about.locator('.ct-assistant-endpoint')).toHaveCount(0);
            await expectFeedbackSentence(about, true);
            return;
        }

        // 0.4.2 and newer: connected and working.
        await expectStatusLabel(page, { text: 'Connected', color: 'green', icon: true });
        await expect(page.locator('.ct-assistant-status-detail')).toHaveCount(0);
        await expectNoConnectionError(page);
        await expect(page.getByRole('tab')).toHaveCount(2);
        await expect(page.locator('#ct-assistant-chat-toggle')).toBeVisible();
        await expect(page.locator('.ct-assistant-legal-rhsm')).toHaveCount(expected.redHatSentence ? 1 : 0);
        await page.fill('#ct-assistant-question', 'versions spec: not sent');
        await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled();
        const about = await openAbout(page);
        await expectEndpointLine(about, expected);
        await expectFeedbackSentence(about, expected.redHatSentence);
    });
});

test.describe('command-line-assistant builds, stubbed', () => {
    test('no IsRedHatManagedEndpoint (0.4.2, 0.5.0): connected, no endpoint line, Red Hat sentences, Ask works', async ({ page }) => {
        const { route, asked } = localAsk(() => 'Answer from a build without IsRedHatManagedEndpoint.');
        await openWith(page, failing('IsRedHatManagedEndpoint', unknownMethod('IsRedHatManagedEndpoint'), route));

        await expectStatusLabel(page, { text: 'Connected', color: 'green', icon: true });
        await expect(page.locator('.ct-assistant-status-detail')).toHaveCount(0);
        await expectNoConnectionError(page);
        // As `c` before 0.5.2 prints it: always.
        await expect(page.locator('.ct-assistant-legal-rhsm')).toHaveText(LEGAL_NOTICE_RHSM);

        const about = await openAbout(page);
        await expect(about.locator('.ct-assistant-endpoint')).toHaveCount(0);
        await expect(about.locator('.ct-assistant-version')).toHaveText(/^command-line-assistant \d+\.\d+\.\d+-\S+$/);
        await expectFeedbackSentence(about, true);
        await page.keyboard.press('Escape');

        await expect(page.locator('#ct-assistant-chat-toggle')).toBeVisible();
        await page.fill('#ct-assistant-question', 'versions spec: stubbed question');
        await page.getByRole('button', { name: 'Ask', exact: true }).click();
        await expect(page.locator('.ct-assistant-answer').first())
                .toContainText('Answer from a build without IsRedHatManagedEndpoint.');
        expect(asked).toHaveLength(1);
        await expectNoConnectionError(page);
    });

    test('no IsChatAvailable (0.3.1) and rpm unreadable: "Unsupported version" without a version', async ({ page }) => {
        await openWith(page, failing('IsChatAvailable', unknownMethod('IsChatAvailable'),
                                     rpmRunning(['sh', '-c', 'exit 2'])));
        await expectUnsupported(page, null);
        const about = await openAbout(page);
        await expect(about.locator('.ct-assistant-version')).toHaveCount(0);
    });

    test('rpm reports 0.3.1-6: "Unsupported version", Installed: 0.3.1-6.el10_0', async ({ page }) => {
        await openWith(page, rpmRunning(['printf', '%s', '0.3.1-6.el10_0']));
        await expectUnsupported(page, '0.3.1-6.el10_0');
        const about = await openAbout(page);
        await expect(about.locator('.ct-assistant-version')).toHaveText('command-line-assistant 0.3.1-6.el10_0');
    });

    test('IsRedHatManagedEndpoint fails otherwise: clad\'s text verbatim, History still there', async ({ page }) => {
        await openWith(page, failing('IsRedHatManagedEndpoint',
                                     ['org.freedesktop.DBus.Error.Failed', ['Endpoint check failed (test).']]));
        await expectStatusLabel(page, { text: 'Connection error', color: 'red', icon: true });
        const alert = page.locator('.ct-assistant-status-detail');
        await expect(alert).toHaveClass(/pf-m-danger/);
        await expect(alert).toContainText('Could not connect to the command-line assistant');
        await expect(alert).toContainText('Endpoint check failed (test).');
        await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
        // GetUserId's answer is kept: the chat list and History come from clad.
        await expect(page.locator('#ct-assistant-chat-toggle')).toBeVisible();
        await page.getByRole('tab', { name: 'History' }).click();
        await expect(page.locator('.ct-assistant-history-table, .ct-assistant-history-empty')).toBeVisible();
        const about = await openAbout(page);
        await expect(about.locator('.ct-assistant-endpoint')).toHaveCount(0);
        await expectFeedbackSentence(about, false);
    });
});
