# mapp —— linux.do 微应用版本

这个目录不参与游戏本身。它只负责把仓库根目录的单文件 `index.html`
拆成社区微应用平台要求的五个基础文件，打成 `app.zip`。

**根目录的 `index.html` 仍然是唯一源码，双击就能玩，也仍然是 GitHub Pages 那份。**
改游戏只改它，改完重跑一次打包。

## 打包

```bash
node mapp/build-mapp.mjs
```

产物：`mapp/dist/package/app.zip`

需要一份 `linux-do/mapp-developer-guide` 仓库里的 `sdk/pack.mjs`（只用它打 ZIP，零依赖）：

```bash
git clone --depth 1 https://github.com/linux-do/mapp-developer-guide.git ../_mapp-sdk
```

放在别的路径就用 `MAPP_SDK_DIR=/path/to/sdk node mapp/build-mapp.mjs`。

指定版本：

```bash
MINI_APP_VERSION=1.0.1 node mapp/build-mapp.mjs
```

## 应用 ID

`mapp/manifest.json` 里的 `id` 现在还是占位符。第一次上架要：

1. linux.do → 个人资料 → **微应用** → 创建应用（填名称、简介、图标）
2. 复制分配到的应用 ID，原样填进 `manifest.json` 的 `id`
3. 重新打包

ID 不能自己编。

## 上传与审核

1. 应用页的**沙箱页签**上传 `app.zip`，等构建处理完
2. 沙箱构建**只活 7 天**，过期不可恢复；测不完就改版本号重新打
3. 自己验证：`/apps-sandbox/<app-id>/<version>-<8位sha>`
4. 正式页 **新建发布** → 选版本和构建 → 填更新说明和审核备注
5. 管理员在审核队列处理，结果走系统私信
6. 通过后还要**手动点上线**

## 拆出来的结构

| 文件 | 来自 `index.html` 的 |
| --- | --- |
| `index.html` | `<body>` 内容，剥掉 `<script>` |
| `app.css` | `<style>` 块 |
| `app.js` | `<script>` 块 |
| `strings.json` | 本目录的 `strings.json`（游戏没做 i18n，留空） |
| `manifest.json` | 本目录 |

打包脚本会先自检：片段里不许有 `<script>`、`<style>`、内联 `onclick`、
内联 `style="..."`、`<html>` 这类文档级标签。有就直接报错，不会打出废包。

## 权限

| 权限 | 用途 |
| --- | --- |
| `audio.webAudio` | 音效全是 Web Audio 实时合成的 |
| `storage.read` / `storage.write` | 周目进度、最快通关、击杀记录 |
| `fullscreen` | 暂停菜单里的全屏按钮 |

没申请网络、外部素材、手柄。游戏本来就是一个自包含的 HTML，
不联网、不读外部文件，审核这块最省事。

## 运行时适配

游戏代码里所有跟平台相关的写法都有 `MAPP` 判断（`globalThis.miniApp` 存在才走），
本地双击打开时那条分支整个跳过：

- 存档：平台 `miniApp.localStorage` 是异步的，启动时先给空档，异步读完再补并重画标题页；
  补完之前禁止写入，否则会拿空档覆盖真存档
- 全屏：走 `miniApp.fullscreen.request()`
- 首屏画完调 `miniApp.lifecycle.ready()`，不调平台会一直等
- `AudioContext` 创建失败（没获批或没拿到手势）就永久静音，不阻塞开局
