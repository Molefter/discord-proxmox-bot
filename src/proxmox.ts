import https from 'https';
import type { ProxmoxNode, ProxmoxNodeStatus, ProxmoxVM, ProxmoxTask } from './types.js';

function parseNodes(): ProxmoxNode[] {
  const nodesJson = process.env.PROXMOX_NODES;
  
  if (nodesJson) {
    try {
      return JSON.parse(nodesJson);
    } catch {
      console.error('Failed to parse PROXMOX_NODES JSON');
    }
  }

  const url = process.env.PROXMOX_URL;
  const tokenId = process.env.PROXMOX_TOKEN_ID;
  const tokenSecret = process.env.PROXMOX_TOKEN_SECRET;
  const name = process.env.PROXMOX_NODE || 'pve';

  if (url && tokenId && tokenSecret) {
    const cfAccessEnabled = process.env.CF_ACCESS_ENABLED === 'true';
    const cfAccessClientId = process.env.CF_ACCESS_CLIENT_ID;
    const cfAccessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

    return [{
      name,
      url,
      tokenId,
      tokenSecret,
      cfAccessEnabled,
      cfAccessClientId,
      cfAccessClientSecret,
    }];
  }

  return [];
}

export const nodes: ProxmoxNode[] = parseNodes();

const agent = new https.Agent({
  rejectUnauthorized: false
});

const FETCH_TIMEOUT_MS = 15000; // 15 seconds timeout

