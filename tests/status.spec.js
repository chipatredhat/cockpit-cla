const { test, expect } = require('@playwright/test');
const { loginToCockpit, COCKPIT_URL, MODULE_PATH } = require('./helpers/cockpit.js');
const { routeCockpitSocket, callMethod } = require('./helpers/socket.js');
const { openAbout, expectStatusLabel, ssh } = require('./helpers/module.js');
const { cladBuild, expectEndpointLine } = require('./helpers/clad-build.js');

// `c feedback`, verbatim (command_line_assistant/commands/feedback.py,
// 0.5.2-4, identical on RHEL 9.8 and 10.2). The managed sentence is appended
// whenever the installed build's CLI appends it: when IsRedHatManagedEndpoint()
// is true, and always on builds without that method (before 0.5.2).
const FEEDBACK_NOTICE = 'Do not include any personal information or other sensitive information in your feedback.';
const FEEDBACK_MANAGED = "Feedback may be used to improve Red Hat's products or services.";
const FEEDBACK_ADDRESS_LINE = 'To submit feedback, use the following email address: cla-feedback@redhat.com.';
const ISSUES_URL = 'https://github.com/chipatredhat/cockpit-cla/issues';

// The two feedback sections of the open About popover: the assistant's, with
// or without Red Hat's sentence, then this module's issue tracker.
// They are the popover's only headings, both h2.
async function expectFeedback(about, { redHatSentence }) {
    const headings = about.getByRole('heading');
    await expect(headings).toHaveText(['Feedback on the command-line assistant', 'Feedback on this page']);
    await expect(about.locator('h2')).toHaveCount(2);

    const feedback = about.locator('.ct-assistant-feedback');
    await expect(feedback.getByRole('heading', { name: 'Feedback on the command-line assistant', exact: true }))
            .toBeVisible();
    await expect(feedback.locator('.ct-assistant-feedback-notice'))
            .toHaveText(redHatSentence ? `${FEEDBACK_NOTICE} ${FEEDBACK_MANAGED}` : FEEDBACK_NOTICE);
    await expect(feedback.locator('.ct-assistant-feedback-managed')).toHaveCount(redHatSentence ? 1 : 0);
    await expect(feedback.locator('.ct-assistant-feedback-address')).toHaveText(FEEDBACK_ADDRESS_LINE);
    const link = feedback.getByRole('link', { name: 'cla-feedback@redhat.com' });
    await expect(link).toHaveAttribute('href', 'mailto:cla-feedback@redhat.com');
    await expect(feedback.locator('a')).toHaveCount(1);

    const moduleFeedback = about.locator('.ct-assistant-module-feedback');
    await expect(moduleFeedback.getByRole('heading', { name: 'Feedback on this page', exact: true })).toBeVisible();
    const issues = moduleFeedback.getByRole('link', { name: 'Report a problem with this module', exact: true });
    await expect(issues).toBeVisible();
    await expect(issues).toHaveAttribute('href', ISSUES_URL);
    await expect(issues).toHaveAttribute('target', '_blank');
    await expect(issues).toHaveAttribute('rel', /(^|\s)noopener(\s|$)/);
    await expect(issues).toHaveAttribute('rel', /(^|\s)noreferrer(\s|$)/);
    // The external-link icon: one icon (PatternFly's svg, which nests its variants), after the text.
    const icon = issues.locator(':scope > svg');
    await expect(icon).toHaveCount(1);
    await expect(icon).toBeVisible();
    expect(await issues.evaluate(a => a.lastElementChild?.tagName.toLowerCase())).toBe('svg');
    await expect(moduleFeedback.locator('a')).toHaveCount(1);
}

