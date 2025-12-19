# 🤖 Proxmox Discord Bot

Self-hosted Discord bot for monitoring and manage Proxmox server.


## 📋 Commands

`/nodes`
`/status [node]`
`/vms [node]` 
`/vm id`
`/start id`
`/stop id`
`/restart id`
`/graph metric [node] [hours]`
`/alerts`
`/setalert metric threshold`
`/logs [node]`


```bash
npm install
cp .env.example .env
npm run dev
```

### Single node

```env
DISCORD_PUBLIC_KEY=xxx
DISCORD_BOT_TOKEN=xxx
DISCORD_APPLICATION_ID=xxx
DISCORD_GUILD_ID=xxx
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

PROXMOX_URL=https://192.168.1.100:8006
PROXMOX_TOKEN_ID=root@pam!discord-bot
PROXMOX_TOKEN_SECRET=xxx
PROXMOX_NODE=pve
```

### Multiple nodes

```env
PROXMOX_NODES=[
  {
    "name": "pve1",
    "url": "https://192.168.1.100:8006",
    "tokenId": "root@pam!discord",
    "tokenSecret": "xxx"
  },
  {
    "name": "pve2", 
    "url": "https://192.168.1.101:8006",
    "tokenId": "root@pam!discord",
    "tokenSecret": "yyy"
  }
]
```

```bash
npm run build
npm start
```

### Systemd

```ini
# /etc/systemd/system/proxmox-bot.service
[Unit]
Description=Proxmox Discord Bot
After=network.target

[Service]
WorkingDirectory=/opt/proxmox-discord-bot
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
