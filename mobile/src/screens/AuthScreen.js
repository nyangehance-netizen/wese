import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, setToken, getApiUrl, setApiUrl, checkServer } from '../api';
import { Card } from '../components/ui';
import { Brand } from '../components/Brand';

function ServerSettings() {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { getApiUrl().then(setUrl); }, []);

  async function save() {
    setBusy(true); setMsg('');
    const saved = await setApiUrl(url);
    setUrl(saved);
    setMsg((await checkServer(saved)) ? '✓ Connected to the Wese server.' : 'Saved, but the server did not answer. Check the address and that the server is running.');
    setBusy(false);
  }

  return (
    <View style={{ gap: 10 }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button">
        <T small muted style={{ textAlign: 'center' }}>Server settings {open ? '▲' : '▼'}</T>
      </Pressable>
      {open && (
        <Card>
          <Field label="Server address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.20:4000" />
          <T small muted>Use the address shown when you start the backend, e.g. http://192.168.1.20:4000 on the same Wi-Fi, or an https:// tunnel address.</T>
          {msg ? <T small style={{ color: msg.startsWith('✓') ? c.ok : c.bad }}>{msg}</T> : null}
          <Button title="Save and test" kind="brand" onPress={save} loading={busy} />
        </Card>
      )}
    </View>
  );
}
import { useTheme } from '../theme';
import { H1, T, Button, Field, ErrorText } from '../components/ui';

export default function AuthScreen({ onSignedIn }) {
  const c = useTheme();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reg = mode === 'register';

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const r = await api('POST', `/api/auth/${reg ? 'register' : 'login'}`, { name, phone, password, role: 'client' });
      await setToken(r.token);
      onSignedIn(r.user);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <Brand size="large" subtitle="Fuel delivered where you stopped" />
          <View style={{ gap: 6 }}>
            <H1>{reg ? 'Create your account' : 'Out of fuel? We bring it.'}</H1>
            <T muted>{reg ? 'Order fuel to wherever your vehicle stopped.' : 'Sign in to order fuel. Riders sign in here with the account their station made.'}</T>
          </View>
          {reg && <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />}
          <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0754 123 456" autoComplete="tel" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={reg ? 'new-password' : 'current-password'} />
          <ErrorText>{err}</ErrorText>
          <Button title={reg ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} />
          <Pressable onPress={() => { setMode(reg ? 'login' : 'register'); setErr(''); }} accessibilityRole="button">
            <T style={{ color: c.brand, fontWeight: '700', textAlign: 'center' }}>{reg ? 'I already have an account' : 'New to Wese? Create an account'}</T>
          </Pressable>
          <ServerSettings />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
