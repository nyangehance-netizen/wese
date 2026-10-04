import { useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, Switch, Text, View, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api, tzs, phoneFmt } from '../api';
import { useTheme } from '../theme';
import { H1, H2, T, Card, Button, Field, Pill, Label, ErrorText, Row } from '../components/ui';
import { TopBar } from '../components/Brand';
import TrackMap from '../components/TrackMap';

const NEXT = {
  assigned: ['Collected the fuel', 'Head to the station and load the fuel.'],
  picked_up: ['Start driving to client', 'Fuel loaded. Start the trip when you leave.'],
  on_the_way: ["I've arrived", 'Drive to the client. Tap when you reach the vehicle.'],
};
const mapsTo = (lat, lng) => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);

export default function RiderHome({ user, onSignOut }) {
  const c = useTheme();
  const [me, setMe] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [otp, setOtp] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const watcher = useRef(null);

  const load = async () => {
    try {
      const [r, j] = await Promise.all([api('GET', '/api/rider'), api('GET', '/api/rider/jobs')]);
      setMe(r); setJobs(j);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);

  // Share position while online so clients can see the rider approach.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      watcher.current?.remove(); watcher.current = null;
      if (!me?.online) return;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      watcher.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 25 },
        (p) => api('POST', '/api/rider/status', { lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => {}),
      );
    })();
    return () => { cancelled = true; watcher.current?.remove(); };
  }, [me?.online]);

  async function run(fn) { setErr(''); setBusy(true); try { await fn(); await load(); } catch (e) { setErr(e.message); } setBusy(false); }
  const setOnline = (online) => run(() => api('POST', '/api/rider/status', { online }));
  const take = (id) => run(() => api('POST', `/api/orders/${id}/take`));
  const advance = (id) => run(() => api('POST', `/api/orders/${id}/advance`));
  const deliver = (id) => run(async () => { await api('POST', `/api/orders/${id}/deliver`, { otp }); setOtp(''); });

  if (!me) return <SafeAreaView style={{ flex: 1, padding: 20 }}><T muted>{err || 'Loading…'}</T></SafeAreaView>;
  const cur = me.current;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <TopBar subtitle="Rider" right={
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Switch value={!!me.online} onValueChange={setOnline} disabled={busy || !!cur} trackColor={{ true: c.ok, false: c.line }} accessibilityLabel="Online" />
          <T small bold style={{ color: me.online ? c.ok : c.muted }}>{me.online ? 'Online' : 'Offline'}</T>
        </View>
      } />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />} keyboardShouldPersistTaps="handled">
          <View>
            <Label>{me.station.name}</Label>
            <H1>{me.name}</H1>
            <T muted small>{me.vehicle === 'tanker' ? 'Mini tanker' : 'Boda'} · {me.plate}</T>
          </View>

          <Row>
            <Card style={{ flex: 1 }}><Label>Trips today</Label><Text style={{ color: c.ink, fontSize: 22, fontWeight: '800' }}>{me.today.trips}</Text></Card>
            <Card style={{ flex: 1 }}><Label>Earned today</Label><Text style={{ color: c.ink, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{tzs(me.today.earned)}</Text></Card>
          </Row>

          <ErrorText>{err}</ErrorText>

          {cur && (
            <Card highlight>
              <Row style={{ justifyContent: 'space-between' }}><Label>Current job {cur.code}</Label><Pill text={cur.status_label} tone="brand" /></Row>
              <H2>{cur.litres} L {cur.product_name}</H2>
              <TrackMap
                station={{ lat: me.station.lat, lng: me.station.lng, label: me.station.name }}
                dest={{ lat: cur.lat, lng: cur.lng, label: cur.client_name }}
                rider={me.lat != null ? { lat: me.lat, lng: me.lng, label: 'You' } : null}
                target={cur.status === 'assigned' ? 'station' : 'client'}
                height={230}
              />
              {cur.status === 'assigned' ? (
                <>
                  <T>Pick up at <T bold>{me.station.name}</T></T>
                  <T muted small>{me.station.address}</T>
                  <Button title="Directions to station" kind="plain" onPress={() => mapsTo(me.station.lat, me.station.lng)} />
                </>
              ) : (
                <>
                  <T>Deliver to <T bold>{cur.client_name}</T> · {cur.vehicle_type} <T bold>{cur.plate}</T></T>
                  <T muted small>{cur.landmark || cur.address || 'Pinned location'} · {cur.distance_km} km from station</T>
                  <Row>
                    <Button title="Directions" kind="plain" onPress={() => mapsTo(cur.lat, cur.lng)} style={{ flex: 1 }} />
                    <Button title="Call client" kind="plain" onPress={() => Linking.openURL(`tel:+${cur.contact_phone}`)} style={{ flex: 1 }} />
                  </Row>
                  <T muted small>Client's number: {phoneFmt(cur.contact_phone)}</T>
                </>
              )}
              <T small>You earn <T small bold>{tzs(cur.rider_earning)}</T></T>

              {NEXT[cur.status] ? (
                <>
                  <T muted small>{NEXT[cur.status][1]}</T>
                  <Button title={NEXT[cur.status][0]} onPress={() => advance(cur.id)} loading={busy} />
                </>
              ) : (
                <>
                  <Field label="Client's 4-digit code" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="••••" maxLength={4} />
                  <T muted small>Fill the tank first, then ask the client for the code.</T>
                  {cur.demo_otp ? <T small bold style={{ color: c.warn }}>Demo: the client's code is {cur.demo_otp}</T> : null}
                  <Button title="Confirm delivery" onPress={() => deliver(cur.id)} loading={busy} disabled={otp.length !== 4} />
                </>
              )}
            </Card>
          )}

          <H2>Jobs from your station</H2>
          {!me.online ? <T muted>Go online to receive jobs.</T>
            : !jobs.length ? <T muted>No jobs right now. New jobs appear here when your station accepts an order.</T>
            : jobs.map((j) => (
              <Card key={j.id}>
                <Row style={{ justifyContent: 'space-between' }}><T bold>{j.litres} L {j.product_name}</T><T bold style={{ fontVariant: ['tabular-nums'] }}>{tzs(j.rider_earning)}</T></Row>
                <T muted small>{me.station.name} → {j.landmark || 'client location'} · {j.distance_km} km</T>
                <Button title={cur ? 'Finish your current job first' : 'Take this job'} kind="brand" onPress={() => take(j.id)} disabled={!!cur || busy} />
              </Card>
            ))}

          <Button title="Sign out" kind="plain" onPress={async () => { if (me.online) await api('POST', '/api/rider/status', { online: false }).catch(() => {}); onSignOut(); }} style={{ marginTop: 12 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
