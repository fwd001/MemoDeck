# MemoDeck · 部署指南

本项目是**纯静态应用**，没有后端、没有构建步骤、没有依赖安装。任何能托管 HTML 文件的地方都能跑。

## 零、部署前先确认

所有资源都用**相对路径**引用（`css/style.css`、`js/app.js`、`vendor/...`），所以：

- ✅ 放在站点根目录能跑
- ✅ 放在子目录（如 `example.com/exam/`）也能跑
- ❌ 不要把 `index.html` 单独拷出来，目录结构必须完整保留

必须一起部署的文件：

```
index.html
config.js
default-bank.js
css/style.css
js/*.js
vendor/vue.global.prod.js
docs/EXAM_JSON_SPEC.md   （可选，供「📘 JSON 规则」按钮下载）
exam-bank.schema.json    （可选，供编辑期校验）
history-example.json     （可选，示例题库）
```

可选：`data.json`（你的实际题库，放 `index.html` 同目录）。

---

## 一、本地双击（零部署）

**直接双击 `index.html`**，`file://` 协议，完全离线，不需要任何环境。

限制（浏览器安全策略，不是项目的问题）：

| 限制 | 影响 | 绕开方式 |
|---|---|---|
| 不能 `fetch` 本地文件 | `data.json` 不会自动加载 | 拖拽/选择文件导入，或改用本地服务器 |
| 个别浏览器限制 localStorage | 缓存可能失效 | 换 Chrome/Edge/Safari，或用本地服务器 |

适合：个人单机使用、U 盘随身带、发给同学直接用。

---

## 二、本地静态服务器（推荐的开发/验证方式）

任选一条，在项目根目录执行：

```bash
# Python 3（macOS / Linux 自带）
python3 -m http.server 8000

# Node.js
npx serve -l 8000

# PHP
php -S localhost:8000
```

浏览器打开 <http://localhost:8000>。

此时 `data.json` 会自动加载（优先级：缓存 > `data.json` > 内置题库）。想强制读 `data.json`，点「🧹 清空缓存并重载」。

---

## 三、GitHub Pages

最省事的公开托管方式，免费且自带 HTTPS。

### 3.1 通过仓库设置（最简）

1. 推送代码到 GitHub 仓库
2. 仓库 **Settings → Pages**
3. **Source** 选 `Deploy from a branch`
4. **Branch** 选 `main`，目录选 `/ (root)`
5. Save，等 1~2 分钟

访问地址：`https://<用户名>.github.io/<仓库名>/`

### 3.2 通过 GitHub Actions（本仓库已内置，推荐）

仓库已内置部署工作流 **`.github/workflows/deploy.yml`**；从零搭建时，在仓库根目录新建**同名文件**即可：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .            # 纯静态，整个目录直接上传
      - id: deployment
        uses: actions/deploy-pages@v4
```

**`path` 参数怎么填**（`upload-pages-artifact` 的 `with.path`）：

| 静态文件位置 | path 取值 | 说明 |
|---|---|---|
| 仓库根目录 | `path: .` | 本仓库即此情况：`index.html`、`css/`、`js/`、`vendor/` 都在根目录 |
| `public/` 子目录 | `path: public` | 常见于框架脚手架约定，把 `public/` 当作站点根 |

`path` 指向的目录会被当作站点根目录整体上传（含 `index.html` 的位置决定访问入口）。

**一次性的网页端开启（Settings → Pages）**：

1. 打开仓库页 → **Settings**（齿轮，页面右上方）
2. 左侧栏 **Code and automation** 组 → **Pages**
3. **Build and deployment** 区块 → **Source** 下拉框，默认是 `Deploy from a branch`
4. 把它切换为 **GitHub Actions**（选择即保存，无需额外点 Save）
5. 此时 GitHub 会提示将使用仓库中的 Actions 工作流部署
6. 触发一次部署（任选其一）：
   - 往 `main` 推一个新提交（推送即自动触发）
   - 或进入 **Actions** 页 → 选中 `Deploy to GitHub Pages` → 右侧 **Run workflow** 手动触发
   - 或本地补一个空提交：`git commit --allow-empty -m "chore: 触发 Pages 部署" && git push`

> 如果之前用「Deploy from a branch」部署过，切到 `GitHub Actions` 后旧的分支部署即失效，无需手动清理。

> 注意：GitHub Pages 有 1GB 软限制、100GB/月流量软限制。本项目不到 1MB，毫无压力。

### 3.3 验证与访问

**默认访问 URL 格式**（GitHub 自动生成）：

```
https://<用户名>.github.io/<仓库名>/
```

- 项目站点（普通仓库）：`https://<用户名>.github.io/<仓库名>/`
- 用户/组织站点（仓库名恰为 `<用户名>.github.io`）：`https://<用户名>.github.io/`（根路径）

