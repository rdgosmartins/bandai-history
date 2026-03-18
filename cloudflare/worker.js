/**
 * Bandai TCG Plus — CORS Proxy Worker
 *
 * Forwards requests to https://api.bandai-tcg-plus.com, adding the CORS
 * headers that the original API omits.
 *
 * Deploy with:
 *   npx wrangler deploy
 */

const BANDAI_API_ORIGIN = 'https://api.bandai-tcg-plus.com';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authentication, X-Accept-Version, Accept',
};

export default {
    async fetch(request, env) {
        // Handle CORS pre-flight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);

        // Reject requests that don't start with /api/
        if (!url.pathname.startsWith('/api/')) {
            return new Response('Not found', { status: 404, headers: CORS_HEADERS });
        }

        // Build the target URL
        const targetUrl = `${BANDAI_API_ORIGIN}${url.pathname}${url.search}`;

        // Forward safe headers — strip Host and Origin so the API sees its own origin
        const forwardHeaders = new Headers();
        for (const [key, value] of request.headers.entries()) {
            const lower = key.toLowerCase();
            if (['host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor',
                 'x-forwarded-for', 'x-real-ip'].includes(lower)) continue;
            forwardHeaders.set(key, value);
        }
        // Spoof origin/referer so the Bandai API accepts the request
        forwardHeaders.set('Origin',  'https://www.bandai-tcg-plus.com');
        forwardHeaders.set('Referer', 'https://www.bandai-tcg-plus.com/');

        const proxyRequest = new Request(targetUrl, {
            method:  request.method,
            headers: forwardHeaders,
            body:    ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        });

        try {
            const response = await fetch(proxyRequest);

            // Rebuild response, injecting CORS headers
            const newHeaders = new Headers(response.headers);
            for (const [key, value] of Object.entries(CORS_HEADERS)) {
                newHeaders.set(key, value);
            }

            return new Response(response.body, {
                status:     response.status,
                statusText: response.statusText,
                headers:    newHeaders,
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status:  502,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
            });
        }
    },
};
