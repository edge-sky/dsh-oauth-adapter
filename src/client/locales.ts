/** English copy for the OAuth accounts page. */
export const en = {
  nav: 'OAuth Accounts',
  title: 'OAuth Accounts',
  intro: 'Connect subscription-backed model providers without storing tokens in browser state.',
  connected: 'Connected',
  disconnected: 'Not connected',
  unavailable: 'OAuth is unavailable in this DSH installation.',
  connect: 'Connect',
  reconnect: 'Reconnect',
  cancel: 'Cancel',
  forget: 'Sign out',
  retry: 'Retry connection',
  opening: 'Starting sign-in…',
  authorized: 'Sign-in completed.',
  cancelled: 'Sign-in was cancelled.',
  failed: 'Sign-in failed.',
  submit: 'Continue',
  copy: 'Copy code',
  copied: 'Copied',
  loading: 'Loading account status…',
  hostDisconnected: 'The OAuth connection to DSH was interrupted.',
} as const

/** Simplified Chinese copy for the OAuth accounts page. */
export const zh: Record<keyof typeof en, string> = {
  nav: 'OAuth 账户',
  title: 'OAuth 账户',
  intro: '连接订阅型模型服务，令牌不会保存在浏览器状态中。',
  connected: '已连接',
  disconnected: '未连接',
  unavailable: '当前 DSH 安装未提供此 OAuth 流程。',
  connect: '连接',
  reconnect: '重新连接',
  cancel: '取消',
  forget: '退出登录',
  retry: '重新连接 DSH',
  opening: '正在启动登录…',
  authorized: '登录已完成。',
  cancelled: '登录已取消。',
  failed: '登录失败。',
  submit: '继续',
  copy: '复制代码',
  copied: '已复制',
  loading: '正在读取账户状态…',
  hostDisconnected: '与 DSH 的 OAuth 连接已中断。',
}

export type OAuthLocaleKey = keyof typeof en
