// One-off helper: fetch the real Edge Read Aloud voices list and print zh-*.
const https = require("https");
const URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
https
  .get(URL, (res) => {
    let buf = "";
    res.on("data", (c) => (buf += c));
    res.on("end", () => {
      try {
        const list = JSON.parse(buf);
        const zh = list.filter((x) => (x.Locale || "").startsWith("zh-"));
        for (const v of zh) {
          console.log(`${v.ShortName} | ${v.FriendlyName || v.LocalName || ""} | ${v.Gender}`);
        }
      } catch (e) {
        console.error("parse failed:", e.message, buf.slice(0, 300));
      }
    });
  })
  .on("error", (e) => console.error("fetch failed:", e.message));
