/**
 * ============================================================
 * AUTH PROCESSOR
 * ============================================================
 * Handles OAuth token generation and caching.
 * Prevents token storms under high load by caching
 * tokens per clientId across all virtual users.
 */

const https = require('https');

/**
 * In-memory token cache shared across VUs.
 * Structure:
 * {
 *   clientId: {
 *     token: string,
 *     generatedAt: epochSeconds
 *   }
 * }
 */
const tokenCache = {};

/**
 * Fetches or reuses an OAuth access token.
 */
function getAuthToken(requestParams, context, ee, next) {
  const { clientId, clientSecret } = context.vars;

  if (!clientId || !clientSecret) {
    return next(new Error('Missing OAuth credentials'));
  }

  const now = Math.floor(Date.now() / 1000);
  const TOKEN_TTL = 300;       // Cognito default
  const RENEW_BUFFER = 60;     // Renew 1 min early

  // Reuse cached token if still valid
  if (tokenCache[clientId]) {
    const cached = tokenCache[clientId];
    if ((now - cached.generatedAt) < (TOKEN_TTL - RENEW_BUFFER)) {
      context.vars.accessToken = cached.token;
      return next();
    }
  }

  // Request new token
  const postData =
    `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}`;

  const options = {
    hostname: 'us-east-2dol8jtcrd.auth.us-east-2.amazoncognito.com',
    path: '/oauth2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = https.request(options, res => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      if (res.statusCode === 200) {
        const parsed = JSON.parse(body);
        tokenCache[clientId] = {
          token: parsed.access_token,
          generatedAt: now
        };
        context.vars.accessToken = parsed.access_token;
        next();
      } else {
        next(new Error(`Auth failed: ${res.statusCode}`));
      }
    });
  });

  req.on('error', next);
  req.write(postData);
  req.end();
}

module.exports = { getAuthToken };
