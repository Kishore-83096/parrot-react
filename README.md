# Parrot React Frontend

This is the browser frontend for Parrot. It handles account login, profile management, contacts, real-time chat, encrypted messages, linked devices, and recovery-key flows.

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
|   |-- MessengerInboxListener.jsx  # inbox WebSocket listener
|   |-- e2ee/
|   |   |-- devices/index.js        # linked-device identity and signed actions
|   |   |-- messages.js             # message encryption/decryption
|   |   |-- files.js                # encrypted attachment handling
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

### First Device

On first login for a new account:

1. `ensureMessengerDeviceKey` creates a local browser device keypair.
2. The device is registered through Messenger.
3. The app opens linked-device setup because no default device exists.
4. The user marks this device as default.
5. The user creates and saves a recovery key.

### Additional Devices

On another browser/device:

1. A new device identity is created and registered.
2. If a recovery backup exists, the user must enter the recovery key.
3. The app allows 5 attempts.
4. On success, old encrypted messages can decrypt.
5. The device remains non-default until the default device promotes it.
6. On logout, a non-default device signs a logout request, clears its E2EE localStorage keys, and lets Messenger delete its device row.

The linked-device modal intentionally shows only the currently logged-in browser. It still knows whether the account already has a default device, so a non-default browser cannot promote itself while a default exists.

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