// This module's own version line: only when rpm reports the
// cockpit-cla package. A development install (files in
// ~/.local/share/cockpit) has no such package, so no line.
async function expectModuleVersion(about) {
    const line = about.locator('.ct-assistant-module-version');
    if (process.env.COCKPIT_SSH) {
        const rpm = ssh("rpm -q --quiet cockpit-cla && rpm -q --queryformat '%{VERSION}-%{RELEASE}' cockpit-cla || true").trim();
        if (rpm)
            await expect(line).toHaveText(`cockpit-cla ${rpm}`);
        else
            await expect(line).toHaveCount(0);
    } else if (await line.count() > 0) {
        await expect(line).toHaveText(/^cockpit-cla \S+-\S+$/);
    }
}

// The version line: rpm's VERSION-RELEASE, and the same as `rpm -q` over ssh.
async function expectVersion(about) {
    const version = about.locator('.ct-assistant-version');
    await expect(version).toHaveText(/^command-line-assistant \d+\.\d+\.\d+-\S+$/);
    if (process.env.COCKPIT_SSH) {
        const rpm = ssh("rpm -q --queryformat '%{VERSION}-%{RELEASE}' command-line-assistant").trim();
        await expect(version).toHaveText(`command-line-assistant ${rpm}`);
    }
}

// Rewrites that put the real bridge/daemon into a state (as in edge-states.spec.js).
const NOT_INSTALLED = {
    toServer: (channel, body) => {
        if (channel === '' && body.command === 'open' && body.name?.startsWith('com.redhat.lightspeed.'))
            return { ...body, name: body.name.replace('com.redhat.lightspeed.', 'com.redhat.lightspeed.notinstalled.') };
        return undefined;
    },
};
// rpm reports a version for this module's own package: the page's rpm query
// for it runs printf instead, through the real bridge.
const MODULE_RPM_VERSION = '1.2-3.test';
const MODULE_RPM = {
    toServer: (channel, body) => {
        if (channel === '' && body.command === 'open' && Array.isArray(body.spawn) &&
            body.spawn[0] === 'rpm' && body.spawn.at(-1) === 'cockpit-cla')
            return { ...body, spawn: ['printf', '%s', MODULE_RPM_VERSION] };
        return undefined;
    },
};
const DAEMON_ERROR = {
    toServer: (_channel, body) => {
        if (callMethod(body) === 'GetUserId')
            return { ...body, call: [body.call[0], body.call[1], body.call[2], [0]] };
        return undefined;
    },
};

async function openWith(page, route) {
    await loginToCockpit(page);
    await routeCockpitSocket(page, route);
    await page.goto(COCKPIT_URL + MODULE_PATH);
}

