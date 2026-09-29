// Proxy credentials template — copy to electron/proxy-config.js and fill in.
//
//   cp electron/proxy-config.example.js electron/proxy-config.js
//
// electron/proxy-config.js is gitignored, so real proxy credentials never
// reach the repository or its history. Values may also be supplied through the
// AURORA_PROXY_HOST / _PORT / _USER / _PASS environment variables, which take
// precedence over a missing config file.
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
