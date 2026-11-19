# Deploy the whole app on a rented server (Hostinger, DigitalOcean, any Ubuntu VPS)

One server runs everything:

- the **web app** (the visualiser), served by Caddy with automatic HTTPS;
- the **room-detection backend** with the large model, reached by the web app at `/api`.

What the server needs: **2+ CPU cores, 4 GB RAM or more (8 GB recommended), 40 GB disk**, Ubuntu
22.04 or 24.04, a public IP. Tested on an ordinary Intel/AMD (x86) machine.

| Provider | Plan | Payment | Price (check before buying) |
|---|---|---|---|
| Hostinger VPS (India) | KVM 2: 2 vCPU, 8 GB, 100 GB | UPI, net banking, Indian debit cards | ~₹799/month intro, ~₹1,199 renewal, + GST |
| DigitalOcean | Basic Droplet 2 vCPU / 4 GB | Visa, Mastercard, Amex, PayPal, Google Pay | $24/month (AMD $21) |
| Oracle Cloud Always Free | A1 Arm, 4 cores / 24 GB | Visa / Mastercard credit card only | free (see `DEPLOY-ORACLE.md`) |

Time: about 20 minutes, plus 15 to 25 minutes for the first build.

---

## 1. Rent the server

**Hostinger**: hostinger.in → VPS Hosting → **KVM 2** → choose the term → pay. In the setup wizard
pick the data centre closest to your customers (India: Mumbai), operating system **Ubuntu 24.04**
(plain; or the "Ubuntu 24.04 with Docker" template, then skip step 4), and set a root password.
Copy the server's **IP address** from hPanel → VPS → Overview.

**DigitalOcean**: digitalocean.com → Create → **Droplets** → region Bangalore → image **Ubuntu
24.04** → Basic, Regular/Premium AMD, **2 vCPU / 4 GB** → authentication: password or SSH key →
Create. Copy the Droplet's **IP address**. With 4 GB, add swap once logged in (step 3):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Make sure the web ports are open

The app needs TCP **80** and **443** open to everyone.

- **Hostinger**: hPanel → VPS → **Security → Firewall**. If a firewall is active, add *Accept*
  rules for TCP 80 and 443 (SSH 22 must stay open). With no firewall configured, all ports are open.
- **DigitalOcean**: Droplets have no firewall unless you create one (Networking → Firewalls); if you
  do, allow inbound TCP 22, 80 and 443.

## 3. Log in to the server

On your computer, in a terminal (on Windows: PowerShell), with the user name your provider gave
you (Hostinger: `root`; DigitalOcean: `root`):

```bash
ssh root@YOUR_SERVER_IP
```

Enter the password you set (or add `-i path/to/key` if you chose an SSH key). Answer `yes` the
first time. All following commands run on the server.

## 4. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
```

(If you log in as a user other than `root`, also run `sudo usermod -aG docker $USER`, then log
out and in again.) Check:

```bash
docker run --rm hello-world
```

## 5. Get the code

The GitHub repository is private, so GitHub needs a token:

1. On GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token**, repository access *Only select repositories* → `Tiles_visualiser`,
   permission **Contents: Read-only**. Copy the token.
2. On the server:

```bash
git clone https://github.com/mitul013/Tiles_visualiser.git
```

When asked, the username is your GitHub name and the password is the token. Then:

```bash
cd Tiles_visualiser
```

```bash
git checkout claude/tiles-visualizer-room-detection-ix11tv
```

(Once that branch is merged, use `main` instead.)

## 6. Point a domain at the server (recommended)

HTTPS needs a domain name. Use one you own, or a free subdomain:

- **Your own domain**: in your DNS provider add an **A record**, e.g. `tiles` →
  `YOUR_PUBLIC_IP`, giving `tiles.yourshop.com`.
- **Free**: sign in at <https://www.duckdns.org>, create a subdomain (e.g. `mytiles`) and set its
  IP to `YOUR_PUBLIC_IP`, giving `mytiles.duckdns.org`.

Wait until `ping tiles.yourshop.com` answers with your server's IP (usually a few minutes).

You can skip this step and use the bare IP address over plain `http://` for a first test.

## 7. Start the app

```bash
cd deploy
```

With a domain (HTTPS is set up automatically by Caddy):

```bash
SITE_ADDRESS=tiles.yourshop.com docker compose up -d --build
```

Without a domain (plain http on the IP address):

```bash
docker compose up -d --build
```

The first build takes **15 to 25 minutes**: it exports the large detection model from its public
checkpoint once (Docker keeps the result, later builds take a few minutes). Follow it with:

```bash
docker compose logs -f
```

The app is ready when the log shows `room detection service on http://localhost:7860`. Press
Ctrl+C to stop following the log (the app keeps running).

## 8. Check it

On the server:

```bash
curl http://localhost/api/health
```

should print `{"ok":true,"model":"large","queue":0}`.

In your browser open `https://tiles.yourshop.com` (or `http://YOUR_PUBLIC_IP`), choose **Upload
your room → Detect room automatically** with a room photo. Detection should take about 20 to 40 s depending on the server's cores (30 s measured with this setup on a 4-core test machine).
The backend's own demo page is at `/api/`.

## Everyday operations

| Task | Command (in `~/Tiles_visualiser/deploy`) |
|---|---|
| Update to the latest code | `git pull` then `SITE_ADDRESS=tiles.yourshop.com docker compose up -d --build` |
| See status | `docker compose ps` |
| See logs | `docker compose logs --tail 100` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` |

The app restarts by itself after a crash or a server reboot (`restart: unless-stopped`; Docker
starts at boot).

## Embedding in your shop

The whole app is now at your domain. To show it inside your website, embed it as before
(`public/embed.js`, see README), pointing at `https://tiles.yourshop.com`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Browser cannot reach the site | Ports 80/443 are closed in the provider's firewall: see step 2. |
| `docker compose` fails with "permission denied" | Log out and in again after step 4. |
| Caddy log: "could not get certificate" | The domain does not point at the server yet (step 6), or port 80 is closed. Caddy retries by itself. |
| Detection is slow (over a minute) | Check the backend uses the large model and 4 threads: `docker compose logs detect \| head`. |
| Build stops with "No space left on device" | The disk is too small (needs about 25 GB free), or clear old build data with `docker builder prune -a`. |
