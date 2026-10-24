# 官网代码SEO优化与发布

日期：2026-10-23，D-060。用户授权继续补齐代码层SEO，范围为知行方舟及ERP、CRM、MES五个公开页。

## 发现与修复

| 发现 | 修复 | 影响 |
| --- | --- | --- |
| robots缺少Sitemap声明，Disallow遮挡HTML noindex | 声明正式地图，仅限制API；账户/业务HTML保留meta与HTTP noindex | 爬虫可以发现公开页并读到私有壳的索引指令；鉴权仍由API处理 |
| 图片与CSS/JS等非公开页资源统一附带noindex | 仅私有HTML及错误响应加noindex，公开图片保持可抓取 | 产品截图与品牌标识不再被统一排除 |
| 普通未知路径返回200登录壳 | 只有明确账户路由及企业业务路径走app.html，其他未知公开路径返回真实404 | 避免错误地址形成软404 |
| workers.dev仍重复提供公开官网 | 仅公开页、公开别名、robots/sitemap永久308到正式来源 | 统一zhixingark.cn；旧登录、企业及API不跳域 |
| 元信息和页面层级数据不完整 | JSON-LD组织/站点/网页/面包屑/目录/应用关联图 | 所有描述、功能及导航来自可见内容，不虚构价格、评分或评论 |
| 分享卡片缺少图片尺寸及完整Twitter信息 | 补齐标题、描述、图片、alt、实际宽高；允许大图预览 | 分享和图片提取信息一致 |
| 首屏主图未预加载 | 首页预加载同一主图，非首屏图lazy与async解码，宽高保持明确 | 改善发现优先级；本轮未做真实用户性能量化 |

五页继续输出完整静态HTML，爬虫无需执行React才能读正文。每页唯一title、description、H1和正式canonical。新增可见首页面包屑，与BreadcrumbList保持一致。

## 技术依据与边界

- [Google noindex说明](https://developers.google.com/search/docs/crawling-indexing/block-indexing)：禁止抓取会阻碍爬虫读取noindex。robots不是鉴权；当前业务API权限、会话及CRM AI闸门不变。
- [Google面包屑说明](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)：结构化层级与页面导航对应。
- [Google应用结构化数据说明](https://developers.google.com/search/docs/appearance/structured-data/software-app)：当前没有公开价格/真实评分，因此不补虚构商业字段；语义结构检查通过不等于软件富媒体展示资格通过。
- sitemap仅列五个规范URL，不用每次构建时间充当内容更新时间，不加虚构lastmod或更新频率。

## 验证与发布

- Workspace构建通过；只发布Workspace前端及其路由Worker。入口Worker、两管理端、后端和数据库未部署或重启。
- 本地public-pages、cloud-routes、seo三组检查通过：五个完整页、23处图片、121个内部链接/锚点、五个JSON-LD图、三种爬虫读取一致性、六类旧公开URL跳转、四类真实404、八类账户/企业路由、图片索引及HEAD。
- 当前Workspace版本：`1ec2f6fe-db19-4564-a8c1-1adfe3a51c1b`；上一版：`bbc403c4-9f7e-4cbd-909e-160eedadb60c`。
- 线上31项检查通过，五页实际HTML与构建字节相同；检查结果记录于`var/operations/20261023-seo/live-verification.json`，构建/发布日志同目录。浏览器核对旧MES入口实际跳转正式域名，刷新后检查新面包屑、meta和JSON-LD；截图为`output/seo-20261023/mes-online.png`。初次浏览器打开时边缘仍返回旧HTML，刷新后确认新版本，未将旧截图作最终证据。

本轮不调用模型、不写业务数据。未进行Search Console/百度站长账号验证、主动收录提交、实际索引/排名、全浏览器/真机或真实用户Core Web Vitals验收。

## 复现与回退

构建：`PUBLIC_SITE_ORIGIN=https://zhixingark.cn node infrastructure/build-cloud-frontends.mjs web`；构建后运行`pnpm test:seo`（public-pages、cloud-routes、seo三组检查）；发布使用`wrangler deploy -c wrangler.workspace.jsonc`。

源码、前端dist及本批文档以独立清单归档，保留前次品牌/域名批次和后端MES r2发布证明。回退只需将Workspace回到上列前版本，再核对官网、robots、图片响应头和业务壳；不用回滚数据库或更改Custom Domain。
