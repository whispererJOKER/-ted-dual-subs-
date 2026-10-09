const H = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "accept-language": "en-US,en;q=0.9" };
(async () => {
  const vid = process.argv[2] || "jNQXAC9IVRw";
  const res = await fetch("https://www.youtube.com/watch?v=" + vid, { headers: H });
  const html = await res.text();
  console.log("watch status", res.status, "len", html.length);
  const m = html.match(/"captionTracks":(\[.*?\])/s);
  if (!m) { console.log("no captionTracks found"); return; }
  let tracks;
  try { tracks = JSON.parse(m[1]); } catch (e) { console.log("parse fail", e.message); return; }
  console.log("tracks:", tracks.map(t => (t.languageCode + (t.kind ? "/" + t.kind : ""))).join(", "));
  const en = tracks.find(t => /^en/i.test(t.languageCode)) || tracks[0];
  console.log("pick en:", en.languageCode, "kind=", en.kind || "-");
  const base = en.baseUrl.replace(/\\u0026/g, "&");
  const j3 = await (await fetch(base + "&fmt=json3", { headers: H })).json();
  const evs = (j3.events || []).filter(e => e.segs);
  console.log("en json3 events:", evs.length, "| first:", JSON.stringify(evs.slice(0,3).map(e => ({t:e.tStartMs,d:e.dDurationMs,s:e.segs.map(x=>x.utf8).join("")}))));
  const zh = await fetch(base + "&fmt=json3&tlang=zh-Hans", { headers: H });
  const zj = await zh.json();
  const zev = (zj.events || []).filter(e => e.segs);
  console.log("zh(tlang) status", zh.status, "events:", zev.length, "| first:", JSON.stringify(zev.slice(0,2).map(e => e.segs.map(x=>x.utf8).join(""))));
})();
