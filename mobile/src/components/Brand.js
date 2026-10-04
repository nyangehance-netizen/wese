import { Image, Text, View } from 'react-native';
import { useTheme } from '../theme';

const MARK = require('../../assets/mark.png');

/** Fuel pump mark + Wese name. size: 'large' on sign-in, 'small' in the top bar. */
export function Brand({ size = 'small', subtitle }) {
  const c = useTheme();
  const big = size === 'large';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: big ? 14 : 10 }} accessibilityRole="header" accessibilityLabel="Wese">
      <Image source={MARK} style={{ width: big ? 64 : 36, height: big ? 64 : 36 }} />
      <View>
        <Text style={{ color: c.ink, fontSize: big ? 34 : 22, fontWeight: '800', letterSpacing: -0.5 }}>Wese</Text>
        {subtitle ? <Text style={{ color: c.muted, fontSize: big ? 14 : 12 }}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

/** Bar shown at the top of every signed-in screen. */
export function TopBar({ subtitle, right }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.line }}>
      <Brand subtitle={subtitle} />
      {right}
    </View>
  );
}
