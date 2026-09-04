# ExamMemory · 纯静态应用，基于 nginx:alpine（镜像约 10MB）
FROM nginx:1.27-alpine

# 整个目录即站点内容
COPY . /usr/share/nginx/html/

# 题库 JSON 不缓存，保证更新即时生效
RUN printf '%s\n' \
    'server {' \
    '    listen       80;' \
    '    server_name  _;' \
    '    root         /usr/share/nginx/html;' \
    '    index        index.html;' \
    '' \
    '    location = /data.json {' \
    '        add_header Cache-Control "no-store";' \
    '        add_header Access-Control-Allow-Origin "*";' \
    '    }' \
    '' \
    '    location / {' \
    '        try_files $uri $uri/ /index.html;' \
    '    }' \
    '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
