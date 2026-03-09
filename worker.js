// ─────────────────────────────────────────────────────────────────────────────
// Artist Constellation — Cloudflare Worker
// Handles server-side API routes, then falls through to static assets.
// ─────────────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Anthropic-Key',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ── /api/media-suggest ──────────────────────────────────────────────────
    if (url.pathname === '/api/media-suggest' && request.method === 'POST') {
      const apiKey = env.ANTHROPIC_API_KEY || request.headers.get('X-Anthropic-Key');
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'no_key' }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      let artistName, genres;
      try {
        ({ artistName, genres } = await request.json());
      } catch {
        return new Response(JSON.stringify({ error: 'bad_request' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const genreClause = genres?.length ? ` who plays ${genres.slice(0, 4).join(', ')}` : '';
      const prompt = `For the music artist "${artistName}"${genreClause}, list 6–8 relevant magazines, websites, blogs, radio stations, or online communities where their fans engage with music coverage and discussion. Include a mix of mainstream press and niche/genre-specific outlets. Return ONLY a valid JSON array — no explanation, no markdown — in this exact shape: [{"name":"...","url":"https://...","type":"magazine|blog|community|editorial|radio|streaming","description":"one concise sentence"}]`;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        console.error('[media-suggest] Claude API error', claudeRes.status, errText);
        return new Response(JSON.stringify({ error: 'claude_error', status: claudeRes.status }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const claudeData = await claudeRes.json();
      const text = claudeData.content?.[0]?.text || '[]';
      const match = text.match(/\[[\s\S]*\]/);
      let outlets = [];
      try { outlets = match ? JSON.parse(match[0]) : []; } catch { outlets = []; }

      return new Response(JSON.stringify(outlets), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Static assets fallthrough ────────────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};
