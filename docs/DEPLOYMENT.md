# ExamMemory · 部署指南

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

### 3.2 通过 GitHub Actions（可控性更好）

新建 `.github/workflows/deploy-pages.yml`：

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

同时把仓库 **Settings → Pages → Source** 改为 `GitHub Actions`。

> 注意：GitHub Pages 有 1GB 软限制、100GB/月流量软限制。本项目不到 1MB，毫无压力。

---

## 四、Nginx

```nginx
server {
    listen 80;
    server_name exam.example.com;
    root /var/www/exam-memory;
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
sudo rsync -av --delete ./ /var/www/exam-memory/
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
docker build -t exam-memory .

# 运行
docker run -d --name exam-memory -p 8080:80 exam-memory
```

打开 <http://localhost:8080>。

挂载自己的题库：

```bash
docker run -d --name exam-memory -p 8080:80 \
  -v "$(pwd)/data.json:/usr/share/nginx/html/data.json:ro" \
  exam-memory
```

或用 `docker-compose.yml`：

```yaml
services:
  exam-memory:
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
| 打开首页 | 显示「考试记忆系统」，无白屏 |
| 浏览器控制台 | 无 404、无报错 |
| 数据源标签 | 显示「内置题库」或你的 `data.json` |
| 点「📘 JSON 规则」 | 能下载到规范文档 |
| 记忆闯关答题 | 进度条与已掌握数正常变化 |
| 分类考试走完一轮 | 成绩页正确率/用时正常 |
| 错题本 | 能写入、能移除 |
| 刷新页面 | 缓存仍在（若部署了 `data.json` 则回到它） |
| 手机浏览器 | 单列布局、按钮 ≥44px 可点 |
