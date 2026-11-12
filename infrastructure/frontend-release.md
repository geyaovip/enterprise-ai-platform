# 前端发布

工作台、企业管理和平台运营各自有一个 Cloudflare Worker。GitHub Actions 对 `main` 的提交完成类型检查、API 编译、三端构建及 SEO 检查后，保留 30 天的 `frontends-<SHA>` 产物。发布工具下载该产物、核对 GitHub 提供的摘要和归档里的完整提交 SHA，并记录 CI 运行编号。

在新平台项目根目录运行。需要 Python 3、项目指定的 Node、已登录的 GitHub CLI，以及可发布对应 Worker 的 Wrangler 会话。

```sh
git fetch origin main
release_sha=$(git rev-parse origin/main)
python3 infrastructure/release-cloud-frontends.py prepare "$release_sha" workspace
```

`prepare` 记录当前生产版本，保留上一版页面仍会加载的带哈希资源，并上传候选版本。目标可选 `workspace`、`tenant-admin` 或 `platform-admin`。各端首次采用流程时追加 `--previous-assets <当前生产构建的资产文件名清单.json> --previous-version <当前 Worker 版本 ID>`。从下一次起，发布工具从该端线上的 `release-info.json` 读取带摘要的资产清单。

核对回执里的提交 SHA、CI 运行、候选版本和回退版本后，用同一个回执切换流量。

```sh
python3 infrastructure/release-cloud-frontends.py activate "var/releases/$release_sha/workspace/receipt.json"
```

激活时工具重新核对生产基线，切换后检查正式入口、新资源摘要、线上提交标记及 API 健康。检查持续失败且生产仍在本次候选版本时，工具恢复上一版本。手动回退使用同一回执。

```sh
python3 infrastructure/release-cloud-frontends.py rollback "var/releases/$release_sha/workspace/receipt.json"
```

回执存放在本地受限发布记录内。Cloudflare 上传和切换记录带提交 SHA 与 CI 运行编号，各端正式域名下的 `release-info.json` 可查询当前页面对应的提交。API、数据库迁移和网关依照各自的发布流程操作。
