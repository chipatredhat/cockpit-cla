// SPDX-License-Identifier: LGPL-2.1-or-later
// The chat questions are saved into, shared by the Ask and History tabs.
// Chats are clad's (GetAllChatFromUser); the selection itself is page state
// only and starts at the web console's own chat on every load.
import cockpit from 'cockpit';
import React, { useState, useEffect } from 'react';
import { Alert, AlertActionLink } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { MenuFooter } from "@patternfly/react-core/dist/esm/components/Menu/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Select, SelectList, SelectOption } from "@patternfly/react-core/dist/esm/components/Select/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { EllipsisVIcon } from "@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon.js";

import {
    CHAT_LIST_LIMIT, CLI_CHAT_NAME, WEB_CHAT_NAME, clearHistory, createChat, deleteChat, getHistory, isChatAvailable
} from '../lib/clad.js';

const _ = cockpit.gettext;

function errorText(ex) {
    return ex?.message || String(ex);
}

function entriesText(n) {
    return cockpit.format(cockpit.ngettext("$0 history entry", "$0 history entries", n), n);
}

// What the two chats with a fixed role are, said in the list of chats.
function chatRole(name) {
    if (name === WEB_CHAT_NAME)
        return _("The web console's default chat");
    if (name === CLI_CHAT_NAME)
        return _("The c command's chat");
    return null;
}

const NewChatModal = ({ userId, onClose, onCreated, onSwitch }) => {
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [existing, setExisting] = useState(null); // a name that is already a chat

    const finalName = name.trim();

    const create = async ev => {
        ev?.preventDefault();
        if (!finalName)
            return;
        setError(null);
        setExisting(null);
        setBusy(true);
        try {
            // clad's CreateChat accepts a duplicate name, which would leave two
            // chats no name-based call can tell apart.
            if (await isChatAvailable(userId, finalName)) {
                setExisting(finalName);
                setBusy(false);
                return;
            }
            await createChat(userId, finalName);
            onCreated(finalName);
        } catch (ex) {
            setError(errorText(ex));
            setBusy(false);
        }
    };

    return (
        <Modal isOpen onClose={onClose} variant="small" className="ct-assistant-new-chat-modal">
            <ModalHeader title={_("New chat")} />
            <ModalBody>
                <Form id="ct-assistant-new-chat-form" onSubmit={create}>
                    <FormGroup label={_("Chat name")} fieldId="ct-assistant-new-chat-name">
                        <TextInput
                            id="ct-assistant-new-chat-name" value={name} autoFocus
                            onChange={(_ev, v) => { setName(v); setError(null); setExisting(null) }}
                            placeholder={_("e.g. firewall-questions")}
                        />
                        <HelperText>
                            <HelperTextItem>
                                {_("Questions asked here are saved to the selected chat, which the c command can also read.")}
                            </HelperTextItem>
                        </HelperText>
                    </FormGroup>
                    {existing &&
                        <Alert
                            variant="info" isInline className="ct-assistant-chat-exists"
                            title={cockpit.format(_("A chat named $0 already exists."), existing)}
                            actionLinks={
                                <AlertActionLink onClick={() => onSwitch(existing)}>
                                    {cockpit.format(_("Switch to $0"), existing)}
                                </AlertActionLink>
                            }
                        />}
                    {error && <Alert variant="danger" isInline title={error} />}
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button
                    variant="primary" type="submit" form="ct-assistant-new-chat-form"
                    isLoading={busy} isDisabled={busy || !finalName}
                >
                    {_("Create")}
                </Button>
                <Button variant="link" onClick={onClose} isDisabled={busy}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};

// Deleting a chat in clad keeps its history entries, so the dialog offers to
// clear them first. The count is what GetHistory returns for that chat.
const DeleteChatModal = ({ userId, name, onClose, onDeleted }) => {
    const [count, setCount] = useState(null); // null while counting
    const [countError, setCountError] = useState(null);
    const [alsoClear, setAlsoClear] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        getHistory(userId)
                .then(list => setCount(list.filter(e => e.chatName === name).length))
                .catch(ex => setCountError(errorText(ex)));
    }, [userId, name]);

    const clearing = alsoClear && count > 0;

    const remove = async () => {
        setError(null);
        setBusy(true);
        try {
            let cleared = 0;
            let remaining = 0;
            if (clearing) {
                await clearHistory(userId, name);
                // ClearHistory clears the live chat's entries only; entries
                // left by an earlier chat of the same name stay. Count again.
                remaining = (await getHistory(userId)).filter(e => e.chatName === name).length;
                cleared = count - remaining;
            }
            await deleteChat(userId, name);
            onDeleted(name, cleared, remaining);
        } catch (ex) {
            setError(errorText(ex));
            setBusy(false);
        }
    };

    let entries;
    if (countError)
        entries = (
            <Alert variant="warning" isInline isPlain title={_("Could not count the chat's history entries")}>
                {countError}
            </Alert>
        );
    else if (count === null)
        entries = <Spinner size="md" aria-label={_("Counting the chat's history entries")} />;
    else if (count === 0)
        entries = <p>{_("It has no history entries.")}</p>;
    else
        entries = (
            <Checkbox
                id="ct-assistant-delete-clear" isChecked={alsoClear} onChange={(_ev, v) => setAlsoClear(v)}
                label={cockpit.format(_("Also clear this chat's $0"), entriesText(count))}
                description={alsoClear
                    ? null
                    : _("The entries are kept and still appear in History. Once the chat is deleted, only Clear all history removes them.")}
            />
        );

    return (
        <Modal isOpen onClose={onClose} variant="small" className="ct-assistant-delete-chat-modal">
            <ModalHeader title={cockpit.format(_("Delete the chat named $0?"), name)} titleIconVariant="warning" />
            <ModalBody className="ct-assistant-modal-body">
                <p>{cockpit.format(_("This removes the chat named $0."), name)}</p>
                {entries}
                {name === CLI_CHAT_NAME &&
                    <p>{cockpit.format(_("$0 is the chat the c command uses. c creates it again the next time it is run."), CLI_CHAT_NAME)}</p>}
                {error && <Alert variant="danger" isInline title={_("Could not delete the chat")}>{error}</Alert>}
            </ModalBody>
            <ModalFooter>
                <Button
                    variant="danger" onClick={remove} isLoading={busy}
                    isDisabled={busy || (count === null && !countError)}
                >
                    {_("Delete chat")}
                </Button>
                <Button variant="link" onClick={onClose} isDisabled={busy}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};

