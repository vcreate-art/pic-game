# Deploying pic-game to EC2

One-time setup on the EC2 instance (Ubuntu), plus the GitHub Actions secrets
needed for automatic deploys on push to `develop`.

## 1. Install Node 20

The server bundle targets Node 20 (`apps/server/build.mjs`), so install it via
NodeSource rather than relying on whatever Ubuntu ships:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should print v20.x
```

## 2. Install pm2 and register it with systemd

```bash
sudo npm install -g pm2
pm2 startup   # prints a sudo command — copy/paste and run it, this is what
              # makes pm2 come back up after a reboot
```

## 3. First-time app bootstrap

```bash
cd ~/pic-game
npm ci
npm run build

# production env for the server (see README "Production" section)
cat > apps/server/.env <<'EOF'
PORT=3001
CLIENT_ORIGIN=https://example.com
EOF

pm2 start ecosystem.config.cjs
pm2 save   # persists the process list pm2 startup restores on boot
```

Sanity check: `pm2 status` should show `pic-game` as `online`, and
`curl -f http://127.0.0.1:3001/health` should return 200.

## 4. Install nginx as the reverse proxy

```bash
sudo apt-get install -y nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/pic-game
sudo sed -i 's/example.com/YOUR_DOMAIN/' /etc/nginx/sites-available/pic-game
sudo ln -s /etc/nginx/sites-available/pic-game /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 5. TLS via Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
```

Certbot rewrites `/etc/nginx/sites-available/pic-game` to add the 443 server
block and an 80→443 redirect, and installs its own renewal timer.

## 6. Security group

In the EC2 console, open inbound **80** and **443** to `0.0.0.0/0`. Port
**3001** does not need to be public — nginx is the only thing that should talk
to it — so close it if it's currently open.

## 7. Set up GitHub Actions deploy access

Generate a deploy-only keypair (don't reuse your personal one):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pic-game-deploy -N ""
cat ~/.ssh/pic-game-deploy.pub >> ~/.ssh/authorized_keys
```

Copy the *private* key (`cat ~/.ssh/pic-game-deploy`) and add these repo
secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `EC2_HOST` | instance public IP or DNS name |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | contents of `pic-game-deploy` (the private key) |
| `EC2_SSH_PORT` | `22` (optional, defaults to 22) |

Once these are set, every push to `develop` runs the `build` job (typecheck,
build, tests) and then, on success, the `deploy` job: it SSHes in, pulls
`develop`, rebuilds, and restarts pm2. See
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

## Everyday operations

```bash
pm2 status              # is it running?
pm2 logs pic-game        # tail logs
pm2 restart pic-game     # manual restart
curl -f http://127.0.0.1:3001/health   # local health check
```
