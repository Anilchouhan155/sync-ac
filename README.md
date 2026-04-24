# AC Sync

**AC Sync** is a real-time Progressive Web App (PWA) that lets flatmates coordinate air conditioning usage — who turned it on, which room, for how long, and a live activity feed of everything that happens.

Built for small shared flats (2–3 BHK) where multiple people share AC units and electricity bills.

---

## Features

### Real-time Room Control
- Each flatmate controls only their own room's AC — other rooms are read-only
- Live AC status tiles with color-coded on/off state
- Live timer showing how long the AC has been running since it was turned on
- Flatmates see each other's room names and who made the last change

### Coordination Request
- If you turn your AC on while another flatmate's is already on, a coordination request banner appears for them asking if they want to turn theirs off
- Prevents silent conflicts — no one gets surprised by a double AC situation

### High-Load Alert
- If 2+ ACs run simultaneously for 5 minutes, a 5-minute countdown timer activates
- An explosion sound fires when the countdown hits zero as a high-load warning

### Activity Log
- Every on/off action is logged with the flatmate's name, room, and IST timestamp
- Timestamps show "today", "yesterday", or a formatted date for older entries

### Sound Alerts
- **AC Turned ON alerts** — choose from 10 sound effects (Slot Machine, Fart, Thud, Car Horn, Hehe, and more)
- **AC Turned OFF alerts** — choose from 4 confirmation sounds (Accept, Affirmative, Miracle, Universfield) — ON by default with Affirmative pre-selected
- Each section has an independent toggle and a 2-column sound picker grid
- Sound preference is saved per device in localStorage

### Background Push Notifications
- Web Push notifications fire even when the app is closed or in the background
- Each device subscribes with a VAPID push subscription stored in Firestore
- When a flatmate changes AC state, all other flatmates get a push via Vercel serverless function
- iOS Safari supports Web Push via the home screen PWA install
- iOS Chrome does not support Web Push — app shows guidance to switch to Safari

### PWA Install
- Sticky install banner on the onboarding screen adapts per platform:
  - **Android / Desktop Chrome** — "Install" button triggers the native `beforeinstallprompt` flow
  - **iOS Safari** — shows "Tap Share → Add to Home Screen" instructions
  - **iOS Chrome** — explains that Chrome on iOS doesn't support PWA; suggests opening in Safari
- Banner hides automatically once the app is installed (standalone mode detected)

### Onboarding Flow
- Step 1: Enter flat number and select flat type (2 BHK / 3 BHK)
- Step 2: Enter name and pick your room
- Flatmates who enter the same flat number are connected automatically
- Room options (Room A / B / C) are created in Firestore on first setup

### Settings
- Toggle sound alerts for AC on and AC off independently
- Select a preferred sound for each event from a grid
- Toggle background push notifications on/off
- Reset & Onboard button: clears all localStorage, sessionStorage, service worker caches, and Firestore profile — returns to fresh onboarding

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript |
| Build tool | Vite 6 |
| Styling | Tailwind CSS v4 |
| Animation | Motion (Framer Motion) |
| Database | Firebase Firestore (real-time) |
| Auth | Firebase Anonymous Auth |
| Push notifications | Web Push API + VAPID |
| Serverless function | Vercel (`api/send-notification.ts`) |
| PWA | Service Worker (`public/sw.js`) |
| Deployment | Vercel |

---

## Project Structure

```
Sync-ac/
├── api/
│   └── send-notification.ts   # Vercel serverless — sends Web Push to all flatmate subscriptions
├── public/
│   ├── sw.js                  # Service worker — caching, push handler, notification click
│   ├── manifest.json          # PWA manifest
│   └── *.mp3 / *.wav          # Sound effects for AC on/off alerts
├── src/
│   ├── App.tsx                # Entire app — onboarding, dashboard, settings, real-time logic
│   ├── lib/
│   │   ├── firebase.ts        # Firebase init, anonymous auth helper, error handler
│   │   └── utils.ts           # cn() className utility
│   └── main.tsx               # React root, service worker registration
├── firestore.rules            # Firestore security rules
├── vercel.json                # Vercel build config
└── .env.local                 # Local env vars (not committed)
```

---

## Firestore Data Model

```
/users/{uid}
  name: string
  flatId: string
  room: string
  pushSubscription: object | null

/flats/{flatId}
  number: string
  type: "2 BHK" | "3 BHK"

/flats/{flatId}/rooms/{roomName}
  status: "on" | "off"
  updatedBy: string (uid)
  updatedByName: string
  updatedAt: Timestamp

/flats/{flatId}/logs/{logId}
  roomName: string
  status: "on" | "off"
  updatedByName: string
  updatedAt: Timestamp

/flats/{flatId}/requests/{requestId}
  fromUid: string
  fromName: string
  fromRoom: string
  createdAt: Timestamp
  expireAt: Timestamp
```

---

## Environment Variables

Create a `.env.local` file in the project root with:

```env
# Firebase
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Web Push (VAPID)
VITE_VAPID_PUBLIC_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_MAILTO=mailto:you@example.com
```

Generate VAPID keys with:

```bash
npx web-push generate-vapid-keys
```

Set the same variables in your Vercel project settings under **Settings → Environment Variables**.

---

## Local Development

**Prerequisites:** Node.js 18+

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:3000)
npm run dev

# Type check
npm run lint

# Production build
npm run build
```

---

## Deployment

The app is deployed on Vercel with automatic builds.

```bash
# Deploy to production
vercel deploy --prod
```

The `api/send-notification.ts` file is picked up as a Vercel serverless function automatically. No additional config needed beyond environment variables.

---

## Firestore Security Rules

Rules are in [`firestore.rules`](./firestore.rules). Deploy them from the Firebase Console under **Firestore → Rules**, or with the Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

Key rules:
- Any signed-in user can read/create rooms, logs, and requests within a flat
- Only a user can create or update their own `/users/{uid}` document
- Requests can be deleted by any signed-in user (for coordination flow)

---

## PWA & Service Worker

The service worker (`public/sw.js`) uses:
- **Network-first** for HTML navigation — ensures users always get the latest version on refresh
- **Cache-first** for audio files and `manifest.json` — these never change
- **Network-first** for all other assets (JS/CSS bundles)
- **Push event handler** — shows notifications even when the app is closed
- **Notification click handler** — focuses existing window or opens a new one

Cache version is controlled by `CACHE_NAME = 'ac-sync-v3'`. Bump the version string to invalidate old caches on next deploy.

---

## Known Limitations

- **iOS Chrome** does not support Web Push or PWA install. Users must open the URL in Safari.
- **Sound alerts** only play if the browser tab/PWA has been interacted with at least once (browser autoplay policy).
- **Anonymous auth** means users have no password recovery — clearing app storage requires re-onboarding.
- The app does not support multiple flats per user. Each device is tied to one flat.
