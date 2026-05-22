# Parrot React Frontend

This is the browser frontend for Parrot. It handles account login, profile management, contacts, real-time chat, encrypted messages, message replies, emoji reactions, voice notes, inline audio/video playback, linked devices, and recovery-key flows.

## Tech Stack

- React 19
- TypeScript
- Vite
- Axios
- React Router
- Lucide icons
- Tailwind CSS tooling
- libsodium-wrappers for browser E2EE

## Environment Variables

Create `React/.env` for local development:

```env
VITE_PARENT_API_BASE_URL=http://127.0.0.1:5000/parent
VITE_MESSENGER_SERVICE_URL=http://127.0.0.1:8000
```

Production uses the deployed Parent and Messenger service URLs.

## Commands

Install dependencies:

```powershell
npm install
```

Run local dev server:

```powershell
npm run dev
```

Build for production:

```powershell
npm run build
```

Preview production build:

```powershell
npm run preview
```

Lint:

```powershell
npm run lint
```

## Source Layout

```text
src/
|-- App.tsx                         # top-level logged-in/logged-out switch
|-- parent/
|   |-- api.js                      # Parent API client and parent JWT storage
|   |-- pages/jsx/WelcomePage.jsx   # registration/login UI
|   |-- pages/jsx/LayoutPage.jsx    # authenticated app shell
|   |-- pages/jsx/Header.jsx        # profile/account/linked-device modals
|   `-- pages/jsx/ContactPanel.jsx  # contact search and management
|-- messenger/
|   |-- api.js                      # Messenger API client, JWT refresh, WS URLs
|   |-- cache.js                    # account-scoped UI cache for messenger data
|   |-- MessengerInboxListener.jsx  # inbox WebSocket listener
|   |-- e2ee/
|   |   |-- devices/index.js        # linked-device identity and signed actions
|   |   |-- messages.js             # message encryption/decryption
|   |   |-- files.js                # encrypted attachment and voice-note handling
|   |   |-- recovery.js             # recovery-key backup and verification
|   |   |-- RecoverySetupModal.jsx
|   |   |-- RecoveryRestoreModal.jsx
|   |   `-- RecoveryVerifyModal.jsx
|   `-- pages/jsx/
|       |-- MessengerRoomList.jsx
|       |-- MessengerConversation.jsx
|       `-- MessengerRoomHeader.jsx
`-- components/
    |-- Layout.jsx
    `-- ParrotToast.jsx
```

## Frontend Flow

### Logged Out

`WelcomePage` lets a user register and login. Login stores Parent tokens and the current user. The app clears stale Messenger tokens on login so a new Parent account cannot accidentally reuse a previous account's Messenger token.

### Logged In

`LayoutPage` initializes:

- inbox WebSocket
- contacts/chats panel
- room list and active conversation
- E2EE device setup
- recovery setup/restore/verify modals

The logged-in app is keyed by the current Parent account. If a different account logs in on the same browser, React remounts the authenticated app and drops the old account's contacts, rooms, selected conversation, and runtime E2EE caches.

`LayoutPage` also hydrates messenger UI from an account-scoped localStorage cache before network requests finish. The cache stores saved contacts, room list data, selected room/contact, peer profile data used by the conversation header, and fetched message pages by room. API responses, websocket events, message-status events, contact edits, and paginated message loads update the cache immediately. Logout or session expiry clears that account's messenger UI cache.

### First Device

On first login for a new account:

1. `ensureMessengerDeviceKey` creates a local browser device keypair.
2. The device is registered through Messenger.
3. The app opens linked-device setup because no default device exists.
4. The user creates the default-device password and marks this device as default.
5. The user creates and saves a recovery key.

### Additional Devices

On another browser/device:

1. A new device identity is created and registered.
2. If a recovery backup exists, the user must enter the recovery key.
3. The app allows 5 attempts.
4. On success, old encrypted messages can decrypt.
5. The device remains non-default unless the user verifies the default-device password to make this current device default, or the current default browser makes it default.
6. On logout, a non-default device signs a logout request, clears its E2EE localStorage keys, and lets Messenger delete its device row.

The linked-device modal separates the default device into a top section and active devices into a second section. It shows all active linked devices on the default browser. On a non-default browser, it shows the current browser and the current default browser, so the user can see which device owns recovery and device-management permissions. Any default-device change opens a password prompt; non-default devices can only make themselves default.

### Recovery-Key Updates

When the default device updates the recovery key:

1. Messenger broadcasts `recovery.key_updated`.
2. Non-default devices fetch the encrypted backup.
3. `RecoveryVerifyModal` asks for the new key.
4. The key is verified locally and discarded.
5. Only an acknowledgement marker is stored.

## E2EE Storage

Browser E2EE data is scoped per user under localStorage keys beginning with:

```text
parrot:e2ee:v1
parrot:e2ee.recovery-key:v1
parrot:e2ee.recovery-key-ack:v1
```

The default device may store the plain recovery key locally so it can show it to the owner. Non-default devices clear and do not store the plain recovery key.

