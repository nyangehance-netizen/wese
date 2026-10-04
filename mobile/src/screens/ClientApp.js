import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { useTheme } from '../theme';
import OrderScreen from './OrderScreen';
import TrackScreen from './TrackScreen';
import HistoryScreen from './HistoryScreen';
import { TopBar } from '../components/Brand';

const ENDED = ['delivered', 'cancelled', 'rejected'];

export default function ClientApp({ user, onSignOut }) {
  const c = useTheme();
  const [tab, setTab] = useState('order');
  const [active, setActive] = useState(null); // { id, payment }

  const findActive = useCallback(async () => {
    try {
      const orders = await api('GET', '/api/orders');
      const a = orders.find((o) => !ENDED.includes(o.status));
      if (a) setActive((cur) => (cur?.id === a.id ? cur : { id: a.id }));
    } catch {}
  }, []);
  useEffect(() => { findActive(); }, [findActive]);

  let body;
  if (tab === 'order' && active) body = <TrackScreen orderId={active.id} payment={active.payment} onClose={() => setActive(null)} />;
  else if (tab === 'order') body = <OrderScreen user={user} onPlaced={(order, payment) => setActive({ id: order.id, payment })} />;
  else body = <HistoryScreen user={user} onSignOut={onSignOut} onOpen={(id) => { setActive({ id }); setTab('order'); }} />;

  const tabs = [['order', active ? 'Current order' : 'Order fuel'], ['history', 'My orders']];
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <TopBar subtitle={`Hi, ${user.name.split(' ')[0]}`} />
      <View style={{ flex: 1 }}>{body}</View>
      <SafeAreaView edges={['bottom']} style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
        {tabs.map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}
            style={{ flex: 1, paddingVertical: 14, alignItems: 'center', borderTopWidth: 3, borderColor: tab === k ? c.accent : 'transparent' }}>
            <Text style={{ color: tab === k ? c.ink : c.muted, fontWeight: '700' }}>{label}</Text>
          </Pressable>
        ))}
      </SafeAreaView>
    </SafeAreaView>
  );
}
