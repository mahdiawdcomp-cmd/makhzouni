# Inventory System Deployment

## Docker Compose

From `D:\fullstak app new`:

```powershell
docker-compose up --build
```

Services:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:5000`
- Health check: `http://localhost:5000/health`
- PostgreSQL: `localhost:5432`

The backend runs Prisma migrations automatically on container start.

## Backend `.env.example`

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/inventory_backend?schema=public"
PORT=5000
NODE_ENV=development
JWT_SECRET="change-this-secret-before-production"
JWT_EXPIRES_IN="30d"
BCRYPT_SALT_ROUNDS=10
```

## Hostinger VPS Deployment

1. Buy a small Ubuntu VPS.
2. Point your domain DNS `A` record to the VPS IP.
3. SSH into the server:

```bash
ssh root@YOUR_SERVER_IP
```

4. Install Docker:

```bash
apt update
apt install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

5. Upload or clone the project to `/opt/inventory-system`.
6. Edit `docker-compose.yml` and replace `JWT_SECRET`.
7. Start:

```bash
cd /opt/inventory-system
docker compose up --build -d
docker compose logs -f
```

## Railway Deployment

1. Create a Railway project.
2. Add a PostgreSQL database.
3. Add a backend service from `inventory-backend`.
4. Set backend variables:

```env
DATABASE_URL=Railway_Postgres_URL
PORT=5000
NODE_ENV=production
JWT_SECRET=long-random-secret
JWT_EXPIRES_IN=30d
BCRYPT_SALT_ROUNDS=10
```

5. Backend build command:

```bash
npm ci && npx prisma generate && npm run build
```

6. Backend start command:

```bash
npm run prisma:deploy && npm run start
```

7. Add a frontend service from `inventory-web`.
8. Set:

```env
VITE_API_URL=https://YOUR_BACKEND_DOMAIN/api
```

9. Frontend build command:

```bash
npm ci && npm run build
```

10. Frontend output directory:

```text
dist
```

## SSL With Let's Encrypt

On Hostinger VPS, install Nginx and Certbot:

```bash
apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/inventory`:

```nginx
server {
  listen 80;
  server_name your-domain.com www.your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable it:

```bash
ln -s /etc/nginx/sites-available/inventory /etc/nginx/sites-enabled/inventory
nginx -t
systemctl reload nginx
certbot --nginx -d your-domain.com -d www.your-domain.com
```

Renewal test:

```bash
certbot renew --dry-run
```