test.describe('status banner', () => {
    test.beforeEach(async ({ page }) => {
        await loginToCockpit(page);
    });

    test('page title, then connected, the endpoint and the installed package version', async ({ page }) => {
        // One visible h1, with the subtitle under it.
        const h1 = page.getByRole('heading', { level: 1 });
        await expect(h1).toHaveCount(1);
        await expect(h1).toHaveText('Assistant');
        await expect(h1).toBeVisible();
        await expect(page.locator('.ct-assistant-subtitle')).toHaveText('powered by RHEL Lightspeed');
        await expect(page.locator('.ct-assistant-subtitle')).toBeVisible();

        // A green "Connected" label, saying nothing else.
        const status = page.locator('.ct-assistant-status');
        await expect(status).toBeVisible({ timeout: 30000 });
        await expectStatusLabel(page, { text: 'Connected', color: 'green', icon: true });
        const label = status.locator('.pf-v6-c-label');
        await expect(label).toHaveClass(/pf-m-green/);
        await expect(label).toHaveText('Connected');
        await expect(status).toHaveText('Connected');

        // The facts behind it: the test VMs are RHSM-registered, so clad
        // points at Red Hat's endpoint, which builds from 0.5.2 report and
        // older ones give no way to know; the version is rpm's VERSION-RELEASE.
        const expected = await cladBuild(page);
        const details = await openAbout(page);
        await expectEndpointLine(details, expected);
        await expect(details.locator('.ct-assistant-version')).toHaveText(/^command-line-assistant \d+\.\d+\.\d+-\S+$/);
        if (process.env.COCKPIT_SSH) {
            const rpm = ssh("rpm -q --queryformat '%{VERSION}-%{RELEASE}' command-line-assistant").trim();
            await expect(details.locator('.ct-assistant-version')).toHaveText(`command-line-assistant ${rpm}`);
        }
        await expectModuleVersion(details);
        // The (i) is named "About", and so is its popover.
        await expect(page.getByRole('dialog', { name: 'About' })).toBeVisible();
        await expect(details.locator('.ct-assistant-about-divider')).toHaveCount(1);
        // Red Hat endpoint, or a build whose CLI always adds it: Red Hat's sentence is there too.
        await expectFeedback(details, { redHatSentence: expected.redHatSentence });
    });

    // On a host where the page comes from the installed rpm (no per-user copy
    // in ~/.local shadowing it), the About popover shows that rpm's version.
    test('module version: the installed cockpit-cla rpm, when the page is served from it', async ({ page }) => {
        test.skip(!process.env.COCKPIT_SSH, 'needs COCKPIT_SSH to ask rpm on the host');
        const owner = ssh("rpm -qf --queryformat '%{NAME}' /usr/share/cockpit/cla/index.html 2>/dev/null || true").trim();
        const shadowed = ssh('test -e ~/.local/share/cockpit/cla && echo yes || true').trim();
        test.skip(owner !== 'cockpit-cla' || shadowed === 'yes', 'development install, not the rpm');

        const rpm = ssh("rpm -q --queryformat '%{VERSION}-%{RELEASE}' cockpit-cla").trim();
        expect(rpm).toMatch(/^\d+\.\d+\.\d+-\d+\.el\d+$/);
        const about = await openAbout(page);
        await expect(about.locator('.ct-assistant-module-version')).toHaveText(`cockpit-cla ${rpm}`);
    });

    test('mount div keeps ct-page-fill', async ({ page }) => {
        await expect(page.locator('#app')).toHaveClass(/ct-page-fill/);
    });

    // The legal text itself is covered by legal.spec.js.
});

