// Proxy credentials template for a DEVELOPMENT checkout — copy to
// electron/proxy-config.js and fill in:
//
//   cp electron/proxy-config.example.js electron/proxy-config.js
//
// electron/proxy-config.js is gitignored, so real proxy credentials never
// reach the repository or its history.
//
// A PACKAGED build reads its config from the user's data directory instead:
// the application bundle is read-only, so the file has to live outside it.
// The loader (proxy.js) looks there FIRST and only then falls back to the file
// in this repository. Copy proxy-config.example.json to:
//
//   macOS   ~/Library/Application Support/aurora-access-browser/proxy-config.json
//   Linux   ~/.config/aurora-access-browser/proxy-config.json
//   Windows %APPDATA%\aurora-access-browser\proxy-config.json
//
// That file is JSON rather than a .js module on purpose: it sits in a
// user-writable directory, and JSON.parse cannot execute code the way
// require() of a module from that directory would. The app logs the path it
// loads from, so the Electron main-process log shows which file won.
//
// Values may also be supplied through the AURORA_PROXY_HOST / _PORT / _USER /
// _PASS environment variables, which take over whenever the file has no value
// for that field.
//
// NOTE: never put real host/logins/passwords in this file — it is committed.
module.exports = {
  // Set to false to disable proxying entirely.
  enabled: true,

  // SOCKS5 endpoint from your proxy provider's dashboard.
  host: 'proxy.example.com',
  port: 1080, // <-- your proxy provider's SOCKS5 port

  // Proxy authentication. Leave empty if the proxy does not require auth.
  username: 'your-proxy-login',
  password: 'your-proxy-password',
}
