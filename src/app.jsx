// SPDX-License-Identifier: LGPL-2.1-or-later
import cockpit from 'cockpit';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, AlertActionCloseButton, AlertGroup } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Tabs, Tab, TabContent, TabTitleText } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { AskTab } from './components/AskTab.jsx';
import { ChatSelector } from './components/ChatSelector.jsx';
import { HistoryTab } from './components/HistoryTab.jsx';
import { StatusDetail, StatusLabel } from './components/StatusBanner.jsx';
import {
    WEB_CHAT_NAME, classifyError, getChats, getUserId, isChatAvailable, isRedHatManagedEndpoint
} from './lib/clad.js';
import { getPackageVersion, getSystemInfo } from './lib/host-info.js';

const _ = cockpit.gettext;

export const App = () => {
    const [status, setStatus] = useState({ state: "loading" });
    // What the (i) "About" popover shows, each fact once known: clad's
    // IsRedHatManagedEndpoint answer and rpm's versions of clad's package and
    // this module's, each asked on its own, so they show whatever state the
    // page is in.
    const [managed, setManaged] = useState(/** @type {boolean|undefined} */ (undefined));
    const [version, setVersion] = useState(/** @type {string|null|undefined} */ (undefined));
    const [moduleVersion, setModuleVersion] = useState(/** @type {string|null|undefined} */ (undefined));
    const [systemInfo, setSystemInfo] = useState(null);
    const [systemInfoError, setSystemInfoError] = useState(null);
    const [activeTab, setActiveTab] = useState("ask");
    const [chats, setChats] = useState(/** @type {Object[]|null} */ (null));
    const [chatsError, setChatsError] = useState(null);
    // Page state only: every load starts at the web console's own chat.
    const [selectedChat, setSelectedChat] = useState(WEB_CHAT_NAME);
    const [selectedExists, setSelectedExists] = useState(false);
    const [toasts, setToasts] = useState(/** @type {Object[]} */ ([]));
    const [focusQuestion, setFocusQuestion] = useState(0);
    const chatsLoadId = useRef(0);
    const toastId = useRef(0);
    const askRef = useRef(null);
    const historyRef = useRef(null);

    // Transient confirmations of chat changes; page state only.
    const notify = useCallback(title => {
        const key = ++toastId.current;
        setToasts(list => [...list, { key, title }]);
    }, []);
    const dismiss = key => setToasts(list => list.filter(t => t.key !== key));

    const load = useCallback(async () => {
        getSystemInfo()
                .then(info => { setSystemInfo(info); setSystemInfoError(null) })
                .catch(ex => setSystemInfoError(ex.message || String(ex)));

        getPackageVersion("command-line-assistant")
                .then(setVersion)
                .catch(ex => { console.warn("Could not read the command-line-assistant version:", ex); setVersion(null) });

        // Not installed as an rpm on a development install: no line then.
        getPackageVersion("cockpit-cla")
                .then(setModuleVersion)
                .catch(ex => {
                    console.warn("Could not read the cockpit-cla version:", ex);
                    setModuleVersion(null);
                });

        const managedCall = isRedHatManagedEndpoint();
        managedCall.then(setManaged, () => setManaged(undefined));

        let userId;
        try {
            const user = await cockpit.user();
            userId = await getUserId(user.id);
        } catch (ex) {
            setStatus({ state: classifyError(ex), error: ex.message || String(ex) });
            return;
        }

        try {
            setStatus({ state: "connected", userId, managed: await managedCall });
        } catch (ex) {
            setStatus({ state: classifyError(ex), error: ex.message || String(ex) });
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const userId = status.userId;

    // clad's chat list, and whether the selected chat exists yet (it may be
    // past the list's 10-chat limit, so ask clad rather than search the list).
    const loadChats = useCallback(async () => {
        if (!userId)
            return;
        const requestId = ++chatsLoadId.current;
        try {
            const [list, exists] = await Promise.all([getChats(userId), isChatAvailable(userId, selectedChat)]);
            if (requestId !== chatsLoadId.current)
                return;
            setChats(list);
            setSelectedExists(exists);
            setChatsError(null);
        } catch (ex) {
            if (requestId === chatsLoadId.current)
                setChatsError(ex.message || String(ex));
        }
    }, [userId, selectedChat]);

    useEffect(() => {
        loadChats();
    }, [loadChats]);

    // Not installed / disabled: the empty state is the whole page.
    const showTabs = status.state === "connected" || status.state === "error";

    return (
        <Page className="pf-m-no-sidebar">
            <PageSection>
                <AlertGroup isToast isLiveRegion className="ct-assistant-toasts">
                    {toasts.map(t => (
                        <Alert
                            key={t.key} variant="success" title={t.title} timeout
                            onTimeout={() => dismiss(t.key)}
                            actionClose={<AlertActionCloseButton onClose={() => dismiss(t.key)} />}
                        />
                    ))}
                </AlertGroup>

                <Flex
                    className="ct-assistant-header" justifyContent={{ default: "justifyContentSpaceBetween" }}
                    alignItems={{ default: "alignItemsFlexStart" }} flexWrap={{ default: "nowrap" }}
                    columnGap={{ default: "columnGapMd" }}
                >
                    <FlexItem>
                        <Title headingLevel="h1" size="2xl">{_("Assistant")}</Title>
                        <Content component="p" className="ct-assistant-subtitle">
                            {_("powered by RHEL Lightspeed")}
                        </Content>
                    </FlexItem>
                    <FlexItem><StatusLabel state={status.state} about={{ managed, version, moduleVersion }} /></FlexItem>
                </Flex>
                <StatusDetail status={status} />

                {showTabs &&
                    <>
                        <Flex
                            className="ct-assistant-tabs-row" justifyContent={{ default: "justifyContentSpaceBetween" }}
                            alignItems={{ default: "alignItemsCenter" }}
                        >
                            <FlexItem>
                                <Tabs
                                    activeKey={activeTab} onSelect={(_ev, key) => setActiveTab(String(key))}
                                    className="ct-assistant-tabs" aria-label={_("Assistant")}
                                >
                                    <Tab
                                        eventKey="ask" title={<TabTitleText>{_("Ask")}</TabTitleText>}
                                        tabContentId="ct-assistant-ask-panel" tabContentRef={askRef}
                                    />
                                    <Tab
                                        eventKey="history" title={<TabTitleText>{_("History")}</TabTitleText>}
                                        tabContentId="ct-assistant-history-panel" tabContentRef={historyRef}
                                    />
                                </Tabs>
                            </FlexItem>
                            {userId &&
                                <FlexItem>
                                    <ChatSelector
                                        userId={userId} chats={chats} chatsError={chatsError}
                                        selected={selectedChat} selectedExists={selectedExists}
                                        onSelect={setSelectedChat} onChanged={loadChats} notify={notify}
                                        onCreated={() => activeTab === "ask" && setFocusQuestion(n => n + 1)}
                                    />
                                </FlexItem>}
                        </Flex>

                        {/* Both panels stay mounted, so questions asked on this page survive a tab switch. */}
                        <TabContent eventKey="ask" id="ct-assistant-ask-panel" ref={askRef} hidden={activeTab !== "ask"}>
                            <AskTab
                                canAsk={status.state === "connected"} userId={userId} managed={status.managed}
                                chatName={selectedChat} onChatUsed={loadChats}
                                systemInfo={systemInfo} systemInfoError={systemInfoError}
                                focusRequest={focusQuestion}
                            />
                        </TabContent>
                        <TabContent eventKey="history" id="ct-assistant-history-panel" ref={historyRef} hidden={activeTab !== "history"}>
                            {userId &&
                                <HistoryTab
                                    userId={userId} chatName={selectedChat} chatExists={selectedExists}
                                    active={activeTab === "history"}
                                />}
                        </TabContent>
                    </>}
            </PageSection>
        </Page>
    );
};
