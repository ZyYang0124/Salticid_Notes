// 邀请伙伴（规则 11）：站长专属页面 —— 登记 name + email 进受邀白名单。
// 被邀请人首次 OTP 登录后自动建为 contributor 并认领邀请。
import { esc } from './pages';

export function invitePage(
  rows: { code: string; label: string | null; email: string | null; claimed_by: number | null }[],
  notice: string | null,
): string {
  return `
  <h1>邀请伙伴</h1>
  <p><small>只有登记在此的邮箱能登录（规则 11：受邀制，无公开注册）。被邀请人首次登录后自动成为协作者（contributor）。</small></p>
  ${notice ? `<div class="msg">${esc(notice)}</div>` : ''}
  <div class="card">
    <h2 style="margin-top:0">新增邀请</h2>
    <form method="post" action="/studio/invite">
      <div class="grid2">
        <div><label>名字（用于列表展示）</label><input type="text" name="label" required placeholder="咩咩" /></div>
        <div><label>邮箱（对方登录用的邮箱）</label><input type="email" name="email" required placeholder="miemie@example.com" /></div>
      </div>
      <div style="margin-top:16px"><button type="submit">加入受邀名单</button></div>
    </form>
  </div>
  <h2>已邀请（${rows.length}）</h2>
  <table><tr><th>名字</th><th>邮箱</th><th>邀请码</th><th>状态</th><th>操作</th></tr>
    ${rows
      .map((r) => {
        const owner = r.email && r.email.toLowerCase() === 'yangzy0124@gmail.com';
        const confirmMsg = r.claimed_by
          ? `确定剔除「${r.label || r.email}」？
其将立即退出且无法再登录（已发布内容保留）。`
          : `确定撤销「${r.label || r.email}」的邀请？`;
        return `<tr><td>${esc(r.label ?? '—')}</td><td>${esc(r.email ?? '未登记')}</td><td><code>${esc(r.code)}</code></td><td>${r.claimed_by ? '已加入 ✓' : '待登录'}</td><td>${
          owner
            ? '<span class="hint">站长</span>'
            : `<form method="post" action="/studio/invite/remove" onsubmit="return confirm('${esc(confirmMsg)}')" style="margin:0"><input type="hidden" name="code" value="${esc(r.code)}" /><button type="submit" class="danger">剔除</button></form>`
        }</td></tr>`;
      })
      .join('')}
    ${rows.length === 0 ? '<tr><td>还没有邀请记录。</td></tr>' : ''}
  </table>`;
}
