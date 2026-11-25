// Separate proof servers can use their own loopback port and pairing state.
const configured = process.env.INSPECTOR_HELPER_PORT ?? '5188'
if (!/^\d{1,5}$/.test(configured) || Number(configured) < 1024 || Number(configured) > 65535) {
  throw Error('Invalid local helper port')
}
export const helperPort = Number(configured)
export const helperHost = '127.0.0.1:' + helperPort