本项目对应地址：`https://fwd001.github.io/MemoDeck/`

**在 Actions 运行记录里直接打开**：

1. 打开仓库 **Actions** 页，左侧点 `Deploy to GitHub Pages` 工作流
2. 点开最新一条绿色（成功）的运行记录
3. 点顶部 `deploy` 任务进入任务明细
4. 任务右侧面板的 **Deployment** 区块会显示 `github-pages` 环境及其 URL；点该 URL 或任务页面里的 **View deployment** 按钮即可直接打开网页
5. 仓库首页右侧 **Environments** 里也能看到 `github-pages`，点 **View deployment** 同样可达

第一次部署通常 1~2 分钟；若浏览器打开的是旧内容，强刷（Cmd/Ctrl + Shift + R）后再看。

### 3.4 纯静态项目在子路径下的资源引用避坑

项目站点运行在 `https://<用户名>.github.io/<仓库名>/` 这个**子路径**下，资源引用最容易踩两个坑：

**① 不要以 `/` 开头的绝对路径引用本地资源**

```html
<!-- ✗ 错误：/css/style.css 会被解析到 https://<用户名>.github.io/css/style.css -->
<link rel="stylesheet" href="/css/style.css">
<!-- ✓ 正确：css/style.css 相对当前页解析到 /<仓库名>/css/style.css -->
<link rel="stylesheet" href="css/style.css">
```

以 `/` 开头的写法只在「用户/组织根站点」才成立；放到子路径的项目站点一律 404。

**② 相对路径要按「文件所在层级」写**

| 场景 | 写法 |
|---|---|
| `index.html`（站点根）引用根级资源 | `css/style.css`、`js/app.js`、`./data.json` 均可 |
| 内层页面（如 `docs/a.html`）引用根级资源 | `../css/style.css`（多一层目录多一个 `../`） |
| JS 里 `fetch` 远程/本地 JSON | 与 HTML 相同规则：`fetch('./data.json')` 可，`fetch('/data.json')` 会 404 |

**本项目的现状（已正确）**：`index.html` 里全部使用无前导斜杠的相对路径（`css/style.css`、`js/*.js`、`vendor/vue.global.prod.js`），因此同一套代码同时兼容 `file://` 双击直开、`localhost` 与 GitHub Pages 子路径三种场景，无需改动。后续新增资源（图片、字体、题库文件）也请沿用「相对路径、不加 `/`」的约定。

**关于跨域**：远程题库请求的 CORS 已在服务端解决，前端无需代理；GitHub Pages 只托管静态文件、无法自定义响应头，因此**跨域策略只能在数据源服务器上配置**，部署到 Pages 不影响这一点。

### 3.5 本项目实战验证记录（2026-09-04）

**现状**：仓库已启用 GitHub Pages（Source = `GitHub Actions`），部署工作流为 `.github/workflows/deploy.yml`，线上地址 **https://fwd001.github.io/MemoDeck/**（已验证 HTTP 200，标题与本地一致）。

**启用前的一段“失败日志”**（可作为排查参照）：Pages 未开启时推送代码，`Deploy to GitHub Pages` 工作流会在第 2 步 `配置 Pages（configure-pages）` 就失败、上传/部署两步全部跳过——这是“Pages 还没开启”的典型特征，**不是工作流写错了**。开启后无需改任何文件，直接 Re-run 或重新推送即成功（本项目第 2 次部署即通过，此前多次红色均源于此）。

**经验速记**：

1. `deploy.yml` 写全也可能红——先确认 Settings → Pages → Source 已切成 `GitHub Actions`；
2. 开启后想立刻验证，不必等新提交：Actions 页对失败记录点 **Re-run all jobs** 即可；
3. 部署产物始终以 `main` 最新内容为准；页面若像旧的，强刷（Cmd/Ctrl + Shift + R）；
4. 排障入口：Actions → `Deploy to GitHub Pages` → 打开运行 → 若第 2 步失败即未开启 Pages。

---

## 四、Nginx

