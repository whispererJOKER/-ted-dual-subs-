const H = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
(async () => {
  const base = "https://hls.ted.com/project_masters/1253/";
  const pl = await (await fetch(base + "index-f8-a1.m3u8?intro_master_id=9294", { headers: H })).text();
  console.log("--- playlist (head) ---");
  console.log(pl.slice(0, 700));
  const map = (pl.match(/EXT-X-MAP:URI="([^"]+)"/) || [])[1];
  console.log("EXT-X-MAP:", map);
  const seg = pl.split("\n").find(l => /\.(m4s|aac|ts|mp4|cmfv|cmfa)/i.test(l));
  console.log("firstSeg:", seg);
  if (seg) {
    const url = seg.startsWith("http") ? seg : base + seg;
    const buf = Buffer.from(await (await fetch(url, { headers: H })).arrayBuffer());
    const ascii = buf.slice(0, 16).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    console.log("seg bytes:", buf.length, "head:", ascii, "firstByte:", buf[0]);
  }
})();
