# Install Wese on your phone for preview

> **Quickest way to look around:** install the APK (Step 2A) and tap **As a client** or **As a rider** under **Try the demo** on the sign-in screen. Demo mode runs entirely on the phone with sample stations, prices and a simulated station and rider, so no server or account is needed. Sign out to leave demo mode.

You need two things: the **server** running somewhere your phone can reach, and the **app** on your phone.

## Step 1 — Start the server on your computer

Install Node.js 22 or newer from nodejs.org, then:

```bash
cd wese/backend
npm run seed      # first time only: demo stations, riders and accounts
npm start
```

It prints a line like:

```
Server address for phones on the same Wi-Fi:  http://192.168.1.20:4000
```

Keep this window open. Your phone must be on the **same Wi-Fi** as the computer.

> **Phone on mobile data, or a different network?** Make a public HTTPS address with a free tunnel:
> install `cloudflared` (developers.cloudflare.com), run `cloudflared tunnel --url http://localhost:4000`
> and use the `https://….trycloudflare.com` address it prints. It changes each time you run it;
> you just update it in the app's Server settings.

## Step 2A — Android: get the APK from GitHub (easiest)

This project includes a GitHub Actions workflow (`.github/workflows/android-apk.yml`). Every push to `main` that changes the app builds a fresh APK on GitHub's servers (about 15–25 minutes) and publishes it as the **wese-preview** release.

1. On your phone, open `https://github.com/nyangehance-netizen/wese/releases/tag/wese-preview` (sign in to GitHub on your phone first, since the repository is private).
2. Tap **wese-preview.apk** to download, then open it to install (allow "Install unknown apps" if asked).
3. Open **Wese** → **Server settings** → enter your server address → **Save and test**.

To rebuild without changing code: repository → **Actions** → **Android APK** → **Run workflow**.
Optional: set a repository variable `API_URL` (Settings → Secrets and variables → Actions → Variables) to bake in a default server address.

## Step 2A (alternative) — Android APK with Expo's build service

Builds run on Expo's servers, so you don't need Android Studio. A free Expo account is enough.

```bash
cd wese/mobile
npm run setup                 # installs everything with matching versions
npm install -g eas-cli
eas login                     # create a free account at expo.dev if you don't have one
eas build -p android --profile preview
```

The first time, answer **Yes** when it asks to create a project and generate a keystore. When the build finishes (about 10–20 minutes), it shows a link and a QR code.

1. Open the link on your Android phone and download the APK.
2. Tap it to install. If Android asks, allow installing apps from your browser ("Install unknown apps").
3. Open **Wese** → tap **Server settings** at the bottom of the sign-in screen → enter the server address from Step 1 → **Save and test**.
4. Sign in with a demo account (password `wese1234`): client **0754 123 456**, rider **0754 000 011**.

You can send the same APK link to other Android phones, e.g. one for a client and one for a rider.

## Step 2B — iPhone: preview with Expo Go

Apple only allows installing a standalone app through TestFlight or the App Store, which needs an Apple Developer account (99 USD per year). For a free preview, use **Expo Go**:

```bash
cd wese/mobile
npm run setup
npx expo start
```

Scan the QR code with the iPhone camera. It opens the app in Expo Go. Then set the server address in **Server settings** as in step 3 above.

The project uses Expo SDK 56. If Expo Go says the project's SDK isn't supported, follow the instructions it shows. Expo's SDK 56 notes say its Expo Go for iOS is offered through TestFlight or the `eas go` command rather than the App Store.

When you're ready to put it on iPhones properly: join the Apple Developer Program, then run `eas build -p ios --profile production` and `eas submit -p ios` to send it to TestFlight.

## Try the whole flow

1. Computer: open `http://localhost:4000`, sign in as station **0713 000 001** / `wese1234`.
2. Phone 1 (client): order 10 L of petrol from Mwenge Energies. Payment approves itself after 5 seconds (test mode).
3. Computer: tap **Accept & send to riders**.
4. Phone 2 (rider **0754 000 011**): go online → **Take this job** → follow the steps → enter the client's 4-digit code.

Only one phone? Sign out and sign back in as the other role.