// Each test opens the page itself, in the state it needs.
test.describe('status label and About, in every state', () => {
    test('not a Red Hat endpoint: "Not a Red Hat managed endpoint", feedback without the managed sentence', async ({ page }) => {
        await openWith(page, {
            answer: (_channel, body) => (callMethod(body) === 'IsRedHatManagedEndpoint'
                ? { reply: [[false]], id: body.id }
                : undefined),
        });
        await expectStatusLabel(page, { text: 'Connected', color: 'green', icon: true });
        const about = await openAbout(page);
        await expect(about.locator('.ct-assistant-endpoint')).toHaveText('Not a Red Hat managed endpoint');
        await expectVersion(about);
        await expectModuleVersion(about);
        await expectFeedback(about, { redHatSentence: false });
    });

    test('module version: "cockpit-cla <v>" when rpm reports it', async ({ page }) => {
        await openWith(page, MODULE_RPM);
        await expectStatusLabel(page, { text: 'Connected', color: 'green', icon: true });
        const expected = await cladBuild(page);
        const about = await openAbout(page);
        await expect(about.locator('.ct-assistant-module-version'))
                .toHaveText(`cockpit-cla ${MODULE_RPM_VERSION}`);
        // clad's package line is unaffected, and both come before the divider.
        await expectVersion(about);
        await expect(about.locator('.ct-assistant-about-divider')).toHaveCount(1);
        const order = await about.locator('.ct-assistant-endpoint, .ct-assistant-version, .ct-assistant-module-version, .ct-assistant-about-divider')
                .evaluateAll(els => els.map(el => el.className.split(' ').find(c => c.startsWith('ct-'))));
        // (No endpoint line on builds without IsRedHatManagedEndpoint.)
        expect(order).toEqual([...(expected.endpointLine ? ['ct-assistant-endpoint'] : []),
            'ct-assistant-version', 'ct-assistant-module-version', 'ct-assistant-about-divider']);
        await expectFeedback(about, { redHatSentence: expected.redHatSentence });
    });

    test('loading: grey "Connecting…", About with only what is known', async ({ page }) => {
        // Hold GetUserId and IsRedHatManagedEndpoint in flight: the page stays
        // in its loading state and the endpoint is not known.
        await openWith(page, {
            answer: (_channel, body) => {
                const method = callMethod(body);
                if (method === 'GetUserId' || method === 'IsRedHatManagedEndpoint')
                    return new Promise(() => {});
                return undefined;
            },
        });
        await expectStatusLabel(page, { text: 'Connecting…', color: 'grey', icon: false });
        await expect(page.locator('.ct-assistant-header .pf-v6-c-skeleton')).toHaveCount(0);
        const about = await openAbout(page);
        // rpm is asked on its own, so the version is there while clad is not.
        await expectVersion(about);
        await expectModuleVersion(about);
        await expect(about.locator('.ct-assistant-endpoint')).toHaveCount(0);
        await expectFeedback(about, { redHatSentence: false });
        // Still loading after all that.
        await expect(page.locator('.ct-assistant-status .pf-v6-c-label')).toHaveText('Connecting…');
    });

    test('not installed: grey "Not installed", no endpoint, version as rpm reports it', async ({ page }) => {
        await openWith(page, NOT_INSTALLED);
        await expectStatusLabel(page, { text: 'Not installed', color: 'grey', icon: false });
        const about = await openAbout(page);
        // clad cannot be asked, so there is no endpoint line and no managed
        // sentence. rpm is asked separately (the package is really installed on the VM).
        await expect(about.locator('.ct-assistant-endpoint')).toHaveCount(0);
        await expectVersion(about);
        await expectModuleVersion(about);
        await expectFeedback(about, { redHatSentence: false });
    });

    test('connection error: red "Connection error", About still has version and endpoint', async ({ page }) => {
        await openWith(page, DAEMON_ERROR);
        await expectStatusLabel(page, { text: 'Connection error', color: 'red', icon: true });
        // The body is unchanged: clad's own error in the alert under the title.
        await expect(page.locator('.ct-assistant-status-detail')).toContainText('Unix user ID mismatch: access denied');
        const expected = await cladBuild(page);
        const about = await openAbout(page);
        // clad did answer IsRedHatManagedEndpoint (or, before 0.5.2, said it
        // has no such method); only GetUserId failed.
        await expectEndpointLine(about, expected);
        await expectVersion(about);
        await expectModuleVersion(about);
        await expectFeedback(about, { redHatSentence: expected.redHatSentence });
    });

    test('disabled: grey "Disabled" with a lock, version but no endpoint', async ({ page }) => {
        const user = process.env.COCKPIT_DENIED_USER;
        const pass = process.env.COCKPIT_DENIED_PASS;
        test.skip(!user || !pass, 'COCKPIT_DENIED_USER/COCKPIT_DENIED_PASS not set — needs the disabled-user fixture on the VM');

        await loginToCockpit(page, { user, pass, admin: false });
        await expectStatusLabel(page, { text: 'Disabled', color: 'grey', icon: true });
        await expect(page.locator('.ct-assistant-status-detail'))
                .toContainText('The administrator has disabled the command-line assistant for your account.');
        const about = await openAbout(page);
        // The fixture's D-Bus policy denies the disabled user every clad name, so the
        // endpoint is unknown; rpm still reports the version.
        await expect(about.locator('.ct-assistant-endpoint')).toHaveCount(0);
        await expectVersion(about);
        await expectModuleVersion(about);
        await expectFeedback(about, { redHatSentence: false });
    });
});
