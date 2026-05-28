import NodeID3 from 'node-id3'; // Requires bundling and nodejs_compat flag

/**
 * VergeLyrics Download Proxy Worker (dl-proxy)
 * 
 * This Cloudflare Worker proxies images and audio files for direct download.
 * It also uses 'node-id3' to inject the Album Art, Title, and Artist directly into the audio file.
 * 
 * Usage: 
 * https://your-worker.workers.dev/?url=<ENCODED_AUDIO_URL>&type=audio&title=<SONG_TITLE>&artist=<ARTIST_NAME>&cover=<ENCODED_COVER_URL>
 * 
 * IMPORTANT: To deploy this to Cloudflare Workers, you must:
 * 1. Install dependencies: npm install node-id3
 * 2. Enable node compatibility in your wrangler.toml: compatibility_flags = [ "nodejs_compat" ]
 * 3. Deploy using Wrangler: wrangler deploy
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    const type = url.searchParams.get('type') || 'unknown';
    const title = url.searchParams.get('title') || 'VergeLyrics Audio';
    const artist = url.searchParams.get('artist') || 'Unknown Artist';
    const coverUrl = url.searchParams.get('cover');

    if (!targetUrl) {
      return new Response('Missing "url" parameter', { status: 400 });
    }

    try {
      // 1. Fetch the target file
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        return new Response('Failed to fetch the requested file', { status: response.status });
      }

      const headers = new Headers(response.headers);
      headers.delete('Content-Security-Policy');
      headers.delete('X-Frame-Options');
      headers.set('Access-Control-Allow-Origin', '*');

      let filename = 'download';
      let bodyData = response.body;

      if (type === 'image') {
        filename = `${title.replace(/[^a-z0-9]/gi, '_')}_Cover.jpg`;
        headers.set('Content-Type', 'image/jpeg');
      } else if (type === 'audio') {
        filename = `${title.replace(/[^a-z0-9]/gi, '_')} - ${artist.replace(/[^a-z0-9]/gi, '_')}.mp3`;
        headers.set('Content-Type', 'audio/mpeg');
        
        // --- METADATA INJECTION (ID3 Tagging) ---
        // Convert the audio stream to a buffer
        const audioArrayBuffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(audioArrayBuffer);

        const tags = {
          title: title,
          artist: artist,
          album: 'VergeLyrics Downloads'
        };

        // If a cover URL is provided, fetch it and add it to the ID3 tags
        if (coverUrl) {
          try {
            const coverRes = await fetch(coverUrl);
            if (coverRes.ok) {
              const coverArrayBuffer = await coverRes.arrayBuffer();
              tags.image = {
                mime: "image/jpeg",
                type: { id: 3, name: "front cover" },
                description: "Cover Art",
                imageBuffer: Buffer.from(coverArrayBuffer)
              };
            }
          } catch (e) {
            console.error("Failed to fetch cover art for tagging", e);
          }
        }

        // Write the ID3 tags into the audio buffer
        const taggedBuffer = NodeID3.write(tags, audioBuffer);
        
        // Serve the newly tagged buffer instead of the raw stream
        bodyData = taggedBuffer;
        headers.set('Content-Length', taggedBuffer.length.toString());
      } else {
        const ext = targetUrl.split('.').pop().split('?')[0];
        filename = `download.${ext || 'bin'}`;
      }

      headers.set('Content-Disposition', `attachment; filename="${filename}"`);

      // 4. Return the proxied (and tagged) file
      return new Response(bodyData, {
        status: 200,
        headers: headers
      });

    } catch (error) {
      return new Response(`Proxy Error: ${error.message}`, { status: 500 });
    }
  }
};