// chats: clad's list, or null while loading. selectedExists: whether clad has
// a chat with the selected name (the web console's chat is only created when
// the first question is asked). notify(title): a toast. onCreated(name): a
// chat was just created and selected.
export const ChatSelector = ({
    userId, chats, chatsError, selected, selectedExists, onSelect, onChanged, notify, onCreated
}) => {
    const [selectOpen, setSelectOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [dialog, setDialog] = useState(null); // "new" | "delete"

    // clad's created-at verbatim, after what the chat is for if it has a fixed role.
    const describe = (name, text) => {
        const role = chatRole(name);
        return role ? cockpit.format(_("$0. $1"), role, text) : text;
    };
    const notYet = _("Created when the first question is asked");

    const list = chats || [];
    const options = list.map(c => ({
        key: c.id,
        name: c.name,
        description: describe(c.name, cockpit.format(_("Created $0"), c.createdAt)),
    }));
    if (!list.some(c => c.name === selected))
        options.push({
            key: "selected:" + selected,
            name: selected,
            description: describe(selected, selectedExists
                ? cockpit.format(_("Not in the command-line assistant's list, which shows at most $0 chats"), CHAT_LIST_LIMIT)
                : notYet),
        });
    if (selected !== WEB_CHAT_NAME && !list.some(c => c.name === WEB_CHAT_NAME))
        options.push({ key: "web", name: WEB_CHAT_NAME, description: describe(WEB_CHAT_NAME, notYet) });

    const closeDialog = () => setDialog(null);

    return (
        <Flex className="ct-assistant-chat-selector" spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }} flexWrap={{ default: "nowrap" }}>
            <FlexItem className="ct-assistant-chat-label">
                <label htmlFor="ct-assistant-chat-toggle">{_("Chat")}</label>
            </FlexItem>
            <FlexItem>
                <Select
                    isOpen={selectOpen} selected={selected}
                    onSelect={(_ev, value) => { setSelectOpen(false); onSelect(String(value)) }}
                    onOpenChange={setSelectOpen}
                    toggle={ref => (
                        <MenuToggle
                            ref={ref} id="ct-assistant-chat-toggle" isExpanded={selectOpen}
                            onClick={() => setSelectOpen(!selectOpen)}
                            className="ct-assistant-chat-toggle"
                        >
                            {selected}
                        </MenuToggle>
                    )}
                    popperProps={{ position: "end" }}
                >
                    <SelectList aria-label={_("Chats")}>
                        {options.map(o => (
                            <SelectOption key={o.key} value={o.name} description={o.description}>{o.name}</SelectOption>
                        ))}
                    </SelectList>
                    {list.length >= CHAT_LIST_LIMIT &&
                        <MenuFooter className="ct-assistant-chat-limit">
                            {cockpit.format(_("The command-line assistant lists at most $0 chats, oldest first. Newer chats are not listed here."), CHAT_LIST_LIMIT)}
                        </MenuFooter>}
                </Select>
            </FlexItem>
            <FlexItem>
                <Button variant="secondary" onClick={() => setDialog("new")} isDisabled={!userId}>{_("New")}</Button>
            </FlexItem>
            <FlexItem>
                <Dropdown
                    isOpen={menuOpen} onOpenChange={setMenuOpen}
                    onSelect={() => setMenuOpen(false)}
                    popperProps={{ position: "end" }}
                    toggle={ref => (
                        <MenuToggle
                            ref={ref} variant="plain" isExpanded={menuOpen}
                            onClick={() => setMenuOpen(!menuOpen)} aria-label={_("Chat actions")}
                            icon={<EllipsisVIcon />}
                        />
                    )}
                >
                    <DropdownList>
                        <DropdownItem
                            key="delete" isDanger isDisabled={!selectedExists}
                            onClick={() => setDialog("delete")}
                        >
                            {_("Delete chat…")}
                        </DropdownItem>
                    </DropdownList>
                </Dropdown>
            </FlexItem>

            {chatsError &&
                <FlexItem>
                    <Alert variant="danger" isInline isPlain title={_("Could not list chats")}>{chatsError}</Alert>
                </FlexItem>}

            {dialog === "new" &&
                <NewChatModal
                    userId={userId} onClose={closeDialog}
                    onCreated={name => {
                        closeDialog();
                        onSelect(name);
                        onChanged();
                        notify(cockpit.format(_("Created the chat named $0. New questions are saved to it."), name));
                        onCreated(name);
                    }}
                    onSwitch={name => {
                        closeDialog();
                        onSelect(name);
                        onCreated(name);
                    }}
                />}
            {dialog === "delete" &&
                <DeleteChatModal
                    userId={userId} name={selected} onClose={closeDialog}
                    onDeleted={(name, cleared, remaining) => {
                        closeDialog();
                        onSelect(WEB_CHAT_NAME);
                        onChanged();
                        let text = cleared
                            ? cockpit.format(_("Removed the chat named $0 and its $1. Now using $2."),
                                             name, entriesText(cleared), WEB_CHAT_NAME)
                            : cockpit.format(_("Removed the chat named $0. Now using $1."), name, WEB_CHAT_NAME);
                        if (remaining)
                            text += " " + cockpit.format(_("$0 under that name remain in History."), entriesText(remaining));
                        notify(text);
                    }}
                />}
        </Flex>
    );
};
