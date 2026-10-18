# A proxy for the radios

Safari (every browser on iPhone and iPad) and Firefox don't let a secure website reach the radios, which only speak plain HTTP. A small HTTPS proxy on your network gets around that. Muga, from `https://muga.calvellido.es/`, talks to the proxy, and the proxy talks to the radios.

Once it's set up, put its address in **Muga settings → Proxy for the radios**. The rest of Muga works as usual: connect speakers by their IP address, find them on the network, group them.

## What you need

- **A machine that's always on**, at home: a Home Assistant box, a Raspberry Pi, a NAS.
- **A name for it, with a certificate browsers trust:** a name such as `radios.example.com` that points to that machine's local address. Nothing has to be reachable from the internet. The certificate is obtained through a DNS record.
- **Caddy**, the web server, with the [Caddyfile](Caddyfile) from this folder.
- **Fixed addresses for the radios,** for example reserved in your router.

## With Home Assistant

This is the setup Muga was tested with, on a Home Assistant Green.

1. **A name and a certificate, with the DuckDNS add-on.**
   - Sign in at [duckdns.org](https://www.duckdns.org/), create a subdomain, and copy its token.
   - Install the **Duck DNS** add-on (Settings → Add-ons → Add-on store), and set:
     - `domains`: your subdomain, such as `myradios.duckdns.org`;
     - `token`: your token;
     - `lets_encrypt.accept_terms`: `true`, which accepts Let's Encrypt's terms;
     - `ipv4`: Home Assistant's local address, such as `192.168.1.20`. This makes the name point to the box at home instead of your public address.
   - Start it. Its log ends with the certificate saved in `/ssl/fullchain.pem` and `/ssl/privkey.pem`.
2. **Caddy, with the Caddy 2 add-on** ([einschmidt/app-caddy-2](https://github.com/einschmidt/app-caddy-2)).
   - Copy [Caddyfile](Caddyfile) to `/addon_configs/c80c7555_caddy-2/Caddyfile`. Any add-on that can write that folder works: **Terminal & SSH**, **Samba share** or **Studio Code Server**.
   - In it, change `radios.example.com` to your subdomain, and `192.168.1` to your network's range, in both places.
   - Restart the add-on.
3. **A restart after each renewal.** Caddy reads the certificate only when it starts, and DuckDNS renews it 30 days before it expires. The old one stays valid until then, so nothing breaks in between, but Caddy has to be restarted to serve the new one.
   - Add the **Certificate Expiry** integration (Settings → Devices & services) for your name, on port 443. Its sensor shows when the certificate Caddy serves expires.
   - Add this automation, with your sensor's name. Every day, it restarts Caddy if the served certificate expires within 29 days, which means a renewed one is waiting. If it still expires within 10 days afterwards, the renewal isn't working, and it leaves a notification.

   ```yaml
   alias: Restart Caddy after a certificate renewal (Muga)
   triggers:
     - trigger: time
       at: "04:30:00"
   conditions:
     - condition: template
       value_template: >-
         {{ as_timestamp(states('sensor.myradios_duckdns_org_cert_expiry'), 0)
            - as_timestamp(now()) < 29 * 86400 }}
   actions:
     - action: hassio.addon_restart
       data:
         addon: c80c7555_caddy-2
     - delay:
         seconds: 30
     - action: homeassistant.update_entity
       target:
         entity_id: sensor.myradios_duckdns_org_cert_expiry
     - delay:
         seconds: 10
     - if:
         - condition: template
           value_template: >-
             {{ as_timestamp(states('sensor.myradios_duckdns_org_cert_expiry'), 0)
                - as_timestamp(now()) < 10 * 86400 }}
       then:
         - action: persistent_notification.create
           data:
             notification_id: muga_proxy_certificate
             title: Muga proxy certificate
             message: >-
               The proxy's certificate expires on
               {{ states('sensor.myradios_duckdns_org_cert_expiry') }}, and Caddy found no
               renewed one. Check the Duck DNS add-on's log.
   mode: single
   ```

## Check it

- **The proxy:** open `https://<your name>/muga-proxy`. It should show `{"muga":1,"ranges":["192.168.1"]}`, with your range.
- **A radio through it:** open `https://<your name>/<radio IP>/fsapi/GET/netRemote.sys.info.friendlyName?pin=1234`. It should show the radio's name.
- **Muga:** in Muga settings, enter `https://<your name>` under "Proxy for the radios" and choose "Use this proxy". Muga checks it, and then says which addresses it reaches.

## If it doesn't work

- **The name doesn't resolve at home:** some routers refuse names that point to a local address (DNS rebinding protection). Allow your name in the router, or answer it from a local DNS server, such as the AdGuard Home add-on.
- **Away from home:** the proxy is only on your network. To reach it from elsewhere, use a VPN into your network, such as Tailscale.

## Without Home Assistant

Any always-on machine with Caddy works the same way. Get a certificate for your name some other way: Caddy's own DNS challenge with your DNS provider's plugin, or certificates you copy in. Then adjust the `tls` line.

Other proxies work too, if they follow Muga's contract:

- **`GET /muga-proxy`** answers `{"muga":1,"ranges":["192.168.1"]}`, with `Access-Control-Allow-Origin: *`, listing the ranges it reaches.
- **`/<radio IP>/fsapi/…` and `/<radio IP>/device`** are forwarded to `http://<radio IP>/fsapi/…` and `/device`, with the query string, and the radio's headers pass back unchanged.
- **Anything else** is refused.

## Security

- **Nothing is published:** the proxy only answers on your network, and no router ports are opened.
- **Only the radios' interface is forwarded,** and only to addresses in your range. The router's pages and other machines aren't.
- **The PIN** still travels in each request, as with the radios themselves, but now it's encrypted.
- **Anyone on your network** can use the proxy, just as they can reach the radios directly.
