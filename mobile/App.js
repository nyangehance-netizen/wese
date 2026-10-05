import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { api, getToken, setToken, setOnUnauthorized, isDemo } from './src/api';
import { registerForPush, unregisterPush } from './src/push';
import { useTheme } from './src/theme';
import AuthScreen from './src/screens/AuthScreen';
import ClientApp from './src/screens/ClientApp';
import RiderHome from './src/screens/RiderHome';
import WrongAppScreen from './src/screens/WrongAppScreen';

export default function App() {
  const c = useTheme();
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setOnUnauthorized(() => setUser(null));
    (async () => {
      try { if (await getToken()) setUser(await api('GET', '/api/me')); } catch {}
      setBooting(false);
    })();
  }, []);

  // Turn on alerts once someone is signed in (client and rider accounts only).
  useEffect(() => {
    if (user && (user.role === 'client' || user.role === 'rider')) registerForPush(isDemo());
  }, [user?.id, user?.role]);

  const signOut = async () => { await unregisterPush(isDemo()); await setToken(null); setUser(null); };

  let screen;
  if (booting) screen = <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={c.brand} size="large" /></View>;
  else if (!user) screen = <AuthScreen onSignedIn={setUser} />;
  else if (user.role === 'client') screen = <ClientApp user={user} onSignOut={signOut} />;
  else if (user.role === 'rider') screen = <RiderHome user={user} onSignOut={signOut} />;
  else screen = <WrongAppScreen user={user} onSignOut={signOut} />;

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <View style={{ flex: 1, backgroundColor: c.bg }}>{screen}</View>
    </SafeAreaProvider>
  );
}
