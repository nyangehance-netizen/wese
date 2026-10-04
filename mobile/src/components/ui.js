import { Pressable, Text, TextInput, View, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

export function H1({ children, style }) {
  const c = useTheme();
  return <Text style={[{ fontSize: 26, fontWeight: '800', color: c.ink }, style]}>{children}</Text>;
}
export function H2({ children, style }) {
  const c = useTheme();
  return <Text style={[{ fontSize: 18, fontWeight: '800', color: c.ink }, style]}>{children}</Text>;
}
export function T({ children, muted, small, bold, style, ...p }) {
  const c = useTheme();
  return <Text {...p} style={[{ color: muted ? c.muted : c.ink, fontSize: small ? 13 : 15, fontWeight: bold ? '700' : '400', lineHeight: small ? 18 : 21 }, style]}>{children}</Text>;
}
export function Label({ children }) {
  const c = useTheme();
  return <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>{children}</Text>;
}

export function Card({ children, style, highlight }) {
  const c = useTheme();
  return <View style={[{ backgroundColor: c.surface, borderColor: highlight ? c.accent : c.line, borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 }, style]}>{children}</View>;
}

export function Button({ title, onPress, kind = 'primary', disabled, loading, style }) {
  const c = useTheme();
  const bg = { primary: c.accent, brand: c.brand, plain: c.surface, danger: c.surface }[kind];
  const fg = { primary: c.accentInk, brand: c.onBrand, plain: c.ink, danger: c.bad }[kind];
  return (
    <Pressable
      accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [{ backgroundColor: bg, borderColor: kind === 'plain' || kind === 'danger' ? c.line : bg, borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, style, ...p }) {
  const c = useTheme();
  return (
    <View style={[{ gap: 6 }, style]}>
      <Text style={{ color: c.muted, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      <TextInput placeholderTextColor={c.muted} {...p}
        style={{ backgroundColor: c.sunk, borderColor: c.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: c.ink, fontSize: 16 }} />
    </View>
  );
}

/** Row of selectable options. options: [{ value, label, sub, disabled }] */
export function Choice({ options, value, onChange, wrap }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: wrap ? 'row' : 'column', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} disabled={o.disabled} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: o.disabled }}
            style={{ flexGrow: 1, minWidth: wrap ? 130 : undefined, borderWidth: 1, borderRadius: 12, padding: 12, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface, opacity: o.disabled ? 0.45 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: c.ink, fontWeight: '700', fontSize: 15, flexShrink: 1 }}>{o.label}</Text>
              {o.right ? <Text style={{ color: c.ink, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{o.right}</Text> : null}
            </View>
            {o.sub ? <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{o.sub}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Pill({ text, tone = 'plain' }) {
  const c = useTheme();
  const map = { ok: [c.okSoft, c.ok], warn: [c.warnSoft, c.warn], bad: [c.badSoft, c.bad], brand: [c.brandSoft, c.brand], plain: [c.sunk, c.muted] };
  const [bg, fg] = map[tone];
  return <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}><Text style={{ color: fg, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>{text}</Text></View>;
}

export function Row({ children, style }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, style]}>{children}</View>;
}
export function Line({ left, right, strong }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
      <Text style={{ color: strong ? c.ink : c.muted, fontWeight: strong ? '800' : '400', fontSize: strong ? 17 : 15 }}>{left}</Text>
      <Text style={{ color: c.ink, fontWeight: strong ? '800' : '600', fontSize: strong ? 17 : 15, fontVariant: ['tabular-nums'] }}>{right}</Text>
    </View>
  );
}
export function ErrorText({ children }) {
  const c = useTheme();
  return children ? <Text style={{ color: c.bad, fontSize: 14 }}>{children}</Text> : null;
}
export const s = StyleSheet.create({ gap16: { gap: 16 } });
