// Notifications on the phone.
// - Real accounts: the phone registers an Expo push token with the Wese server, which then
//   sends alerts even when the app is closed. Needs an Expo project ID (and, on Android,
//   Firebase credentials uploaded to Expo); without them the app simply skips registration.
// - Demo mode: alerts are shown locally by the phone as the simulated order moves.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { setDemoNotifier } from './demo';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let channelReady = false;
async function ensureChannel() {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('orders', {
    name: 'Order updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#E8931A',
  });
  channelReady = true;
}

async function askPermission() {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

const projectId = () =>
  Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? null;

let registered = null;
/** Ask for permission and tell the server where to send this user's alerts. */
export async function registerForPush(isDemo) {
  try {
    if (!(await askPermission())) return { ok: false, reason: 'Notifications are switched off for Wese in phone settings.' };
    if (isDemo) {
      setDemoNotifier(showLocal);
      return { ok: true, local: true };
    }
    const id = projectId();
    if (!id) return { ok: false, reason: 'Push service not set up in this build.' };
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    await api('PUT', '/api/me/push-token', { token });
    registered = token;
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Stop alerts for this phone (called on sign-out, while still signed in). */
export async function unregisterPush(isDemo) {
  setDemoNotifier(null);
  if (isDemo || !registered) return;
  try { await api('PUT', '/api/me/push-token', { token: null }); } catch {}
  registered = null;
}

export async function showLocal(title, body) {
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({ content: { title, body, sound: true }, trigger: Platform.OS === 'android' ? { channelId: 'orders' } : null });
}
