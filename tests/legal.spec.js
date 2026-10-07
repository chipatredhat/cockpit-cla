// Red Hat's legal text, exactly as upstream `c` prints it (DESIGN.md "Legal
// text"): LEGAL_NOTICE always, LEGAL_NOTICE_RHSM on a Red Hat endpoint,
// ALWAYS_LEGAL_MESSAGE after every answer. None dismissible.
const { test, expect } = require('@playwright/test');
const { callMethod } = require('./helpers/socket.js');
const { openModule, openAbout } = require('./helpers/module.js');

const LEGAL_NOTICE = 'This feature uses AI technology. Do not include any personal information or other sensitive information in your input.';
const LEGAL_NOTICE_RHSM = "Interactions may be used to improve Red Hat's products or services.";
const ALWAYS_LEGAL_MESSAGE = 'Always review AI-generated content prior to use.';

test.describe('legal text', () => {
    test('Red Hat endpoint: both notices, not dismissible', async ({ page }) => {
        await openModule(page);
        // The test VMs are RHSM-registered: clad reports a Red Hat endpoint.
        await expect(await openAbout(page)).toContainText('Red Hat endpoint');
        await expect(page.locator('.ct-assistant-legal-notice')).toHaveText(LEGAL_NOTICE);
        await expect(page.locator('.ct-assistant-legal-rhsm')).toHaveText(LEGAL_NOTICE_RHSM);
        await expect(page.locator('.ct-assistant-disclosure button, .ct-assistant-disclosure [aria-label*="lose" i]')).toHaveCount(0);
        // Not shown before any answer.
        await expect(page.locator('.ct-assistant-always-review')).toHaveCount(0);
    });

    test('custom endpoint: only LEGAL_NOTICE', async ({ page }) => {
        // clad answers IsRedHatManagedEndpoint() == false for a non-Red Hat endpoint.
        await openModule(page, {
            answer: (_channel, body) => (callMethod(body) === 'IsRedHatManagedEndpoint'
                ? { reply: [[false]], id: body.id }
                : undefined),
        });
        await expect(await openAbout(page)).toContainText('Custom endpoint');
        await expect(page.locator('.ct-assistant-legal-notice')).toHaveText(LEGAL_NOTICE);
        await expect(page.locator('.ct-assistant-legal-rhsm')).toHaveCount(0);
    });

    test('after every answer: ALWAYS_LEGAL_MESSAGE', async ({ page }) => {
        // Answered locally: nothing goes to the backend or into history.
        let n = 0;
        await openModule(page, {
            answer: (_channel, body) => {
                const method = callMethod(body);
                if (method === 'AskQuestion')
                    return { reply: [[{ message: { t: 's', v: `Answer number ${++n}.` } }]], id: body.id };
                if (method === 'WriteHistory')
                    return { reply: [[]], id: body.id };
                return undefined;
            },
        });
        for (const q of ['first', 'second']) {
            await page.fill('#ct-assistant-question', `legal test ${q}`);
            await page.getByRole('button', { name: 'Ask', exact: true }).click();
            await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
        }
        const answers = page.locator('.ct-assistant-answer');
        await expect(answers).toHaveCount(2);
        for (const i of [0, 1]) {
            await expect(answers.nth(i).locator('.ct-assistant-always-review')).toHaveText(ALWAYS_LEGAL_MESSAGE);
            await expect(answers.nth(i).locator('.ct-assistant-always-review button')).toHaveCount(0);
        }
        // The notices stay up after asking.
        await expect(page.locator('.ct-assistant-legal-notice')).toHaveText(LEGAL_NOTICE);
        await expect(page.locator('.ct-assistant-legal-rhsm')).toHaveText(LEGAL_NOTICE_RHSM);
    });
});
