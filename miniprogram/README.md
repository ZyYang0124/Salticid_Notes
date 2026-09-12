# Field Studio 微信小程序端

与网页版 Studio（`studio-remote/`）共用同一后端、同一账号体系、同一份数据：
邮箱 OTP 登录、观察创建、照片上传（含指纹去重与永久编号 `SN-YYYY-NNNNN`）、
WSC 学名建档与发布校验，全部调用现有 API——服务端仅为小程序新增了
`GET /studio/api/observations`（我的观察列表）一个只读接口。

定位：**野外快速记录**。拍照 → EXIF 建议落字段 → 上传 → 发布；
批量整理、鉴定修订、札记写作仍在网页版完成。

## 页面

| 页面 | 说明 |
| --- | --- |
| `pages/login` | 受邀邮箱 + 验证码登录（`X-Studio-Api: 1` 走 JSON 分支） |
| `pages/list` | 我的观察（草稿/已发布、鉴定、地点、照片数） |
| `pages/new` | 拍照/选图 → EXIF → 字段 → WSC 输入预测 → 创建并上传 → 发布 |

## 关键实现

- **会话**：小程序无 Cookie 管理，`utils/api.js` 手动接管 `studio_session`
  （从 `Set-Cookie` 捕获、每次请求回带、401/HTML 嗅探统一跳登录）。
- **照片上传**：服务端契约要求同一 multipart 内含 `original + width/height + variant×N`，
  而 `wx.uploadFile` 只支持单文件，故 `utils/multipart.js` 手工拼 multipart 报文
  （`wx.request` 的 `data` 传 ArrayBuffer 原样发送）。
- **派生图**：`utils/photo.js` 用 `wx.compressImage` 在客户端生成 480/768/1280/1920
  JPG 档（与网页版「只生成 jpg 档」约定一致），公开站 `<picture>` 自动降级兼容。
- **同源校验**：`sameOrigin` 对无 `Origin` 头的请求放行，小程序原生请求天然满足。

## 本地调试

1. `studio-remote/` 起本地服务：`npm run dev`（端口 4333）；
2. `miniprogram/config.js` 的 `BASE` 改为 `http://127.0.0.1:4333`；
3. 微信开发者工具导入 `miniprogram/`，「详情 → 本地设置」勾选
   **不校验合法域名**（工具内即可直连 HTTP 本地服务）；
4. 用受邀邮箱走一遍 OTP 登录。

## 正式上线的三道门槛（提交审核前必读）

1. **小程序账号**：需在微信公众平台注册小程序（个人主体可开发「效率/工具」类目，
   但部分分享能力受限；两位维护者可共用在"开发者/体验者"名单）。
2. **request 合法域名**：正式环境 `wx.request` 只能请求**已 ICP 备案的 HTTPS 域名**。
   `salticidnotes.cn` 目前托管在 Cloudflare（境外）且未备案——这是上线前唯一的
   硬性阻塞项。可选路径：
   - 完成 `salticidnotes.cn`（或子域）ICP 备案后加入小程序后台白名单；
   - 或改走「微信云托管」容器代理 Studio API（免备案，但引入一套转发基础设施）。
3. **隐私与内容审核**：小程序涉及位置信息（观察坐标），需在后台声明
   「位置信息」用途；`sitemap.json` 已全站 disallow，不上首页、不被搜索。

## 明确不做

- 不引入微信登录/OpenID 账号体系（登录只有受邀邮箱 OTP，AGENTS.md 规则 11/12）；
- 不做公众可用的上传/评论/社区功能（规则 26）；
- 不在小程序端存原图副本（原图只进 R2，编号与指纹规则不变）。
