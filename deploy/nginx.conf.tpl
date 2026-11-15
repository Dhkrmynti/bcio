# nginx · __DOMAIN__ (BCIO) lewat HTTPS. Dipasang setelah
#   certbot certonly --webroot -w /var/www/__DOMAIN__ -d __DOMAIN__ -d www.__DOMAIN__
# Router SNI di :443 (blok stream di nginx.conf) meneruskan nama yang tidak terdaftar ke 127.0.0.1:8443 dengan PROXY protocol.
# Batas request per IP: chat memakai kredit Claude, jadi dibatasi ketat.
limit_req_zone $proxy_protocol_addr zone=bcio_chat:10m rate=6r/m;
limit_req_zone $proxy_protocol_addr zone=bcio_api:10m rate=120r/m;
server {
    listen 127.0.0.1:8443 ssl proxy_protocol;
    server_name __DOMAIN__ www.__DOMAIN__;
    ssl_certificate /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 64k;
    limit_req_status 429;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $proxy_protocol_addr;
    proxy_set_header X-Forwarded-For $proxy_protocol_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Connection "";

    location = /api/chat {
        limit_req zone=bcio_chat burst=4 nodelay;
        proxy_pass http://127.0.0.1:5860;
        proxy_buffering off;              # jawaban agent di-stream (SSE)
        proxy_read_timeout 300s;
    }
    location /api/ {
        limit_req zone=bcio_api burst=40 nodelay;
        proxy_pass http://127.0.0.1:5860;
        proxy_read_timeout 120s;
    }
    location / {
        proxy_pass http://127.0.0.1:5860;
    }
}
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__ www.__DOMAIN__;
    location /.well-known/acme-challenge/ { root /var/www/__DOMAIN__; }
    location / { return 301 https://$host$request_uri; }
}
