# Deploy the whole app on Oracle Cloud (Always Free)

One server runs everything:

- the **web app** (the visualiser), served by Caddy with automatic HTTPS;
- the **room-detection backend** with the large model, reached by the web app at `/api`.

Oracle's Always Free tier includes an Arm (Ampere A1) virtual machine with up to **4 cores and 24 GB
of RAM**, free indefinitely, which is more than this app needs. You need an Oracle account (a card
is asked for at sign-up, for verification only), and optionally a domain name for HTTPS.

Time: about 30 minutes of clicking and typing, plus 15 to 25 minutes for the first build.

---

## 1. Create the Oracle Cloud account

1. Go to <https://www.oracle.com/cloud/free/> and click **Start for free**.
2. Fill in the form and verify your card (a small temporary hold may appear; Always Free resources
   are not charged).
3. Choose your **home region** carefully: it cannot be changed later, and Always Free Arm machines
   can only be created there. Pick the one closest to your customers (for India: *India West
   (Mumbai)* or *India South (Hyderabad)*).

> Recommended: after sign-up, upgrade the account to **Pay As You Go** (Billing → Upgrade). Always
> Free resources stay free, but Oracle then never reclaims an idle free machine and "out of capacity"
> errors become rare. Set a budget alert of 1 (your currency) under Billing → Budgets so you hear
> about any charge immediately.

## 2. Create the virtual machine

1. In the console menu: **Compute → Instances → Create instance**.
2. **Name**: `tiles-visualiser`.
3. **Image and shape → Edit**:
   - **Image**: *Canonical Ubuntu 24.04* (the Arm/aarch64 build is selected automatically with the
     shape below).
   - **Shape**: *Ampere → VM.Standard.A1.Flex*, **4 OCPUs**, **24 GB** memory.
4. **Networking**: *Create new virtual cloud network* and *Create new public subnet*; keep
   **Assign a public IPv4 address** switched on.
5. **Add SSH keys**: *Generate a key pair for me* → **Save private key** (keep this file safe; it
   is the only way into the server).
6. **Boot volume**: tick *Specify a custom boot volume size* and enter **100 GB** (Always Free
   includes 200 GB in total).
7. Click **Create**. After a minute the instance is *Running*; copy its **Public IP address**.

If you see **"Out of capacity for shape VM.Standard.A1.Flex"**, Oracle has no free Arm machines in
that data centre right now: try another *Availability domain* in step 4, or try again later (or
upgrade to Pay As You Go, see above).

## 3. Open the web ports

Oracle blocks everything except SSH by default, in two places.

**a) In the cloud firewall**

1. On the instance page click the **subnet** link → **Security Lists** → *Default Security List*.
2. **Add Ingress Rules**, one for each port:

   | Source CIDR | IP protocol | Destination port |
   |---|---|---|
   | `0.0.0.0/0` | TCP | `80` |
   | `0.0.0.0/0` | TCP | `443` |

**b) On the machine itself** (step 4 shows how to log in; run this once):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 4. Log in to the server

On your computer, in a terminal (on Windows: PowerShell), with the key saved in step 2:

```bash
chmod 600 ~/Downloads/ssh-key-*.key
```

```bash
ssh -i ~/Downloads/ssh-key-*.key ubuntu@YOUR_PUBLIC_IP
```

Answer `yes` the first time. All following commands run on the server.

## 5. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker ubuntu
```

Log out (`exit`) and log in again (step 4) so the group change applies, then check:

```bash
docker run --rm hello-world
```

## 6. Get the code

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

## 7. Point a domain at the server (recommended)

HTTPS needs a domain name. Use one you own, or a free subdomain:

- **Your own domain**: in your DNS provider add an **A record**, e.g. `tiles` →
  `YOUR_PUBLIC_IP`, giving `tiles.yourshop.com`.
- **Free**: sign in at <https://www.duckdns.org>, create a subdomain (e.g. `mytiles`) and set its
  IP to `YOUR_PUBLIC_IP`, giving `mytiles.duckdns.org`.

Wait until `ping tiles.yourshop.com` answers with your server's IP (usually a few minutes).

You can skip this step and use the bare IP address over plain `http://` for a first test.

## 8. Start the app

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

## 9. Check it

On the server:

```bash
curl http://localhost/api/health
```

should print `{"ok":true,"model":"large","queue":0}`.

In your browser open `https://tiles.yourshop.com` (or `http://YOUR_PUBLIC_IP`), choose **Upload
your room → Detect room automatically** with a room photo. Detection should take about 20 to 30 s (30 s measured with this setup on a 4-core test machine).
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
| Browser cannot reach the site | Ports not open: redo step 3 (both a and b). |
| `docker compose` fails with "permission denied" | Log out and in again after step 5. |
| Caddy log: "could not get certificate" | The domain does not point at the server yet (step 7), or port 80 is closed. Caddy retries by itself. |
| Detection is slow (over a minute) | Check the backend uses the large model and 4 threads: `docker compose logs detect \| head`. |
| "Out of capacity" when creating the machine | See the note at the end of step 2. |
| Build stops with "No space left on device" | The boot volume is too small: set 100 GB (step 2), or `docker builder prune -a` to clear old build data. |
