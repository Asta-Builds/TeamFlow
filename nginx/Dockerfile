FROM nginx:1.27-alpine

RUN sed -i -E 's|pid\s+.*nginx\.pid;|pid /tmp/nginx.pid;|g' /etc/nginx/nginx.conf \
    && sed -i '/user  nginx;/d' /etc/nginx/nginx.conf \
    && mkdir -p /etc/nginx/templates /var/cache/nginx /var/log/nginx \
    && chown -R nginx:nginx /etc/nginx/conf.d /etc/nginx/templates /var/cache/nginx /var/log/nginx

COPY railway.conf.template /etc/nginx/templates/railway.conf.template
COPY railway-entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
    && chown nginx:nginx /entrypoint.sh /etc/nginx/templates/railway.conf.template

USER nginx

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
