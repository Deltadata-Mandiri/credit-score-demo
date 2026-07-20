// Local-dev default: server.js serves the UI and /api/* from the same origin,
// so no base URL is needed. The Amplify build overwrites this file with the
// deployed Lambda Function URL (see amplify.yml).
window.APP_CONFIG = { apiBase: '' };
