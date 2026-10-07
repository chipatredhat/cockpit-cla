// "Read a file from this host" uses superuser: "try": with administrative
// access turned on, a root-only file is read as root; without it, the same
// read fails with the bridge's own permission error and nothing reaches the
// context or the backend. /var/log/secure is root-owned 0600 on RHEL 9 and 10.
// Clad's channels must never ask for superuser, whatever the file read does.
const { test, expect } = require('@playwright/test');
const { loginToCockpit, COCKPIT_URL, MODULE_PATH } = require('./helpers/cockpit.js');
const { routeCockpitSocket, callMethod } = require('./helpers/socket.js');
const { ssh, readFileInUi } = require('./helpers/module.js');

const ROOT_ONLY_FILE = '/var/log/secure';

// Observe (never modify) the page's channel opens and clad calls; answer
// AskQuestion/WriteHistory locally so nothing reaches the backend or history.
function observer() {
    const opens = [];
    const calls = [];
    const route = {
        answer: (_channel, body) => {
            const method = callMethod(body);
            if (method)
                calls.push({ method, body });
            if (method === 'AskQuestion')
                return { reply: [[{ message: { t: 's', v: 'Local answer.' } }]], id: body.id };
            if (method === 'WriteHistory')
                return { reply: [[]], id: body.id };
            return undefined;
        },
        toServer: (channel, body) => {
            if (channel === '' && body?.command === 'open')
                opens.push(body);
            return undefined;
        },
    };
    return { route, opens, calls };
}

async function open(page, route, { admin }) {
    await loginToCockpit(page, { admin });
    await routeCockpitSocket(page, route);
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await expect(page.locator('.ct-assistant-status')).toContainText('Connected', { timeout: 30000 });
}

const readFile = readFileInUi;

function expectFileReadTry(opens, path) {
    const fsOpens = opens.filter(o => o.payload === 'fsread1' && o.path === path);
    expect(fsOpens.length).toBeGreaterThan(0);
    for (const o of fsOpens)
        expect(o.superuser).toBe('try');
}

function expectCladNeverSuperuser(opens) {
    const clad = opens.filter(o => o.payload === 'dbus-json3' && String(o.name).startsWith('com.redhat.lightspeed'));
    expect(clad.length).toBeGreaterThan(0);
    for (const o of clad)
        expect(o.superuser).toBeUndefined();
}

test.describe('Context file read and administrative access', () => {
    test('with administrative access, a root-only file is read as administrator', async ({ page }) => {
        const obs = observer();
        await open(page, obs.route, { admin: true });

        await readFile(page, ROOT_ONLY_FILE);
        const loaded = page.locator('.ct-assistant-file-loaded');
        await expect(loaded).toContainText(`Context attached from ${ROOT_ONLY_FILE}:`);
        await expect(loaded.locator('.ct-assistant-file-read-as')).toHaveText('Read as administrator.');
        await expect(page.getByText('Could not read the file')).toHaveCount(0);
        await expect(page.locator('.ct-assistant-file-hint')).toHaveCount(0);

        const context = await page.locator('#ct-assistant-context-text').inputValue();
        expect(context.length).toBeGreaterThan(0);
        if (process.env.COCKPIT_SSH) {
            // The log only grows, so the file's first line is still its first line.
            const firstLine = ssh(`sudo head -n 1 ${ROOT_ONLY_FILE}`).replace(/\n$/, '');
            expect(firstLine.length).toBeGreaterThan(0);
            expect(context.split('\n')[0]).toBe(firstLine);
        } else {
            test.info().annotations.push({ type: 'note', description: 'COCKPIT_SSH unset: first-line check not run' });
        }

        expectFileReadTry(obs.opens, ROOT_ONLY_FILE);
        expectCladNeverSuperuser(obs.opens);
        // Reading context sends nothing to the assistant by itself.
        expect(obs.calls.filter(c => c.method === 'AskQuestion')).toEqual([]);
    });

    test('without administrative access, a root-only file is refused and nothing is sent', async ({ page }) => {
        const obs = observer();
        await open(page, obs.route, { admin: false });

        await readFile(page, ROOT_ONLY_FILE);
        const error = page.locator('.pf-v6-c-alert', { hasText: 'Could not read the file' });
        await expect(error).toBeVisible();
        await expect(error).toContainText('Not permitted to perform this action.');
        // Administrative access is off, so the error says how to read it.
        await expect(error.locator('.ct-assistant-file-hint')).toHaveText('Turn on administrative access to read root-only files.');
        await expect(page.locator('.ct-assistant-file-loaded')).toHaveCount(0);
        await expect(page.locator('.ct-assistant-attachment')).toHaveCount(0);
        await expect(page.locator('#ct-assistant-context-text')).toHaveValue('');
        expectFileReadTry(obs.opens, ROOT_ONLY_FILE);
        expect(obs.calls.filter(c => c.method === 'AskQuestion')).toEqual([]);

        // Asking afterwards sends the question with an empty attachment.
        await page.fill('#ct-assistant-question', 'context file refused test');
        await page.locator('.ct-assistant-actions button[type="submit"]').click();
        await expect(page.locator('.ct-assistant-answer')).toContainText('Local answer.');
        const asked = obs.calls.filter(c => c.method === 'AskQuestion');
        expect(asked.length).toBe(1);
        expect(asked[0].body.call[3][1].attachment.v.contents.v).toBe('');

        // A world-readable file still reads, as the logged-in user.
        await readFile(page, '/etc/os-release');
        await expect(page.locator('#ct-assistant-context-text')).toHaveValue(/VERSION_ID=/);
        await expect(page.locator('.ct-assistant-file-read-as')).toHaveText(`Read as ${process.env.COCKPIT_USER}.`);

        expectCladNeverSuperuser(obs.opens);
    });
});