The default-device password is sent only when making a device default or updating that password. Messenger stores a password hash, and React does not persist the plain password.

## Message Send Queue

The conversation composer stays usable while a send is in progress. Each submitted draft is added to an in-memory FIFO queue with an optimistic message and unique `client_message_id`. React encrypts and sends one queued message at a time, which keeps first-come-first-serve order for rapid sends. Messenger treats repeated `client_message_id` values from the same sender as duplicates, so retry behavior remains safe.

## Conversation Composer And Media

The composer keeps the voice-note button separate from the text send button. Text sends use the send action, while voice notes start from the microphone action so recording cannot accidentally conflict with typed-message submission.

Voice notes are recorded in the browser with `navigator.mediaDevices.getUserMedia` and `MediaRecorder`; no third-party voice API is required. When recording stops, React sends the voice note through the same encrypted attachment pipeline used for files. The encrypted message payload marks the attachment as `attachment_kind: "voice_note"` and includes safe UI metadata such as recorded duration and waveform data.

Voice-note playback uses a compact chat-player UI with a play/pause button, progress, duration, and waveform styling. React preloads/decrypts the audio source before playback so the first click starts playback instead of only triggering decryption.

Single non-voice-note audio/video attachments render as inline players inside the conversation. The inline play button controls message-room playback. The maximize button opens the media modal and hands off the current playback time and playing state, so the modal continues from the same position instead of restarting.

## Replies And Reactions

Messages support reply targeting and five emoji reactions: thumbs up, heart, laugh, surprised, and sad. The frontend owns the visual emoji mapping and themed styling, while Messenger stores the reaction key and returns grouped reaction counts plus the current user's reaction.

Reply previews are target-aware. If the replied-to message was sent by the current user, the preview uses a blue treatment. If the replied-to message was received from the contact, the preview uses a white treatment. The same styling is used in the composer reply preview before sending and in the final message bubble after sending.

Desktop interaction:

- Hover the message bubble to show the reply control and emoji picker with a small pop animation.
- The hover trigger is limited to the message bubble, not the full row.
- Mouse drag-to-reply is disabled on desktop.

Mobile interaction:

- Tap the message bubble to show the reply control and emoji picker beside the bubble.
- The mobile popup does not rely on hover and does not push the message row down.
- Swipe either left or right on a message to select it as the reply target.
- Long press still opens the message actions for touch/pen users.

## Encrypted Attachments

React encrypts attachments in the browser before upload. For each queued message with files or voice notes, React asks Messenger for signed Cloudinary upload intents bound to the authenticated sender, recipient account, and `client_message_id`. It then uploads the encrypted blobs directly to Cloudinary as `raw` resources, completes each intent with Messenger, and sends the completed intent ids with the encrypted message envelope.

Cloudinary API secrets stay only on Messenger. React receives only short-lived signed params for server-generated public ids, and pending/local blob previews are not stored in the UI cache. Voice-note duration, waveform, and media presentation hints live in the frontend-encrypted payload, not in Messenger-readable fields.

## Realtime Updates

React keeps two Messenger websocket paths active while logged in:

- inbox socket: room list updates, delivery receipts, read receipts, message reaction updates, presence, device, and recovery events
- room socket: open-conversation messages, message status updates, message reaction updates, and typing events

The room socket sends periodic pings to stay alive behind proxies. The open conversation also listens to inbox message/status events as a fallback, so messages and ticks can update while the room socket is reconnecting.

## Messenger UI Cache

The messenger UI cache is separate from E2EE private-key storage. It is scoped per account under `parrot:messenger-ui-cache:v1:*` and contains only UI data needed for fast rendering:

- contacts and saved aliases
- room list previews, unread counts, and selected room/contact
- conversation header peer profile lookup results
- decrypted message text and safe attachment metadata for fetched conversation pages

Pending optimistic messages and local `blob:` attachment preview URLs are not persisted. Cached conversations are bounded per room and per account so localStorage cannot grow without limit. Messenger APIs and WebSockets remain the source of truth; cached data is only used for instant first paint and offline-tolerant navigation until logout.

Logout cleanup follows the device role:

- default device: clear Parent/Messenger session tokens only; keep local E2EE device identity, recovery key state, and the Messenger default-device row
- non-default device: clear Parent/Messenger session tokens, local E2EE identity, recovery key state, and recovery acknowledgement; Messenger deletes the device row

## API Clients

`parent/api.js`:

- stores Parent access/refresh tokens
- refreshes Parent sessions
- calls profile/contact/account APIs

`messenger/api.js`:

- obtains a short-lived Messenger JWT from Parent
- rejects stored Messenger tokens belonging to a different current Parent user
- calls room/message/E2EE APIs
- builds Messenger WebSocket URLs

## Build Notes

The Vite build loads native Windows packages for Tailwind/Rolldown. In restricted sandboxes the first build attempt can fail with `spawn EPERM`; running the same `npm run build` outside that sandbox succeeds.