async function proxmoxFetch<T>(node: ProxmoxNode, endpoint: string, method: string = 'GET'): Promise<T> {
  const url = `${node.url}/api2/json${endpoint}`;
  
  const headers: Record<string, string> = {
    'Authorization': `PVEAPIToken=${node.tokenId}=${node.tokenSecret}`,
  };

  if (node.cfAccessEnabled && node.cfAccessClientId && node.cfAccessClientSecret) {
    headers['CF-Access-Client-Id'] = node.cfAccessClientId;
    headers['CF-Access-Client-Secret'] = node.cfAccessClientSecret;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
      agent,
    });

    if (!response.ok) {
      throw new Error(`Proxmox API error (${node.name}): ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { data: T };
    return data.data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Timeout connecting to ${node.name} (${FETCH_TIMEOUT_MS / 1000}s)`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getNode(name?: string): ProxmoxNode | undefined {
  if (!name) return nodes[0];
  return nodes.find(n => n.name.toLowerCase() === name.toLowerCase());
}

export function getNodeNames(): string[] {
  return nodes.map(n => n.name);
}

export async function getNodeStatus(nodeName?: string): Promise<ProxmoxNodeStatus> {
  const node = getNode(nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found`);

  const status = await proxmoxFetch<any>(node, `/nodes/${node.name}/status`);
  
  return {
    node: node.name,
    cpu: status.cpu * 100,
    memory: {
      used: status.memory.used,
      total: status.memory.total,
      free: status.memory.free,
    },
    disk: {
      used: status.rootfs.used,
      total: status.rootfs.total,
      free: status.rootfs.free,
    },
    uptime: status.uptime,
    loadavg: status.loadavg || [0, 0, 0],
  };
}

export async function getAllNodesStatus(): Promise<ProxmoxNodeStatus[]> {
  const results = await Promise.allSettled(
    nodes.map(node => getNodeStatus(node.name))
  );
  
  return results
    .filter((r): r is PromiseFulfilledResult<ProxmoxNodeStatus> => r.status === 'fulfilled')
    .map(r => r.value);
}

let lastNodeErrors: Map<string, string> = new Map();

export function getLastNodeErrors(): Map<string, string> {
  return lastNodeErrors;
}

export async function getVMs(nodeName?: string): Promise<ProxmoxVM[]> {
  const targetNodes = nodeName ? [getNode(nodeName)].filter(Boolean) as ProxmoxNode[] : nodes;
  lastNodeErrors = new Map();
  
  const allVMs: ProxmoxVM[] = [];
  
  for (const node of targetNodes) {
    try {
      console.log(`Fetching VMs from node "${node.name}" via /nodes/${node.name}/qemu and /nodes/${node.name}/lxc`);
      const [qemu, lxc] = await Promise.all([
        proxmoxFetch<any[]>(node, `/nodes/${node.name}/qemu`),
        proxmoxFetch<any[]>(node, `/nodes/${node.name}/lxc`),
      ]);

      console.log(`Node "${node.name}": Found ${qemu.length} QEMU VMs, ${lxc.length} LXC containers`);
      
      allVMs.push(
        ...qemu.map(vm => ({ ...vm, type: 'qemu' as const, node: node.name })),
        ...lxc.map(vm => ({ ...vm, type: 'lxc' as const, node: node.name })),
      );
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      console.error(`Failed to get VMs from "${node.name}":`, errorMsg);
      lastNodeErrors.set(node.name, errorMsg);
    }
  }

  if (allVMs.length === 0 && lastNodeErrors.size > 0) {
    console.warn(`No VMs found and ${lastNodeErrors.size} node(s) had errors. Check PROXMOX_NODE configuration.`);
  }

  return allVMs.sort((a, b) => a.vmid - b.vmid);
}

export async function testNodeConnection(nodeName?: string): Promise<{
  node: string;
  success: boolean;
  responseTimeMs?: number;
  qemuCount?: number;
  lxcCount?: number;
  error?: string;
}> {
  const node = getNode(nodeName);
  if (!node) {
    return { node: nodeName || 'unknown', success: false, error: 'Node not found in configuration' };
  }

  const startTime = Date.now();
  try {
    const [qemu, lxc] = await Promise.all([
      proxmoxFetch<any[]>(node, `/nodes/${node.name}/qemu`),
      proxmoxFetch<any[]>(node, `/nodes/${node.name}/lxc`),
    ]);
    
    return {
      node: node.name,
      success: true,
      responseTimeMs: Date.now() - startTime,
      qemuCount: qemu.length,
      lxcCount: lxc.length,
    };
  } catch (error: any) {
    return {
      node: node.name,
      success: false,
      responseTimeMs: Date.now() - startTime,
      error: error.message || String(error),
    };
  }
}

export async function getVM(vmid: number, nodeName?: string): Promise<ProxmoxVM | null> {
  const vms = await getVMs(nodeName);
  return vms.find(vm => vm.vmid === vmid) || null;
}

export async function getVMConfig(vmid: number, type: 'qemu' | 'lxc', nodeName: string): Promise<any> {
  const node = getNode(nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found`);
  return proxmoxFetch(node, `/nodes/${node.name}/${type}/${vmid}/config`);
}

export async function startVM(vmid: number, type: 'qemu' | 'lxc', nodeName: string): Promise<string> {
  const node = getNode(nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found`);
  return proxmoxFetch(node, `/nodes/${node.name}/${type}/${vmid}/status/start`, 'POST');
}

export async function stopVM(vmid: number, type: 'qemu' | 'lxc', nodeName: string): Promise<string> {
  const node = getNode(nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found`);
  return proxmoxFetch(node, `/nodes/${node.name}/${type}/${vmid}/status/stop`, 'POST');
}

export async function restartVM(vmid: number, type: 'qemu' | 'lxc', nodeName: string): Promise<string> {
  const node = getNode(nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found`);
  const endpoint = type === 'qemu' ? 'reboot' : 'restart';
  return proxmoxFetch(node, `/nodes/${node.name}/${type}/${vmid}/status/${endpoint}`, 'POST');
}

export async function getTasks(nodeName?: string, limit: number = 10): Promise<ProxmoxTask[]> {
  const node = getNode(nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found`);
  return proxmoxFetch<ProxmoxTask[]>(node, `/nodes/${node.name}/tasks?limit=${limit}`);
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;
  
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  
  return parts.join(' ') || '< 1m';
}
