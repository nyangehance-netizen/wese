# Wese — fuel delivered where you stopped

Wese lets a driver who has run out of fuel order petrol or diesel to their location. A nearby fuel station accepts the order, one of its riders collects the fuel and delivers it, and the client confirms delivery with a 4-digit code.

| Part | Who uses it | Folder | Tech |
|---|---|---|---|
| **Mobile app** | Clients ordering fuel, riders delivering it | `mobile/` | Expo (React Native) — one codebase for **iOS and Android** |
| **Station dashboard** | Fuel station owners/staff, Wese admin | `dashboard/` | Web app, served by the backend, works on phone or computer |
| **Backend API** | Everything above | `backend/` | Node.js 22+, built-in SQLite, no outside packages |

## How an order works

```
Client orders + pays ─▶ Station accepts (stock is deducted) ─▶ Rider takes the job
   ─▶ Fuel collected ─▶ On the way ─▶ Arrived ─▶ Client gives code ─▶ Delivered
```

- Mobile money and card orders reach the station only after payment succeeds.
- Bank transfer orders reach the station straight away; the station taps **Confirm transfer received** before it can accept.
- If the station declines, or the client cancels before acceptance, the payment is refunded automatically.
- Riders only see jobs from their own station that match their vehicle (boda: 5–20 L in sealed jerrycans, mini tanker: 30–1,000 L).
- The station dashboard updates live and plays a sound for new orders. The mobile app refreshes every few seconds.
- The 4-digit delivery code locks after 5 wrong tries.

---

## 1. Run the backend and station dashboard

You need **Node.js 22.13 or newer** (`node -v`). Nothing else to install.

```bash
cd backend
cp .env.example .env        # optional for local testing
npm run seed                # demo stations, riders and accounts
npm start
```

Open **http://localhost:4000** for the station dashboard.

Demo accounts (password `wese1234` for all):

| Role | Phone |
|---|---|
| Station: Mwenge Energies | 0713 000 001 |
| Station: Bahari Fuel Point | 0713 000 002 |
| Station: Ubungo Petro Hub | 0713 000 003 |
| Rider (Mwenge, boda) | 0754 000 011 |
| Rider (Mwenge, tanker) | 0754 000 012 |
| Client | 0754 123 456 |
| Admin (approves stations) | 0700 000 000 |

Run the automated tests (full order flow, refunds, permissions): `npm test`

## 2. Run the mobile app (iOS and Android)

**To install it on your phone for preview, follow [INSTALL-ON-PHONE.md](INSTALL-ON-PHONE.md)** (Android APK, or Expo Go on iPhone).

```bash
cd mobile
npm run setup               # installs packages with versions matching Expo SDK 56
npx expo start
```

The server address can be changed inside the app (**Server settings** on the sign-in screen), so one installed build works with any backend. Sign in as the client on one phone and a rider on another, with the station dashboard open on your computer, to run a full delivery.

### Publishing to the app stores

```bash
npm install -g eas-cli
eas login
# put your live API address in eas.json, then:
eas build -p android --profile preview      # installable APK for testing
eas build -p android --profile production   # Play Store
eas build -p ios --profile production       # App Store (needs an Apple Developer account)
eas submit -p android   /   eas submit -p ios
```

Change `bundleIdentifier` / `package` in `mobile/app.json` (`tz.co.wese.app`) to your own before the first build.

## 3. Payments

Payments run in **test mode**: no money moves. Mobile money and card payments approve automatically after 5 seconds (`TEST_AUTO_APPROVE_MS`), or the client can tap **Approve / Decline** in the app.

To take real money, open a merchant account with a Tanzanian aggregator that covers M-Pesa, Mixx by Yas, Airtel Money, HaloPesa and cards (for example Selcom, AzamPay, ClickPesa, Pesapal or DPO). Then:

1. Copy `backend/src/payments/provider-template.js` to e.g. `selcom.js` and fill in the three methods (`initiate`, `parseCallback`, `refund`) from the provider's API documentation.
2. Register it in `backend/src/payments/index.js`.
3. Set `PAYMENT_PROVIDER=selcom` and the provider's keys in `.env`.
4. Give the provider your webhook address: `https://your-api/api/payments/callback/selcom`.

Nothing else in the app changes. Each station's Lipa numbers and accounts are stored so clients can see where money goes; settling money to stations depends on how your aggregator handles payouts.

## 4. Going live

- **Hosting:** any server with Node 22 (a small VPS is enough to start). Put it behind HTTPS (e.g. Caddy or Nginx with Let's Encrypt). Back up `backend/data/wese.db` daily.
- **Settings:** set `NODE_ENV=production`, a long random `JWT_SECRET`, and your admin phone/password in `.env`.
- **Regulation:** check with **EWURA** what licences fuel delivery outside a station needs, especially by motorbike in jerrycans. Stations enter their EWURA licence number at sign-up and stay hidden from clients until an admin approves them. Set `PRICE_CAP_PETROL` / `PRICE_CAP_DIESEL` to block prices above the published cap.
- **Growing later:** SQLite handles a city-level launch. Move to PostgreSQL when you run several servers. Add push notifications (Expo Notifications) and an in-app map when needed.

## API overview

| Method & path | Who | What |
|---|---|---|
| `POST /api/auth/register`, `/login` · `GET /api/me` | all | Accounts (phone + password) |
| `GET /api/stations/nearby?lat&lng&fuel&litres&delivery` | client | Stations that can deliver, with full price quote |
| `POST /api/orders` · `GET /api/orders` · `GET /api/orders/:id` · `POST /api/orders/:id/cancel` | client | Order, pay, track, cancel |
| `POST /api/stations` · `GET/PATCH /api/station` | station | Register and edit the station |
| `POST/PATCH/DELETE /api/station/products[/:id]` | station | Products, prices, stock |
| `PUT /api/station/payment-methods/:method` | station | Turn payment methods on/off with account details |
| `POST/PATCH /api/station/riders[/:id]` | station | Create and manage riders |
| `GET /api/station/orders` · `/stats` · `POST /api/orders/:id/accept`, `/reject`, `/confirm-transfer` | station | Handle orders |
| `GET /api/rider` · `/rider/jobs` · `POST /api/rider/status` | rider | Profile, jobs, online + location |
| `POST /api/orders/:id/take`, `/advance`, `/deliver` | rider | Delivery steps and code check |
| `GET /api/admin/stations` · `POST /api/admin/stations/:id/status` | admin | Approve or suspend stations |
| `POST /api/payments/callback/:provider` | provider | Payment webhooks |
| `GET /api/events?token=` | all | Live updates (Server-Sent Events) |
