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

`mapp/manifest.json` 里的 `id` 已经是正式分配的值（`01a1d233-9df9-7b8c-a797-ceb6c82d3465`），
换应用才需要改：

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
| `app.js` | `<script>` 块，外面再包一层 IIFE（平台的 loader 会往末尾追加一段 SDK 校验代码，包一层避免和顶层声明打架） |
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

## 沙箱里的 CSP（踩过的坑）

应用不是直接跑在帖子页面里，宿主会建一个 `allow-scripts`（不透明源）的 iframe，
先把一份 `/runtime` 引导页 `document.write` 进去，再把拼好的 HTML 写进内层
sandbox iframe。那份文档带的 CSP 比想象中严：

```
default-src 'none'; script-src 'sha256-…' 'wasm-unsafe-eval'; style-src 'sha256-…';
style-src-attr 'none'; connect-src 'none'; img-src blob:; font-src 'none';
media-src 'none'; frame-src 'none'; require-trusted-types-for 'script';
trusted-types 'none'
```

后果（都会让应用「启动失败」，而且平台把异常吞掉，控制台一个字都没有）：

- **`innerHTML` 直接抛** `This document requires 'TrustedHTML' assignment`。
  `Element.prototype.innerHTML` 是 `configurable:false`，改不了 setter；
  `DOMParser.parseFromString` 也被同样拦下。所以只能用 `createElement` 建节点。
  代码里统一走 `setHTML(el, html)`：先照原样写 `innerHTML`（本地双击走这条），
  被拒绝时用自带的极简解析器 `hxNodes()` 建 DOM。这两个函数在 `index.html` 的 HUD 段开头。
- **`localStorage` 读一下就抛 `SecurityError`**（不透明源没有 storage）。所有存取都在
  `try/catch` 里，平台存档走 `miniApp.localStorage`。
- **`style="..."` 内联样式会被丢掉**（`style-src-attr 'none'`），要用 class。
- **没有 `allow-fullscreen`**，`requestFullscreen()` 只会在微应用里拿到被拒的 Promise，
  全屏必须走 `miniApp.fullscreen.request()`。

### 排查手法

平台不会告诉你哪一行炸了，所以调试时把 `app.js` 包一层探针，用
`(window.top||parent).postMessage({type:'hx-diag',...})` 把 `addEventListener('error')`
拿到的 message/stack 发到最外层页面，再在页面里 `addEventListener('message')` 收。
注意应用的 `parent` 是 frame-host，不是帖子页面，必须发 `window.top`。

