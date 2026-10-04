import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View, RefreshControl } from 'react-native';
import { api, tzs, phoneFmt } from '../api';
import { useTheme } from '../theme';
import { H1, H2, T, Card, Button, Pill, Line, Label, ErrorText, Row } from '../components/ui';
import TrackMap from '../components/TrackMap';

const STEPS = [
  ['placed', 'Order placed'], ['accepted', 'Station confirmed'], ['assigned', 'Rider assigned'],
  ['picked_up', 'Fuel collected'], ['on_the_way', 'On the way'], ['arrived', 'Rider arrived'], ['delivered', 'Delivered'],
];
const ENDED = ['delivered', 'cancelled', 'rejected'];

function kmBetween(a, b) {
  const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.35;
}

export default function TrackScreen({ orderId, payment, onClose }) {
  const c = useTheme();
  const [o, setO] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => { try { setO(await api('GET', `/api/orders/${orderId}`)); setErr(''); } catch (e) { setErr(e.message); } };
  useEffect(() => {
    load();
    const t = setInterval(load, 3000); // live updates while this screen is open
    return () => clearInterval(t);
  }, [orderId]);

  if (!o) return <View style={{ padding: 20 }}><T muted>{err || 'Loading your order…'}</T></View>;

  const ended = ENDED.includes(o.status);
  const idx = STEPS.findIndex((s) => s[0] === o.status);
  const ref = payment?.reference || o.payment?.reference;
  const testMode = payment?.testMode || o.payment?.test_mode;

  async function run(fn) { setBusy(true); try { await fn(); await load(); } catch (e) { setErr(e.message); } setBusy(false); }
  const testPay = (result) => run(() => api('POST', `/api/payments/test/${ref}/${result}`));
  const cancel = () => run(() => api('POST', `/api/orders/${o.id}/cancel`, {}));

  const riderKm = o.rider?.lat ? kmBetween(o.rider, o).toFixed(1) : null;
  const toStation = o.status === 'assigned';
  const riderFirst = o.rider?.name?.split(' ')[0];
  const etaMin = riderKm ? Math.max(1, Math.round((Number(riderKm) / (o.delivery_method === 'tanker' ? 20 : 28)) * 60)) : null;
  const showMap = ['placed', 'accepted', 'assigned', 'picked_up', 'on_the_way', 'arrived'].includes(o.status) && o.station?.lat != null;
  const mapNote = o.status === 'placed' ? `Waiting for ${o.station.name} to accept.`
    : !o.rider ? `${o.station.name} is finding a rider.`
    : o.status === 'arrived' ? `${riderFirst} has arrived at your vehicle.`
    : toStation ? `${riderFirst} is collecting your fuel at ${o.station.name}.`
    : o.status === 'picked_up' ? `${riderFirst} has your fuel and is about to leave.`
    : riderKm ? `${riderFirst} is ${riderKm} km away · about ${etaMin} min` : `${riderFirst} is on the way.`;
  const headline = o.status === 'awaiting_payment' ? 'Approve the payment' : o.status === 'rejected' ? 'The station declined this order'
    : o.status === 'cancelled' ? 'Order cancelled' : o.status === 'delivered' ? 'Fuel delivered' : o.status_label;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Label>Order {o.code}</Label>
        <Pill text={o.status_label} tone={o.status === 'delivered' ? 'ok' : ended ? 'bad' : o.status === 'awaiting_payment' ? 'warn' : 'brand'} />
      </Row>
      <H1>{headline}</H1>

      {showMap && (
        <Card style={{ padding: 12, gap: 10 }}>
          <T bold>{mapNote}</T>
          <TrackMap
            station={{ lat: o.station.lat, lng: o.station.lng, label: o.station.name }}
            dest={{ lat: o.lat, lng: o.lng, label: 'You' }}
            rider={o.rider?.lat != null ? { lat: o.rider.lat, lng: o.rider.lng, label: riderKm && !toStation ? `${riderFirst} · ${riderKm} km` : riderFirst } : null}
            target={toStation ? 'station' : 'client'}
          />
          <T muted small>The map updates every few seconds.</T>
        </Card>
      )}

      {o.status === 'awaiting_payment' && (
        <Card highlight>
          <T>{payment?.instructions || `Check your phone for the ${o.payment_label} prompt and enter your PIN to pay ${tzs(o.total)}.`}</T>
          {testMode && ref && (
            <>
              <T muted small>Test mode: no real money moves. Choose what the payment does.</T>
              <Row><Button title="Approve payment" onPress={() => testPay('approve')} loading={busy} style={{ flex: 1 }} />
                <Button title="Decline" kind="danger" onPress={() => testPay('decline')} disabled={busy} style={{ flex: 1 }} /></Row>
            </>
          )}
        </Card>
      )}

      {o.payment_method === 'bank' && o.payment_status === 'pending' && (
        <Card highlight>
          <Label>Transfer to</Label>
          <Text style={{ color: c.ink, fontSize: 18, fontWeight: '800' }}>{o.bank_account}</Text>
          <T>Amount <T bold>{tzs(o.total)}</T> · Reference <T bold>{o.code}</T></T>
          <T muted small>The station starts once it confirms the money arrived.</T>
        </Card>
      )}

      {!ended && o.status !== 'awaiting_payment' && o.otp && (
        <Card>
          <Label>Your delivery code</Label>
          <Text style={{ fontSize: 40, fontWeight: '800', letterSpacing: 10, color: c.brand, fontVariant: ['tabular-nums'] }}>{o.otp}</Text>
          <T muted small>Give this code to the rider only after the fuel is in your tank.</T>
        </Card>
      )}

      {!ended && o.status !== 'awaiting_payment' && (
        <Card>
          {STEPS.map(([k, label], i) => {
            const done = i < idx, now = i === idx;
            return (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: done ? c.ok : now ? c.accent : c.line, backgroundColor: done ? c.ok : now ? c.accentSoft : c.surface }} />
                <T bold={now} muted={!done && !now}>{label}</T>
              </View>
            );
          })}
        </Card>
      )}

      {o.rider && !ended && (
        <Card>
          <H2>{o.rider.name}</H2>
          <T muted>{o.rider.vehicle === 'tanker' ? 'Mini tanker' : 'Boda'} · {o.rider.plate}{riderKm ? ` · about ${riderKm} km away` : ''}</T>
          <Button title="Call rider" kind="brand" onPress={() => Linking.openURL(`tel:+${o.rider.phone}`)} />
          <T muted small>Rider's number: {phoneFmt(o.rider.phone)}</T>
        </Card>
      )}

      <Card>
        <T muted small>{o.station.name} · {o.litres} L {o.product_name} · {o.plate}</T>
        <Line left="Fuel" right={tzs(o.fuel_cost)} />
        <Line left="Delivery" right={tzs(o.delivery_fee)} />
        <Line left="Service fee" right={tzs(o.service_fee)} />
        <Line strong left="Total" right={tzs(o.total)} />
        <T muted small>Paid with {o.payment_label} · {o.payment_status}</T>
        {o.cancel_reason ? <T muted small>Reason: {o.cancel_reason}</T> : null}
        {ended && o.payment_status === 'refunded' ? <T small>Your money was refunded to the same account.</T> : null}
      </Card>

      <ErrorText>{err}</ErrorText>
      {['awaiting_payment', 'placed'].includes(o.status) && <Button title="Cancel order" kind="danger" onPress={cancel} disabled={busy} />}
      {ended && <Button title={o.status === 'delivered' ? 'Done' : 'Order again'} onPress={onClose} />}
    </ScrollView>
  );
}
