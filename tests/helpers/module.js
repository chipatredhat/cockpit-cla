// Shared steps for the module's own specs: open the page (optionally with a
// websocket rewrite installed first), drive the chat selector, and run `c` on
// the VM over ssh.
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { loginToCockpit, COCKPIT_URL, MODULE_PATH } = require('./cockpit.js');
const { routeCockpitSocket, callMethod } = require('./socket.js');

// Log in, install the optional socket rewrite (after login, so only the module
// page's socket is proxied — see socket.js), and wait for the connected banner.
async function openModule(page, route) {
    await loginToCockpit(page);
    if (route) {
        await routeCockpitSocket(page, route);
        await page.goto(COCKPIT_URL + MODULE_PATH);
    }
    // A host with a command-line-assistant older than 0.4.2 shows "Unsupported
    // version" instead; only versions.spec.js applies there (TESTING.md).
    await expect(page.locator('.ct-assistant-status'),
                 'the page must connect (an "Unsupported version" host can run only versions.spec.js)')
            .toContainText('Connected', { timeout: 30000 });
}

// Open the (i) "About" popover beside the status label and return it. It holds
// the endpoint and the package version (each once known) and Feedback.
async function openAbout(page) {
    await page.getByRole('button', { name: 'About', exact: true }).click();
    const details = page.locator('.ct-assistant-about');
    await expect(details).toBeVisible();
    return details;
}

const LABEL_COLORS = /pf-m-(blue|teal|green|orange|orangered|purple|red|yellow)\b/;

// The status label beside the title: exactly `text`, in `color` ("grey" is
// PatternFly's default label, which has no color modifier), with or without
// an icon, and the (i) "About" button always beside it.
async function expectStatusLabel(page, { text, color, icon }) {
    const status = page.locator('.ct-assistant-header .ct-assistant-status');
    await expect(status).toHaveCount(1);
    const label = status.locator('.pf-v6-c-label');
    await expect(label).toHaveText(text, { timeout: 30000 });
    await expect(status).toHaveText(text); // the label is the only text there
    if (color === 'grey')
        await expect(label).not.toHaveClass(LABEL_COLORS);
    else
        await expect(label).toHaveClass(new RegExp(`pf-m-${color}\\b`));
    await expect(label.locator('.pf-v6-c-label__icon')).toHaveCount(icon ? 1 : 0);
    if (icon)
        await expect(label.locator(".pf-v6-c-label__icon svg").first()).toBeVisible();
    const about = status.getByRole('button', { name: 'About', exact: true });
    await expect(about).toHaveCount(1);
    await expect(about).toBeVisible();
    await expect(page.getByRole('button', { name: 'About', exact: true })).toHaveCount(1);
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// An option in the open chat menu, by exact chat name (so "cockpit" never
// matches "cockpit-probe"). The accessible name is "<name> <description>".
function chatOption(page, name) {
    return page.getByRole('option', { name: new RegExp('^' + escapeRegExp(name) + '(\\s|$)') });
}

async function selectChat(page, name) {
    await page.click('#ct-assistant-chat-toggle');
    await chatOption(page, name).click();
    await expect(page.locator('#ct-assistant-chat-toggle')).toHaveText(name);
}

async function createChatInUi(page, name) {
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const modal = page.locator('.ct-assistant-new-chat-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#ct-assistant-new-chat-name').fill(name);
    await modal.getByRole('button', { name: 'Create' }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator('#ct-assistant-chat-toggle')).toHaveText(name);
}

async function deleteSelectedChatInUi(page, name) {
    await page.getByRole('button', { name: 'Chat actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete chat…' }).click();
    const modal = page.locator('.ct-assistant-delete-chat-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(`Delete the chat named ${name}?`);
    await expect(modal.getByRole('button', { name: 'Delete chat' })).toBeEnabled(); // entries counted
    await modal.getByRole('button', { name: 'Delete chat' }).click();
    await expect(modal).toHaveCount(0);
}

// Open the "Add context" editor if it is collapsed.
async function openContextEditor(page) {
    const toggle = page.getByRole('button', { name: /^Add context/ });
    if (await toggle.getAttribute('aria-expanded') !== 'true')
        await toggle.click();
    await expect(page.locator('#ct-assistant-context-text')).toBeVisible();
}

// Paste text into the context box (replacing what is there).
async function pasteContext(page, text) {
    await openContextEditor(page);
    await page.fill('#ct-assistant-context-text', text);
}

// "Read a file on this host…": reveal the path field if needed and read.
async function readFileInUi(page, path) {
    await openContextEditor(page);
    const field = page.locator('#ct-assistant-context-file');
    if (!await field.isVisible())
        await page.getByRole('button', { name: 'Read a file on this host…' }).click();
    await field.fill(path);
    await page.getByRole('button', { name: 'Read file' }).click();
}

// A chat name unique to this run, within clad's 25-character name column.
function uniqueChatName(browserName) {
    return `pw-${browserName.slice(0, 2)}-${Date.now().toString(36)}`;
}

// Run a command on the VM as the test user. `c` reads stdin as context, so
// stdin is always /dev/null.
function ssh(command) {
    const args = [];
    if (process.env.COCKPIT_SSH_CONFIG)
        args.push('-F', process.env.COCKPIT_SSH_CONFIG);
    args.push('-o', 'BatchMode=yes', process.env.COCKPIT_SSH, command + ' </dev/null');
    return execFileSync('ssh', args, { encoding: 'utf8', timeout: 60000 });
}

// Answer AskQuestion/WriteHistory locally (nothing reaches the backend or
// history) and record every AskQuestion's question argument. answerFor(message, n)
// gives the reply text. `writeHistory: "real"` lets WriteHistory reach clad.
function localAsk(answerFor = () => 'Local answer.', { writeHistory = 'local' } = {}) {
    const asked = [];
    const route = {
        answer: (_channel, body) => {
            const method = callMethod(body);
            if (method === 'AskQuestion') {
                const q = body.call[3][1];
                asked.push(q);
                return { reply: [[{ message: { t: 's', v: answerFor(q.message.v, asked.length) } }]], id: body.id };
            }
            if (method === 'WriteHistory' && writeHistory === 'local')
                return { reply: [[]], id: body.id };
            return undefined;
        },
    };
    return { route, asked };
}

module.exports = {
    openModule,
    openAbout,
    expectStatusLabel,
    chatOption,
    selectChat,
    createChatInUi,
    deleteSelectedChatInUi,
    uniqueChatName,
    ssh,
    openContextEditor,
    pasteContext,
    readFileInUi,
    localAsk,
};
