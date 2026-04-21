const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { shell } = require("electron");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// Read + write for events (语音创建日程), plus calendarList for listing calendars.
const CALENDAR_SCOPE =
  "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const OAUTH_TIMEOUT_MS = 120000;

function renderHtml(status, message) {
  const ok = status === "success";
  const bg = ok ? "#10b981" : "#ef4444";
  const title = ok ? "Google Calendar Connected" : "Connection Failed";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:#0b0b0d; color:#e5e5e5; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { max-width:420px; padding:32px; border-radius:16px; background:#18181b; border:1px solid #27272a; text-align:center; }
  .dot { width:56px; height:56px; border-radius:50%; background:${bg}; margin:0 auto 16px; display:flex; align-items:center; justify-content:center; font-size:28px; color:white; }
  h1 { font-size:18px; margin:0 0 8px; }
  p { font-size:13px; color:#a1a1aa; line-height:1.6; margin:0; }
</style>
</head>
<body>
  <div class="card">
    <div class="dot">${ok ? "✓" : "✕"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p style="margin-top:16px;font-size:12px;color:#71717a;">You can close this tab.</p>
  </div>
</body>
</html>`;
}

class GoogleCalendarOAuth {
  constructor(databaseManager) {
    this.databaseManager = databaseManager;
  }

  getClientId() {
    return process.env.GOOGLE_CALENDAR_CLIENT_ID;
  }

  getClientSecret() {
    return process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  }

  _respondSuccess(res, email) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderHtml("success", `Signed in as <b>${email}</b>.`));
  }

  _respondError(res, errorCode) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderHtml("error", `OAuth error: ${errorCode}. Please try again.`));
  }

  startOAuthFlow() {
    return new Promise((resolve, reject) => {
      const codeVerifier = crypto.randomBytes(32).toString("base64url").slice(0, 43);
      const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
      const state = crypto.randomBytes(32).toString("hex");

      const server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url, `http://127.0.0.1`);
          const returnedState = url.searchParams.get("state");
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            this._respondError(res, error);
            cleanup();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (!code || returnedState !== state) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("<html><body><h3>Invalid request.</h3></body></html>");
            return;
          }

          const redirectUri = `http://127.0.0.1:${server.address().port}`;
          const tokenData = await this.exchangeCodeForTokens(code, redirectUri, codeVerifier);

          if (tokenData.error) {
            this._respondError(res, "token_exchange_failed");
            cleanup();
            reject(
              new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error}`)
            );
            return;
          }

          let email = null;
          if (tokenData.id_token) {
            try {
              const payload = JSON.parse(
                Buffer.from(tokenData.id_token.split(".")[1], "base64url").toString()
              );
              email = payload.email;
            } catch {}
          }

          if (!email) {
            this._respondError(res, "no_email");
            cleanup();
            reject(new Error("Could not extract email from Google OAuth response"));
            return;
          }

          const expiresAt = Date.now() + tokenData.expires_in * 1000;
          this.databaseManager.saveGoogleTokens({
            google_email: email,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: expiresAt,
            scope: tokenData.scope || CALENDAR_SCOPE,
          });

          this._respondSuccess(res, email);
          cleanup();
          resolve({ success: true, email });
        } catch (err) {
          this._respondError(res, "server_error");
          cleanup();
          reject(err);
        }
      });

      let timeoutId;

      const cleanup = () => {
        clearTimeout(timeoutId);
        server.close();
      };

      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}`;

        const params = new URLSearchParams({
          client_id: this.getClientId(),
          redirect_uri: redirectUri,
          response_type: "code",
          scope: CALENDAR_SCOPE,
          access_type: "offline",
          prompt: "consent",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });

        shell.openExternal(`${GOOGLE_AUTH_URL}?${params.toString()}`);
      });

      timeoutId = setTimeout(() => {
        server.close();
        reject(new Error("OAuth flow timed out"));
      }, OAUTH_TIMEOUT_MS);

      server.on("error", (err) => {
        cleanup();
        reject(err);
      });
    });
  }

  async exchangeCodeForTokens(code, redirectUri, codeVerifier) {
    const body = new URLSearchParams({
      code,
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }).toString();

    return this._httpsPost(GOOGLE_TOKEN_URL, body);
  }

  async refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
      client_id: this.getClientId(),
      client_secret: this.getClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString();

    return this._httpsPost(GOOGLE_TOKEN_URL, body);
  }

  async getValidAccessToken(accountEmail = null) {
    const tokens = accountEmail
      ? this.databaseManager.getGoogleTokensByEmail(accountEmail)
      : this.databaseManager.getGoogleTokens();
    if (!tokens)
      throw new Error(`No Google tokens found${accountEmail ? ` for ${accountEmail}` : ""}`);

    const fiveMinutes = 5 * 60 * 1000;
    if (tokens.expires_at - fiveMinutes < Date.now()) {
      const refreshed = await this.refreshAccessToken(tokens.refresh_token);
      if (refreshed.error) {
        throw new Error(`Token refresh failed: ${refreshed.error_description || refreshed.error}`);
      }

      const newExpiresAt = Date.now() + refreshed.expires_in * 1000;
      this.databaseManager.saveGoogleTokens({
        google_email: tokens.google_email,
        access_token: refreshed.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: newExpiresAt,
        scope: tokens.scope,
      });

      return refreshed.access_token;
    }

    return tokens.access_token;
  }

  async revokeToken(token) {
    const body = new URLSearchParams({ token }).toString();
    try {
      await this._httpsPost("https://oauth2.googleapis.com/revoke", body);
    } catch {
      // Best-effort — token may already be revoked or network unavailable
    }
  }

  _httpsPost(urlString, body) {
    const url = new URL(urlString);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = GoogleCalendarOAuth;
