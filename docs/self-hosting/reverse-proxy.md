# Reverse proxy

Inkadra does not serve HTTPS itself: a reverse proxy in front of it does. Whatever you use, the
proxy must
1. serve Inkadra on its own (sub)domain over HTTPS, the same address as `PUBLIC_URL`, at the
   root path (not under `/inkadra/`);
2. pass WebSocket upgrades on `/collab`, and keep them open for hours;
3. let request bodies of any size through and stream them, without buffering whole files, with
   read timeouts of several minutes: uploads resume in chunks, but a chunk can be large;
4. set `X-Forwarded-For` and `X-Forwarded-Proto`, and connect from an address that
   [`TRUST_PROXY`](configuration.md#trust_proxy) accepts;
5. not put its own login page in front of Inkadra: the mobile app, the browser extension and
   shared links call the API directly and cannot pass through it.

`compose.yaml` publishes Inkadra on `127.0.0.1:3000`, so only a proxy on the same machine can
reach it. If the proxy runs elsewhere, set `INKADRA_BIND=0.0.0.0` (or the LAN address) and limit
`TRUST_PROXY` to the proxy's address.

The configurations in [`deploy/proxy`](../../deploy/proxy) (Caddy, Traefik, Nginx) are tested by
CI on every change, in all-in-one and split mode, with
[`scripts/test-proxy.sh`](../../scripts/test-proxy.sh); each of its checks is one `curl` you can
run against your own setup. Nginx Proxy Manager and Pangolin are configured in their own
interfaces, so CI cannot run them: their settings below follow the tested Nginx and Traefik ones.

## Caddy

The simplest choice: Caddy gets and renews certificates by itself and its defaults already meet
every requirement.

```caddy
inkadra.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

In split mode add, before that line:

```caddy
	@collab path /collab /collab/*
	reverse_proxy @collab 127.0.0.1:3001
```

In Docker, [`deploy/proxy/caddy`](../../deploy/proxy/caddy) runs Caddy in the stack: set
`INKADRA_DOMAIN` and run

```sh
docker compose -f compose.yaml -f deploy/proxy/caddy/compose.yaml up -d
```

## Traefik

[`deploy/proxy/traefik`](../../deploy/proxy/traefik) runs Traefik in the stack with Let's Encrypt:
set `INKADRA_DOMAIN` and `ACME_EMAIL`, then

```sh
docker compose -f compose.yaml -f deploy/proxy/traefik/compose.yaml up -d
```

If Traefik already runs on the machine, add only the labels to the `inkadra` service, use your
own entry point and certificate resolver names, attach the service to the network Traefik
watches, and remove its `ports`:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.inkadra.rule=Host(`inkadra.example.com`)
  - traefik.http.routers.inkadra.entrypoints=websecure
  - traefik.http.routers.inkadra.tls.certresolver=letsencrypt
  - traefik.http.services.inkadra.loadbalancer.server.port=3000
```

Traefik v3 cuts requests that take longer than 60 seconds to read. Raise it on the HTTPS entry
point, in the static configuration:

```yaml
entryPoints:
  websecure:
    transport:
      respondingTimeouts:
        readTimeout: 0 # or a generous value such as 30m
```

WebSockets and `X-Forwarded-*` headers need nothing. For split mode, add a second router for
`PathPrefix(`/collab`)` pointing at the `collab` service on port 3001, as in
[`compose.split.yaml`](../../deploy/proxy/traefik/compose.split.yaml).

## Nginx

Use [`inkadra.conf.template`](../../deploy/proxy/nginx/inkadra.conf.template): outside Docker,
replace `${INKADRA_DOMAIN}` with your domain and both `${INKADRA_…UPSTREAM}` with
`127.0.0.1:3000` (`127.0.0.1:3001` for collab in split mode), save it in `/etc/nginx/conf.d/`, and
point `ssl_certificate` at your certificate, for example from certbot. The parts that matter:

```nginx
client_max_body_size    0;      # no limit here, Inkadra enforces UPLOAD_MAX_SIZE
proxy_request_buffering off;    # stream uploads instead of writing them to the proxy's disk
proxy_read_timeout      600s;
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection $connection_upgrade;   # with the map at the top of the file
proxy_set_header X-Forwarded-Proto $scheme;
```

In Docker, [`deploy/proxy/nginx`](../../deploy/proxy/nginx) fills in the template from `.env` and
reads the certificate from `NGINX_CERTS`.

## Nginx Proxy Manager

Add a proxy host:
- **Details.** Domain: your domain. Scheme `http`, forward hostname: `inkadra` if Nginx Proxy
  Manager is in the same Docker network, otherwise the machine's address (with
  `INKADRA_BIND=0.0.0.0`). Port `3000`. Turn on **Websockets Support**. Leave **Cache Assets**
  off.
- **SSL.** Request a Let's Encrypt certificate, turn on **Force SSL** and **HTTP/2 Support**.
- **Advanced.** Paste:

  ```nginx
  client_max_body_size 0;
  proxy_request_buffering off;
  proxy_read_timeout 600s;
  proxy_send_timeout 600s;
  ```

For split mode, add a **Custom location** `/collab` forwarding to `collab` (or the machine's
address) on port `3001`, with the same Websockets option. If Nginx Proxy Manager runs on another
machine, set `TRUST_PROXY` to its address.

## Pangolin

[Pangolin](https://github.com/fosrl/pangolin) publishes services through a tunnel to a VPS, with
Traefik on the VPS doing HTTPS. Create a resource:
- **Type** HTTP, with the subdomain of `PUBLIC_URL`.
- **Target** `http`, the address Pangolin's site connector (Newt) reaches Inkadra on, port
  `3000`: `inkadra` if Newt runs in the same Docker network, otherwise the machine's LAN or
  Tailscale address (and `INKADRA_BIND=0.0.0.0`).
- **Authentication** off for this resource. Pangolin's login page would sit in front of the API,
  and the mobile app, the browser extension and guest links could not get past it. Inkadra
  has its own sign-in.

WebSockets work without settings. Two things are on the VPS side and in Inkadra's `.env`:
- Raise Traefik's read timeout for large uploads: in Pangolin's
  `config/traefik/traefik_config.yml`, set `readTimeout` under
  `entryPoints.websecure.transport.respondingTimeouts` as shown under [Traefik](#traefik), and
  restart the stack.
- `TRUST_PROXY` must accept the address requests come from. With Newt in the same Docker network
  the default is enough; when the target is a Tailscale address, add the Tailscale range:
  `TRUST_PROXY=loopback,linklocal,uniquelocal,100.64.0.0/10`.

All-in-one mode is the easy fit for Pangolin: one target. For split mode, add a second target
for the path prefix `/collab` on port `3001`, if your Pangolin version supports path-based
targets.

## Cloudflare

If the domain goes through Cloudflare's proxy (orange cloud), its plan limits the size of a single
request (100 MB on the free plan). Inkadra's apps upload in resumable chunks of at most 50 MiB,
so large files still work; only scripts that send bigger requests to the API hit the limit. Keep WebSockets enabled in the
Cloudflare dashboard (they are on by default).