```nginx
server {
    listen 80;
    server_name exam.example.com;
    root /var/www/memodeck;
    index index.html;

    # 单页应用：找不到文件时回退到 index.html（本项目用不上，但写了不亏）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态资源缓存：JS/CSS 带 hash 可长缓存，这里保守设置
    location ~* \.(js|css)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # 题库 JSON 不要缓存，保证更新即时生效
    location = /data.json {
        expires -1;
        add_header Cache-Control "no-store";
    }

    gzip on;
    gzip_types text/css application/javascript application/json;
}
```

部署：

```bash
sudo rsync -av --delete ./ /var/www/memodeck/
sudo nginx -t && sudo systemctl reload nginx
```

### 允许别人远程链接导入（CORS）

如果希望其他人用「🌐 远程导入」拉取你服务器上的题库，需要开 CORS：

```nginx
location = /data.json {
    add_header Access-Control-Allow-Origin *;
    add_header Cache-Control "no-store";
}
```

`*` 表示任何人可拉。若只想给内部用，换成具体域名：

```nginx
add_header Access-Control-Allow-Origin https://exam.example.com;
```

---

## 五、Apache

在项目根目录放 `.htaccess`：

```apache
DirectoryIndex index.html

<FilesMatch "\.(js|css)$">
    Header set Cache-Control "max-age=604800, public"
</FilesMatch>

<FilesMatch "data\.json$">
    Header set Cache-Control "no-store"
    Header set Access-Control-Allow-Origin "*"
</FilesMatch>

<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/css application/javascript application/json
</IfModule>
```

确保 `mod_headers` 和 `mod_deflate` 已启用：

```bash
sudo a2enmod headers deflate && sudo systemctl reload apache2
```

---

## 六、Vercel / Netlify

### Vercel

项目根目录放 `vercel.json`（其实不放也行，Vercel 会自动识别静态站点）：

```json
{
  "cleanUrls": true,
  "headers": [
    {
      "source": "/data.json",
      "headers": [{ "key": "Cache-Control", "value": "no-store" }]
    }
  ]
}
```

部署：

```bash
npx vercel --prod
```

或在 Vercel 网页端 Import Git Repository，Framework 选 **Other**，Build Command 留空。

### Netlify

项目根目录放 `netlify.toml`：

```toml
[build]
  publish = "."

[[headers]]
  for = "/data.json"
  [headers.values]
    Cache-Control = "no-store"
    Access-Control-Allow-Origin = "*"
```

拖拽整个目录到 Netlify 网页端即可，或连接 Git 仓库自动部署。

---

## 七、Docker

项目自带 `Dockerfile`（基于 `nginx:alpine`，镜像约 10MB）：

```bash
# 构建
docker build -t memodeck .

# 运行
docker run -d --name memodeck -p 8080:80 memodeck
```

打开 <http://localhost:8080>。

挂载自己的题库：

```bash
docker run -d --name memodeck -p 8080:80 \
  -v "$(pwd)/data.json:/usr/share/nginx/html/data.json:ro" \
  memodeck
```

或用 `docker-compose.yml`：

```yaml
services:
  memodeck:
    build: .
    ports:
      - "8080:80"
    volumes:
      - ./data.json:/usr/share/nginx/html/data.json:ro
    restart: unless-stopped
```

---

## 八、内网 / 离线环境

无外网时，把整个目录：

- 拷到共享盘 / U 盘，各自双击 `index.html`
- 或丢到内网任意静态服务器上，同事访问内网地址即可

**题库共享**：把 `data.json` 放在同一服务器，大家用「🌐 远程导入」填内网地址；或干脆把 JSON 文件发给大家各自导入。

> ⚠️ **发布到公开仓库前**，确认 `config.js` 里的 `jsonManagerUrl` 为空或填的是可公开的地址。原本硬编码的内网 IP 已抽到该文件，默认值留空。

---

## 九、部署后自检清单

| 检查项 | 期望 |
|---|---|
| 打开首页 | 显示「MemoDeck」，无白屏 |
| 浏览器控制台 | 无 404、无报错 |
| 数据源标签 | 显示「内置题库」或你的 `data.json` |
| 点「📘 JSON 规则」 | 能下载到规范文档 |
| 记忆闯关答题 | 进度条与已掌握数正常变化 |
| 分类考试走完一轮 | 成绩页正确率/用时正常 |
| 错题本 | 能写入、能移除 |
| 刷新页面 | 缓存仍在（若部署了 `data.json` 则回到它） |
| 手机浏览器 | 单列布局、按钮 ≥44px 可点 |
