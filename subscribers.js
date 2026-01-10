function extractVideoId(input) {
    // Supports:
    // - https://www.youtube.com/watch?v=VIDEOID
    // - https://youtu.be/VIDEOID
    // - https://www.youtube.com/shorts/VIDEOID
    try {
      const u = new URL(input);
      const host = u.hostname.replace(/^www\./, "");
  
      if (host === "youtu.be") {
        const id = u.pathname.split("/").filter(Boolean)[0];
        return id || null;
      }
  
      if (host.endsWith("youtube.com")) {
        if (u.pathname === "/watch") return u.searchParams.get("v");
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts[0] === "shorts" && parts[1]) return parts[1];
        if (parts[0] === "live" && parts[1]) return parts[1];
      }
    } catch (_) {
      // not a URL
    }
    return null;
  }
  
  function extractChannelIdFromChannelUrl(input) {
    // https://www.youtube.com/channel/UCxxxx
    const m = input.match(/\/channel\/(UC[a-zA-Z0-9_-]{20,})/);
    return m?.[1] || null;
  }
  
  function extractHandle(input) {
    // https://www.youtube.com/@handle  OR  @handle
    if (input.startsWith("@")) return input.slice(1).trim();
    const m = input.match(/youtube\.com\/@([a-zA-Z0-9._-]+)/i);
    return m?.[1] || null;
  }
  
  async function ytFetch(url) {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) {
      const msg = j?.error?.message || "YouTube API error";
      throw new Error(msg);
    }
    return j;
  }
  
  export default async function handler(req, res) {
    try {
      const q = (req.query.q || "").toString().trim();
      if (!q) return res.status(400).json({ error: "Missing query q" });
  
      const apiKey = process.env.YT_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Missing YT_API_KEY in server env variables" });
  
      let channelId = null;
  
      // 1) If user pasted a direct channel URL with /channel/UC...
      channelId = extractChannelIdFromChannelUrl(q);
  
      // 2) If user pasted a video URL, resolve video -> channelId
      if (!channelId) {
        const vid = extractVideoId(q);
        if (vid) {
          const vUrl =
            `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(vid)}&key=${apiKey}`;
          const vj = await ytFetch(vUrl);
          channelId = vj.items?.[0]?.snippet?.channelId || null;
          if (!channelId) return res.status(404).json({ error: "Could not resolve channel from that video link." });
        }
      }
  
      // 3) If handle exists, prefer searching by handle text
      let searchText = q;
      const handle = extractHandle(q);
      if (handle) searchText = handle;
  
      // 4) If still no channelId, use search endpoint (best-effort)
      if (!channelId) {
        const sUrl =
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(searchText)}&key=${apiKey}`;
        const sj = await ytFetch(sUrl);
        const item = sj.items?.[0];
        channelId = item?.snippet?.channelId || null;
  
        if (!channelId) {
          return res.status(404).json({ error: "Channel not found. Try another name or paste a channel/video URL." });
        }
      }
  
      // 5) Fetch channel statistics + snippet
      const cUrl =
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}&key=${apiKey}`;
      const cj = await ytFetch(cUrl);
      const ch = cj.items?.[0];
  
      if (!ch) return res.status(404).json({ error: "Channel not found by ID." });
  
      const subs = ch.statistics?.subscriberCount ?? "Hidden";
      const title = ch.snippet?.title || "Channel";
      const thumbnail =
        ch.snippet?.thumbnails?.default?.url ||
        ch.snippet?.thumbnails?.medium?.url ||
        ch.snippet?.thumbnails?.high?.url ||
        null;
  
      // Helps reduce quota usage (CDN cache on Vercel)
      res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
  
      return res.status(200).json({
        title,
        subscribers: subs,
        thumbnail,
        channelUrl: `https://www.youtube.com/channel/${channelId}`
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Unexpected error" });
    }
  }
  