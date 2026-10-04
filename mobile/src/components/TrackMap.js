// Live delivery map: OpenStreetMap tiles drawn with Leaflet inside a WebView.
// Works on Android and iOS with no map API key. Leaflet is bundled; only map tiles need internet.
// Positions update in place (no reload).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../theme';
import { LEAFLET_CSS, LEAFLET_JS } from './leafletAssets';

const HTML = (initial) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>${LEAFLET_CSS}</style>
<script>${LEAFLET_JS}</script>
<style>
  html,body,#map{margin:0;height:100%;background:#E9EEEC;font:13px -apple-system,Roboto,sans-serif}
  .pin{display:flex;align-items:center;justify-content:center;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff}
  .st{width:34px;height:34px;background:#0E5A50}
  .me{width:30px;height:30px;border-radius:50%;background:#E8931A}
  .rd{width:34px;height:34px;border-radius:50%;background:#15211E;position:relative}
  .rd:after{content:"";position:absolute;inset:-8px;border-radius:50%;border:3px solid #E8931A;opacity:.6;animation:p 1.6s ease-out infinite}
  @keyframes p{from{transform:scale(.6);opacity:.8}to{transform:scale(1.4);opacity:0}}
  .tag{position:absolute;top:100%;left:50%;transform:translate(-50%,4px);white-space:nowrap;background:#fff;color:#15211E;font-weight:700;font-size:11px;padding:2px 6px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.3)}
  #off{display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;padding:20px;color:#596A66}
</style></head><body><div id="map"></div><div id="off">The map could not start.</div>
<script>
var FUEL='<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#E8931A" d="M6 3h7a2 2 0 0 1 2 2v14h1v2H4v-2h1V5a1 1 0 0 1 1-2zm1 2v5h6V5H7zm10.5 1.5 2.3 2.3c.1.1.2.3.2.5V16a2 2 0 0 1-4 0v-3h-1v-2h1.5c.3 0 .5.2.5.5V16h1V9.8l-1.9-1.9z"/></svg>';
var CAR='<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#2E1D00" d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11v7h-2v-2H7v2H5zm2.2-1h9.6l-1-3H8.2zM7.5 14a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zm9 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z"/></svg>';
var BIKE='<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M5 18a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-1.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8zM19 18a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-1.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8zM12.5 6H15l2 5h-1.4l-.7-1.6L12 13.5V16H10v-3l2.6-3.2-.7-1.8H9.5V6h3z"/></svg>';
function icon(cls, svg, label){return L.divIcon({className:'',iconSize:[34,34],iconAnchor:[17,17],html:'<div class="pin '+cls+'">'+svg+(label?'<span class="tag">'+label+'</span>':'')+'</div>'});}
var map, st, me, rd, line, touched=false, last=null;
function boot(){
  if(typeof L==='undefined'){document.getElementById('off').style.display='flex';return;}
  map=L.map('map',{zoomControl:false,attributionControl:true});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  // Once the person pans or zooms, stop auto-fitting until they tap Recenter.
  map.on('dragstart',function(){ touched=true; });
  map.on('zoomstart',function(){ if(!map._wese) touched=true; });
  update(${JSON.stringify(initial)});
}
function update(d){
  last=d; if(!map) return;
  function place(m,p,ic){ if(!p) {if(m) map.removeLayer(m); return null;} if(!m) return L.marker([p.lat,p.lng],{icon:ic}).addTo(map); m.setLatLng([p.lat,p.lng]); m.setIcon(ic); return m; }
  st=place(st,d.station,icon('st',FUEL,d.station&&d.station.label));
  me=place(me,d.dest,icon('me',CAR,d.dest&&d.dest.label));
  rd=place(rd,d.rider,icon('rd',BIKE,d.rider&&d.rider.label));
  if(rd) rd.setZIndexOffset(1000);
  var from=d.rider||d.station, to=d.target==='station'?d.station:d.dest;
  var pts=from&&to?[[from.lat,from.lng],[to.lat,to.lng]]:[];
  if(line) map.removeLayer(line);
  line=pts.length?L.polyline(pts,{color:'#0E5A50',weight:4,dashArray:'8 8',opacity:.8}).addTo(map):null;
  if(!touched) fit();
}
function fit(){
  var b=[last.station,last.dest,last.rider].filter(Boolean).map(function(p){return [p.lat,p.lng];});
  if(!b.length) return;
  map._wese=true;
  if(b.length===1) map.setView(b[0],15); else map.fitBounds(b,{padding:[48,48],maxZoom:16});
  setTimeout(function(){map._wese=false;},400);
}
function recenter(){touched=false; if(last) fit();}
window.update=update; window.recenter=recenter;
window.addEventListener('load',boot);
</script></body></html>`;

/**
 * station: {lat,lng,label}  dest: {lat,lng,label}  rider: {lat,lng,label} | null
 * target: 'station' while the rider heads to collect fuel, otherwise 'client'.
 */
export default function TrackMap({ station, dest, rider, target = 'client', height = 260 }) {
  const c = useTheme();
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const data = { station, dest, rider: rider && rider.lat != null ? rider : null, target };
  const key = JSON.stringify(data);
  // Build the page once; later changes are pushed in with update().
  const html = useMemo(() => HTML(data), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.update && window.update(${key}); true;`);
  }, [key, ready]);

  return (
    <View style={{ height, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: c.line, backgroundColor: c.sunk }}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://wese.app/' }}
        onLoadEnd={() => setReady(true)}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        style={{ backgroundColor: 'transparent' }}
      />
      <Text
        onPress={() => ref.current?.injectJavaScript('window.recenter && window.recenter(); true;')}
        accessibilityRole="button"
        style={{ position: 'absolute', right: 10, top: 10, backgroundColor: c.surface, color: c.ink, fontWeight: '700', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: c.line }}
      >
        Recenter
      </Text>
    </View>
  );
}
