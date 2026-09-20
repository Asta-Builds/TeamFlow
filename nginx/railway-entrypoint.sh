#!/bin/sh
set -e

export PORT="${PORT:-80}"
export BACKEND_HOST="${BACKEND_HOST:-teamflow-backend.railway.internal:8000}"
export NEST_HOST="${NEST_HOST:-teamflow-backend-nest.railway.internal:8001}"
export FRONTEND_HOST="${FRONTEND_HOST:-teamflow-frontend.railway.internal:3000}"
export RESOLVER="${RESOLVER:-[fd12::10]}"

if [ -z "${ADMIN_ALLOWED_IPS}" ]; then
    export ADMIN_ALLOW_RULES="deny all;"
else
    RULES=""
    OLD_IFS="$IFS"
    IFS=','
    for cidr in ${ADMIN_ALLOWED_IPS}; do
        clean_cidr=$(echo "$cidr" | tr -d '[:space:]')
        if [ -n "$clean_cidr" ]; then
            RULES="${RULES}        allow ${clean_cidr};
"
        fi
    done
    IFS="$OLD_IFS"
    RULES="${RULES}        deny all;"
    export ADMIN_ALLOW_RULES="$RULES"
fi

envsubst '${PORT} ${RESOLVER} ${BACKEND_HOST} ${NEST_HOST} ${FRONTEND_HOST} ${ADMIN_ALLOW_RULES}' \
    < /etc/nginx/templates/railway.conf.template \
    > /etc/nginx/conf.d/default.conf

nginx -t

exec nginx -g 'daemon off;'
