import cron from 'node-cron';
import * as proxmox from './proxmox.js';
import * as db from './database.js';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const CHECK_INTERVAL = process.env.ALERT_CHECK_INTERVAL || '*/5 * * * *';

const alertCooldowns: Map<string, number> = new Map();
const COOLDOWN_MS = 15 * 60 * 1000;

async function sendDiscordAlert(title: string, description: string, color: number = 0xff0000): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn('Discord webhook URL not configured');
    return;
  }

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title,
          description,
          color,
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    console.log(`Alert: ${title}`);
  } catch (error) {
    console.error('Failed to send alert:', error);
  }
}

function getCooldownKey(node: string, metric: string): string {
  return `${node}:${metric}`;
}

function isOnCooldown(node: string, metric: string): boolean {
  const key = getCooldownKey(node, metric);
  const lastAlert = alertCooldowns.get(key);
  if (!lastAlert) return false;
  return Date.now() - lastAlert < COOLDOWN_MS;
}

function setCooldown(node: string, metric: string): void {
  alertCooldowns.set(getCooldownKey(node, metric), Date.now());
}

async function collectMetrics(): Promise<void> {
  try {
    const nodesStatus = await proxmox.getAllNodesStatus();
    
    for (const status of nodesStatus) {
      const memPercent = (status.memory.used / status.memory.total) * 100;
      const diskPercent = (status.disk.used / status.disk.total) * 100;
      
      db.addMetricHistory(status.node, 'cpu', status.cpu);
      db.addMetricHistory(status.node, 'memory', memPercent);
      db.addMetricHistory(status.node, 'disk', diskPercent);
    }
  } catch (error) {
    console.error('Error collecting metrics:', error);
  }
}

async function checkThresholds(): Promise<void> {
  try {
    const nodesStatus = await proxmox.getAllNodesStatus();
    const thresholds = db.getAlertThresholds();

    for (const status of nodesStatus) {
      for (const threshold of thresholds) {
        if (!threshold.enabled) continue;

        let currentValue = 0;
        let metricName = '';

        switch (threshold.metric) {
          case 'cpu':
            currentValue = status.cpu;
            metricName = 'CPU';
            break;
          case 'memory':
            currentValue = (status.memory.used / status.memory.total) * 100;
            metricName = 'RAM';
            break;
          case 'disk':
            currentValue = (status.disk.used / status.disk.total) * 100;
            metricName = 'Disk';
            break;
        }

        if (currentValue >= threshold.threshold) {
          if (!isOnCooldown(status.node, threshold.metric)) {
            const message = `${metricName} on ${status.node}: ${currentValue.toFixed(1)}% (threshold: ${threshold.threshold}%)`;
            
            db.addAlertHistory(threshold.metric, currentValue, threshold.threshold, message);
            
            await sendDiscordAlert(
              `⚠️ ${metricName} Alert`,
              `**${status.node}** exceeded threshold\n${metricName}: **${currentValue.toFixed(1)}%** / ${threshold.threshold}%`,
              0xffaa00
            );
            
            setCooldown(status.node, threshold.metric);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking thresholds:', error);
  }
}

async function checkVMStatus(): Promise<void> {
  try {
    const vms = await proxmox.getVMs();
    const previousStates = db.getConfig('vm_states');
    const prevStatesMap: Record<string, string> = previousStates ? JSON.parse(previousStates) : {};
    const currentStatesMap: Record<string, string> = {};

    for (const vm of vms) {
      const key = `${vm.node}:${vm.vmid}`;
      currentStatesMap[key] = vm.status;

      if (prevStatesMap[key] === 'running' && vm.status === 'stopped') {
        await sendDiscordAlert(
          `🔴 VM Stopped`,
          `**${vm.name || `VM ${vm.vmid}`}** on ${vm.node}`,
          0xff0000
        );
      }

      if (prevStatesMap[key] === 'stopped' && vm.status === 'running') {
        await sendDiscordAlert(
          `🟢 VM Started`,
          `**${vm.name || `VM ${vm.vmid}`}** on ${vm.node}`,
          0x00ff00
        );
      }
    }

    db.setConfig('vm_states', JSON.stringify(currentStatesMap));
  } catch (error) {
    console.error('Error checking VM status:', error);
  }
}

export function startAlertSystem(): void {
  if (!DISCORD_WEBHOOK_URL) {
    console.log('DISCORD_WEBHOOK_URL not set, alerts disabled');
  }

  console.log(`Alert system started (interval: ${CHECK_INTERVAL})`);
  console.log(`Monitoring nodes: ${proxmox.getNodeNames().join(', ')}`);

  cron.schedule(CHECK_INTERVAL, async () => {
    console.log('🔍 Running checks...');
    await collectMetrics();
    await checkThresholds();
    await checkVMStatus();
    db.cleanupOldHistory();
  });

  setTimeout(async () => {
    console.log('Initial data collection...');
    try {
      await Promise.race([
        (async () => {
          await collectMetrics();
          await checkThresholds();
          await checkVMStatus();
          console.log('Initial data collection complete');
        })(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Initial collection timeout')), 30000)
        )
      ]);
    } catch (error) {
      console.error('Initial data collection failed:', error);
      console.log('Bot is running, will retry on next scheduled check');
    }
  }, 5000);
}
