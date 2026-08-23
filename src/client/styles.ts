/** Plugin-owned styles, injected and removed with the browser Cordis fiber. */
export const styles = `
.dsh-oauth-section{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary)}
.dsh-oauth-title{margin:0;font-size:16px;line-height:24px;font-weight:500}
.dsh-oauth-intro,.dsh-oauth-muted{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsh-oauth-error{margin:0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-state-error-bg);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dsh-oauth-list{display:flex;flex-direction:column;gap:8px;margin:4px 0 0;padding:0;list-style:none}
.dsh-oauth-card{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}
.dsh-oauth-head{display:flex;align-items:center;gap:8px}.dsh-oauth-name{font-size:14px;font-weight:500}.dsh-oauth-state{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-oauth-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-error-primary)}.dsh-oauth-dot[data-connected=true]{background:var(--dsw-alias-state-success-primary)}
.dsh-oauth-actions{display:flex;gap:6px;margin-left:auto}.dsh-oauth-button{box-sizing:border-box;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:15px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}.dsh-oauth-button[data-primary=true]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-primary)}.dsh-oauth-button:disabled{cursor:not-allowed;opacity:.5}
.dsh-oauth-flow{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l3);font-size:13px;line-height:20px}.dsh-oauth-flow a{color:var(--dsw-alias-link-primary);overflow-wrap:anywhere}.dsh-oauth-code{display:flex;align-items:center;gap:8px}.dsh-oauth-code code{padding:5px 8px;border-radius:6px;background:var(--dsw-alias-fill-secondary);font-size:14px;letter-spacing:.08em}
.dsh-oauth-prompt{display:flex;flex-direction:column;gap:7px}.dsh-oauth-input,.dsh-oauth-select{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-fill-primary);color:var(--dsw-alias-label-primary)}
`
