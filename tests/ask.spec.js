const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { loginToCockpit, COCKPIT_URL, MODULE_PATH } = require('./helpers/cockpit.js');
const { routeCockpitSocket, callMethod } = require('./helpers/socket.js');
const { openModule, readFileInUi, localAsk } = require('./helpers/module.js');

// Optional ssh access to the same VM, to confirm WriteHistory landed with the
// CLI itself. COCKPIT_SSH is an ssh destination; COCKPIT_SSH_CONFIG an
// optional ssh_config file (-F).
function sshHistory(marker) {
    const args = [];
    if (process.env.COCKPIT_SSH_CONFIG)
        args.push('-F', process.env.COCKPIT_SSH_CONFIG);
    args.push('-o', 'BatchMode=yes', process.env.COCKPIT_SSH,
              // `c` reads stdin as context — always give it /dev/null
              `c --plain history --from-chat cockpit --filter '${marker}' </dev/null`);
    return execFileSync('ssh', args, { encoding: 'utf8', timeout: 60000 });
}

test.describe('Ask tab', () => {
    test('a real question gets a rendered markdown answer card, saved to the cockpit chat', async ({ page, browserName }) => {
        test.setTimeout(240000);
        if (browserName === 'chromium')
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        // Observe (never modify) what the page actually sends to clad.
        const sent = {};
        await loginToCockpit(page);
        await routeCockpitSocket(page, {
            toServer: (_channel, body) => {
                const method = callMethod(body);
                if (method === 'AskQuestion' || method === 'WriteHistory' || method === 'CreateChat')
                    sent[method] = body;
                return undefined;
            },
        });
        await page.goto(COCKPIT_URL + MODULE_PATH);
        await expect(page.locator('.ct-assistant-status')).toContainText('Connected', { timeout: 30000 });

        // A unique marker so the CLI history lookup finds exactly this entry.
        const marker = `pw-${browserName}-${Date.now()}`;
        const question = `What does the -Z flag do in ls? Answer in two sentences. (${marker})`;
        await page.fill('#ct-assistant-question', question);
        await page.getByRole('button', { name: 'Ask', exact: true }).click();

        const answer = page.locator('.ct-assistant-answer');
        await expect(answer).toBeVisible({ timeout: 120000 });
        await expect(page.locator('.ct-assistant-ask-error')).toHaveCount(0);
        await expect(page.locator('.ct-assistant-question-text').first()).toHaveText(question);
        await expect(answer.getByRole('heading', { name: 'Response from the command-line assistant' })).toBeVisible();

        // Rendered as markdown: real block elements, not one raw text blob.
        const blocks = answer.locator('.ct-markdown').locator('p, li, pre, h3, h4, h5, h6, table');
        expect(await blocks.count()).toBeGreaterThan(0);
        await expect(answer.locator('.ct-markdown')).not.toContainText('```');

        // Copy button copies the answer verbatim.
        const copy = answer.getByRole('button', { name: 'Copy', exact: true });
        await expect(copy).toBeVisible();
        await copy.click();
        await expect(answer.getByRole('button', { name: 'Copied' })).toBeVisible();
        if (browserName === 'chromium') {
            const clip = await page.evaluate(() => navigator.clipboard.readText());
            expect(clip).toBe(sent.WriteHistory.call[3][3]);
        }

        await expect(answer.locator('.ct-assistant-history-note')).toHaveText('Saved to chat cockpit.');

        // The question carried all five keys, terminal empty, systeminfo filled.
        const q = sent.AskQuestion.call[3][1];
        expect(Object.keys(q).sort()).toEqual(['attachment', 'message', 'stdin', 'systeminfo', 'terminal']);
        expect(q.message.v).toBe(question);
        expect(q.terminal.v.output.v).toBe('');
        expect(q.stdin.v.stdin.v).toBe('');
        expect(q.attachment.v.mimetype.v).toBe('text/plain');
        expect(q.systeminfo.v.os.v).toBe('Red Hat Enterprise Linux');
        expect(q.systeminfo.v.version.v).toMatch(/^\d+\.\d+$/);
        expect(q.systeminfo.v.id.v).toBe('rhel');
        expect(q.systeminfo.v.arch.v).toBe('x86_64');

        // WriteHistory(chat_id, user_id, question, answer) — never the CLI's "default" chat.
        const [chatId, userId, histQuestion] = sent.WriteHistory.call[3];
        expect(sent.AskQuestion.call[3][0]).toBe(userId);
        expect(histQuestion).toBe(question);
        expect(chatId).toMatch(/^[0-9a-f-]{36}$/);
        if (sent.CreateChat)
            expect(sent.CreateChat.call[3][1]).toBe('cockpit');

        // And the CLI sees it, in the chat named exactly "cockpit".
        if (process.env.COCKPIT_SSH) {
            const out = sshHistory(marker);
            expect(out).toContain(marker);
            expect(out).toMatch(/^\*From chat: cockpit\*$/m);
        } else {
            test.info().annotations.push({ type: 'note', description: 'COCKPIT_SSH unset: CLI history check not run' });
        }
    });

    test.describe('without asking', () => {
        test.beforeEach(async ({ page }) => {
            await loginToCockpit(page);
            await expect(page.locator('.ct-assistant-status')).toContainText('Connected', { timeout: 30000 });
        });

        test('systeminfo from /etc/os-release is one read-only line, shown and checked', async ({ page }) => {
            // Shown without opening the context editor: it is sent by default.
            await expect(page.getByRole('button', { name: /^Add context/ })).toHaveAttribute('aria-expanded', 'false');
            const info = page.locator('.ct-assistant-systeminfo');
            await expect(info).toBeVisible();
            await expect(info).toContainText(/^Send with each question: Red Hat Enterprise Linux \d+\.\d+ \(rhel\) · x86_64$/);
            // Its only control is the checkbox; the values themselves are read-only.
            await expect(info.getByRole('checkbox')).toBeChecked();
            await expect(info.locator('textarea, input:not([type="checkbox"])')).toHaveCount(0);
            const box = await info.boundingBox();
            expect(box.height).toBeLessThan(40); // one line

            // The terminal sentence is behind the (?) popover.
            await expect(page.getByText('Terminal output is never sent')).toHaveCount(0);
            await info.getByRole('button', { name: 'What else is sent' }).click();
            await expect(page.getByText('Terminal output is never sent: there is no terminal session behind the web console.')).toBeVisible();
        });

        test('reading a host file fills the context; a missing file says so', async ({ page }) => {
            await readFileInUi(page, '/etc/os-release');
            await expect(page.locator('#ct-assistant-context-text')).toHaveValue(/VERSION_ID=/);
            const content = await page.locator('#ct-assistant-context-text').inputValue();
            // The editor closes and the attachment line says what will be sent.
            await expect(page.getByRole('button', { name: /^Add context/ })).toHaveAttribute('aria-expanded', 'false');
            const attachment = page.locator('.ct-assistant-attachment');
            await expect(attachment).toContainText(`Context attached from /etc/os-release: all ${content.length} characters will be sent.`);
            await expect(attachment.locator('.ct-assistant-file-read-as')).toHaveText(/^Read (as|with) /);

            await readFileInUi(page, '/etc/does-not-exist-cockpit-assistant');
            await expect(page.getByText('/etc/does-not-exist-cockpit-assistant does not exist.')).toBeVisible();
            // A failed read leaves the earlier context as it was.
            await expect(page.locator('#ct-assistant-context-text')).toHaveValue(content);
        });
        // Root-only files, with and without administrative access: context-file.spec.js.
    });

    // Answered locally: this is about what leaves the page, not about answers.
    test('the checkbox decides whether the identity goes with the question', async ({ page }) => {
        const { route, asked } = localAsk();
        await openModule(page, route);

        const checkbox = page.locator('.ct-assistant-systeminfo').getByRole('checkbox');
        await expect(checkbox).toBeChecked();
        await checkbox.uncheck();

        await page.fill('#ct-assistant-question', 'Asked without the system identity');
        await page.getByRole('button', { name: 'Ask', exact: true }).click();
        await expect(page.locator('.ct-assistant-answer')).toHaveCount(1);

        // clad needs all five keys, so systeminfo is still there — but empty.
        expect(Object.keys(asked[0]).sort()).toEqual(['attachment', 'message', 'stdin', 'systeminfo', 'terminal']);
        expect(asked[0].systeminfo.v).toEqual({
            os: { t: 's', v: '' },
            version: { t: 's', v: '' },
            arch: { t: 's', v: '' },
            id: { t: 's', v: '' },
        });

        // Checked again, the next question carries it.
        await checkbox.check();
        await page.fill('#ct-assistant-question', 'Asked with the system identity');
        await page.getByRole('button', { name: 'Ask', exact: true }).click();
        await expect(page.locator('.ct-assistant-answer')).toHaveCount(2);
        expect(asked[1].systeminfo.v.id.v).toBe('rhel');
        expect(asked[1].systeminfo.v.arch.v).toBe('x86_64');
    });
});
