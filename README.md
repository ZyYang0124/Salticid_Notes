# 红栏杆跳蛛观察志 · Salticid Notes

> 每一条记录，都始于一次相遇。

**红栏杆跳蛛观察志（Salticid Notes）** 是一本由站长与受邀伙伴共同维护的数字自然史观察志，记录我们在野外与日常观察中遇见的跳蛛：活体摄影、行为、生境、野外札记、标本信息、分类鉴定与长期鉴定修订历史。地理范围不限中国。

它不是任何地区的跳蛛完整名录，不是 GBIF / iNaturalist / World Spider Catalog 的替代品，更不是公众上传或鉴定平台。网站的边界由「我们实际观察过什么」决定。

**每条记录都始于一次观察，而不是一个物种条目。**

- 公开站：<https://salticidnotes.cn>
- Field Studio（受邀伙伴的记录工作台）：<https://studio.salticidnotes.cn>

## 核心概念

- **Observation 是核心实体**：物种页面永远由「已发布观察 + 当前鉴定」聚合而成，不存在手工维护的物种条目；
- **发布即公开**：`draft → published`，没有审核队列；已发布记录随时可改，编号与 URL 永不变；
- **鉴定可以变，记录不会变**：鉴定历史完整保留，未知与存疑（sp. / cf. / aff. / 工作编号）都是一等公民；
- **照片是唯一的对外编号对象**：`SN-YYYY-NNNNN`，一张原图全站只允许上传一次（SHA-256 指纹去重），删除后编号烧毁、永不复用。

## 技术栈

| 部分 | 技术 | 说明 |
|---|---|---|
| 公开站 | Astro 5 + Cloudflare Workers | 混合渲染（详情页预生成），类型化 JSON 数据层 + 构建期隐私管线 |
| Field Studio | Cloudflare Workers + D1 (SQLite) + R2 | 邮箱 OTP（受邀白名单）登录；观察/札记直接发布，自动同步公开站 |
| 媒体管线 | 浏览器端派生图 + sharp（构建期） | 原图 immutable 存 R2；公开派生图全格式剥离 EXIF（含 GPS） |
| 分类核验 | WSC（World Spider Catalog） | 发布时校验学名；周期重校验同步分类学变动 |

## 本地开发

```bash
npm install
npm run dev              # 公开站开发服务器
npm run build            # 媒体管线 + 静态构建
npm run test:privacy     # 公开数据安全测试（坐标 / 未发布 / 私有媒体 / EXIF）
```

Field Studio（`studio-remote/`，需 Cloudflare 凭据与 `.dev.vars`）：

```bash
cd studio-remote
npm run dev              # 本地 Workers + 本地 D1/R2（http://127.0.0.1:4321 起）
npm run migrate:local    # 本地 D1 迁移
npm run migrate:remote   # 生产 D1 迁移
npx wrangler deploy      # 部署 Studio
```

## 部署

```text
git push → GitHub（源码唯一真源）
        ├─ Cloudflare Workers Builds → Studio Worker（studio.salticidnotes.cn）
        └─ 公开站 Worker（salticidnotes.cn）
```

GitHub 是唯一源码真源；Studio 发布时也会通过 Git Data API 把已发布内容自动提交回仓库。

## 隐私与数据

- 公开派生图一律剥离全部 EXIF（含 GPS）；原图 immutable，不进公开产物；
- 有可靠坐标的已发布观察直接公开精确坐标（站点策略）；没有就不编造；
- 照片编号 `SN-YYYY-NNNNN` 一经分配永不改变、永不复用；
- `npm run test:privacy` 在每次构建前校验公开产物（坐标 / 未发布记录 / 私有媒体 / EXIF）。

## 目录结构

```text
src/                 公开站（页面 / 组件 / 数据层 / 构建期渲染器）
  data/              类型化 JSON 源表（手写数据 + studio-*.json 自动同步）
  lib/               store（装载+校验）· privacy（公开 DTO）· queries · markdown
studio-remote/       Field Studio（Workers + D1 + R2；migrations / src / scripts）
miniprogram/         Field Studio 微信小程序端（复用 Studio API；见其 README）
scripts/             媒体派生 · 隐私测试 · 部署辅助
docs/                数据审计文档
```

## 环境变量与密钥

真实凭据只进 `.dev.vars` / `.env` / Cloudflare Secrets，绝不进 Git：`GITHUB_TOKEN`、`RESEND_API_KEY`、`OWNER_EMAIL`、`STUDIO_SESSION_SECRET`、`MAIL_FROM`。
