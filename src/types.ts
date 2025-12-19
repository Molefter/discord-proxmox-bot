export interface ProxmoxNode {
  name: string;
  url: string;
  tokenId: string;
  tokenSecret: string;
  cfAccessEnabled?: boolean;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

export interface ProxmoxNodeStatus {
  node: string;
  cpu: number;
  memory: {
    used: number;
    total: number;
    free: number;
  };
  disk: {
    used: number;
    total: number;
    free: number;
  };
  uptime: number;
  loadavg: number[];
}

export interface ProxmoxVM {
  vmid: number;
  name: string;
  status: 'running' | 'stopped' | 'paused';
  type: 'qemu' | 'lxc';
  node: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  netin: number;
  netout: number;
}

export interface ProxmoxTask {
  upid: string;
  node: string;
  pid: number;
  pstart: number;
  starttime: number;
  type: string;
  id: string;
  user: string;
  status?: string;
}

// Alert types
export interface AlertThreshold {
  id: number;
  metric: 'cpu' | 'memory' | 'disk';
  threshold: number;
  enabled: boolean;
  created_at: string;
}

export interface AlertHistory {
  id: number;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  created_at: string;
}

export interface MetricHistory {
  id: number;
  node: string;
  metric: string;
  value: number;
  created_at: string;
}

export interface BotConfig {
  key: string;
  value: string;
}

// Discord types
export interface DiscordInteraction {
  type: number;
  id: string;
  token: string;
  data?: {
    name: string;
    options?: Array<{
      name: string;
      value: string | number;
    }>;
  };
  guild_id?: string;
  channel_id?: string;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
  timestamp?: string;
  image?: {
    url: string;
  };
}
