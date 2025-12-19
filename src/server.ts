import 'dotenv/config';

import { Client, GatewayIntentBits, Events, REST, Routes, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import * as db from './database.js';
import * as proxmox from './proxmox.js';
import * as charts from './charts.js';
import { startAlertSystem } from './alerts.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const DISCORD_APP_ID = process.env.DISCORD_APP_ID || '';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('nodes')
    .setDescription('Overview of all Proxmox nodes'),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Node status details')
    .addStringOption(opt => opt.setName('node').setDescription('Node name')
      .addChoices(...proxmox.getNodeNames().map(n => ({ name: n, value: n })))),
  new SlashCommandBuilder()
    .setName('vms')
    .setDescription('List all VMs and containers')
    .addStringOption(opt => opt.setName('node').setDescription('Filter by node')
      .addChoices(...proxmox.getNodeNames().map(n => ({ name: n, value: n })))),
  new SlashCommandBuilder()
    .setName('vm')
    .setDescription('VM/LXC details')
    .addIntegerOption(opt => opt.setName('vmid').setDescription('VM ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Start VM/LXC')
    .addIntegerOption(opt => opt.setName('vmid').setDescription('VM ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop VM/LXC')
    .addIntegerOption(opt => opt.setName('vmid').setDescription('VM ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart VM/LXC')
    .addIntegerOption(opt => opt.setName('vmid').setDescription('VM ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Recent tasks')
    .addStringOption(opt => opt.setName('node').setDescription('Node name')
      .addChoices(...proxmox.getNodeNames().map(n => ({ name: n, value: n })))),
  new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Alert management')
    .addSubcommand(sub => sub.setName('list').setDescription('Show thresholds'))
    .addSubcommand(sub => sub.setName('history').setDescription('Alert history')),
  new SlashCommandBuilder()
    .setName('setalert')
    .setDescription('Set alert threshold')
    .addStringOption(opt => opt.setName('metric').setDescription('Metric').setRequired(true)
      .addChoices({ name: 'CPU', value: 'cpu' }, { name: 'Memory', value: 'memory' }, { name: 'Disk', value: 'disk' }))
    .addIntegerOption(opt => opt.setName('threshold').setDescription('Threshold %').setRequired(true).setMinValue(0).setMaxValue(100))
    .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable/disable')),
  new SlashCommandBuilder()
    .setName('graph')
    .setDescription('Resource graphs for a node')
    .addStringOption(opt => opt.setName('node').setDescription('Node name').setRequired(true)
      .addChoices(...proxmox.getNodeNames().map(n => ({ name: n, value: n }))))
    .addIntegerOption(opt => opt.setName('hours').setDescription('Time period')
      .addChoices({ name: '1h', value: 1 }, { name: '6h', value: 6 }, { name: '24h', value: 24 }, { name: '7d', value: 168 })),
  new SlashCommandBuilder()
    .setName('testproxmox')
    .setDescription('Test Proxmox API connection'),
];

async function registerCommands() {
  const rest = new REST().setToken(DISCORD_TOKEN);
  try {
    console.log('Registering commands...');
    if (DISCORD_GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(DISCORD_APP_ID, DISCORD_GUILD_ID), { body: commands.map(c => c.toJSON()) });
      console.log(`Registered ${commands.length} commands to guild ${DISCORD_GUILD_ID}`);
    } else {
      await rest.put(Routes.applicationCommands(DISCORD_APP_ID), { body: commands.map(c => c.toJSON()) });
      console.log(`Registered ${commands.length} global commands`);
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

async function handleNodes(): Promise<EmbedBuilder> {
  const nodes = await proxmox.getAllNodesStatus();
  const embed = new EmbedBuilder().setTitle('Nodes').setColor(0x2f3136).setTimestamp();
  
  const lines = nodes.map(n => {
    const mem = (n.memory.used / n.memory.total) * 100;
    return `**${n.node}** │ CPU \`${n.cpu.toFixed(0)}%\` │ RAM \`${mem.toFixed(0)}%\` │ Up \`${proxmox.formatUptime(n.uptime)}\``;
  });
  
  embed.setDescription(lines.join('\n') || 'No nodes');
  return embed;
}

async function handleStatus(nodeName?: string): Promise<EmbedBuilder> {
  const s = await proxmox.getNodeStatus(nodeName);
  const mem = (s.memory.used / s.memory.total) * 100;
  const disk = (s.disk.used / s.disk.total) * 100;
  
  const cpuHist = db.getMetricHistory(s.node, 'cpu', 1);
  const memHist = db.getMetricHistory(s.node, 'memory', 1);
  
  const color = s.cpu > 80 ? 0xff0000 : s.cpu > 50 ? 0xffaa00 : 0x00ff00;
  
  return new EmbedBuilder()
    .setTitle(s.node)
    .setColor(color)
    .setDescription([
      `**CPU** \`${charts.createProgressBar(s.cpu)}\` ${s.cpu.toFixed(1)}%  ${charts.createSparkline(cpuHist.map(h => h.value))}`,
      `**RAM** \`${charts.createProgressBar(mem)}\` ${mem.toFixed(1)}%  ${charts.createSparkline(memHist.map(h => h.value))}`,
      `**Disk** \`${charts.createProgressBar(disk)}\` ${disk.toFixed(1)}%`,
      `**Load** \`${s.loadavg.map(l => l.toFixed(2)).join(' ')}\` │ **Up** \`${proxmox.formatUptime(s.uptime)}\``,
    ].join('\n'))
    .setTimestamp();
}

async function handleVMs(nodeName?: string): Promise<EmbedBuilder> {
  const vms = await proxmox.getVMs(nodeName);
  const embed = new EmbedBuilder().setTitle('VMs & Containers').setColor(0x2f3136).setTimestamp();
  
  if (vms.length === 0) {
    embed.setDescription('No VMs found');
    return embed;
  }
  
  const grouped: Record<string, typeof vms> = {};
  for (const vm of vms) {
    if (!grouped[vm.node]) grouped[vm.node] = [];
    grouped[vm.node].push(vm);
  }
  
  const lines: string[] = [];
  for (const [node, list] of Object.entries(grouped)) {
    const vmLine = list.map(vm => {
      const icon = vm.status === 'running' ? '🟢' : '🔴';
      const type = vm.type === 'qemu' ? 'VM' : 'LXC';
      return `${icon}\`${vm.vmid}\` ${vm.name || 'unnamed'} (${type})`;
    }).join(', ');
    lines.push(`**${node}**: ${vmLine}`);
  }
  
  embed.setDescription(lines.join('\n'));
  return embed;
}

async function handleVM(vmid: number): Promise<EmbedBuilder> {
  const vm = await proxmox.getVM(vmid);
  if (!vm) {
    return new EmbedBuilder().setTitle('Not Found').setDescription(`VM ${vmid} not found`).setColor(0xff0000);
  }
  
  const config = await proxmox.getVMConfig(vm.vmid, vm.type, vm.node);
  const icon = vm.status === 'running' ? '🟢' : '🔴';
  
  return new EmbedBuilder()
    .setTitle(`${icon} ${vm.name || `VM ${vm.vmid}`}`)
    .setColor(vm.status === 'running' ? 0x00ff00 : 0xff0000)
    .setDescription([
      `**ID** \`${vm.vmid}\` │ **Type** ${vm.type.toUpperCase()} │ **Node** ${vm.node}`,
      `**Status** ${vm.status} │ **CPU** ${config.cores || config.cpus || 1} cores │ **RAM** ${proxmox.formatBytes((config.memory || 512) * 1024 * 1024)}`,
    ].join('\n'))
    .setTimestamp();
}

async function handleVMAction(vmid: number, action: 'start' | 'stop' | 'restart'): Promise<string> {
  const vm = await proxmox.getVM(vmid);
  if (!vm) return `❌ VM ${vmid} not found`;
  
  try {
    if (action === 'start') await proxmox.startVM(vm.vmid, vm.type, vm.node);
    else if (action === 'stop') await proxmox.stopVM(vm.vmid, vm.type, vm.node);
    else await proxmox.restartVM(vm.vmid, vm.type, vm.node);
    
    const names = { start: 'Starting', stop: 'Stopping', restart: 'Restarting' };
    return `✅ ${names[action]} **${vm.name || `VM ${vm.vmid}`}**`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

async function handleLogs(nodeName?: string): Promise<EmbedBuilder> {
  const tasks = await proxmox.getTasks(nodeName);
  const embed = new EmbedBuilder().setTitle('Recent Tasks').setColor(0x2f3136).setTimestamp();
  
  if (tasks.length === 0) {
    embed.setDescription('No tasks');
    return embed;
  }
  
  const lines = tasks.slice(0, 10).map(t => {
    const date = new Date(t.starttime * 1000).toISOString().slice(0, 16).replace('T', ' ');
    const icon = t.status === 'OK' ? '✅' : '❌';
    return `${icon} \`${date}\` ${t.type} - ${t.id || 'system'}`;
  });
  
  embed.setDescription(lines.join('\n'));
  return embed;
}

async function handleAlertsList(): Promise<EmbedBuilder> {
  const thresholds = db.getAlertThresholds();
  const embed = new EmbedBuilder().setTitle('Alert Thresholds').setColor(0x2f3136).setTimestamp();
  
  const lines = thresholds.map(t => {
    const icon = t.enabled ? '✅' : '❌';
    return `${icon} **${t.metric.toUpperCase()}** ${t.threshold}%`;
  });
  
  embed.setDescription(lines.join('\n') || 'No thresholds set');
  return embed;
}

async function handleAlertsHistory(): Promise<EmbedBuilder> {
  const history = db.getAlertHistory(10);
  const embed = new EmbedBuilder().setTitle('Alert History').setColor(0x2f3136).setTimestamp();
  
  if (history.length === 0) {
    embed.setDescription('No alerts');
    return embed;
  }
  
  const lines = history.map(h => {
    const date = new Date(h.timestamp).toISOString().slice(0, 16).replace('T', ' ');
    return `\`${date}\` ${h.message}`;
  });
  
  embed.setDescription(lines.join('\n'));
  return embed;
}

function handleSetAlert(metric: string, threshold: number, enabled?: boolean): string {
  const isEnabled = enabled ?? true;
  db.updateAlertThreshold(metric, threshold, isEnabled);
  return `✅ **${metric.toUpperCase()}** threshold set to **${threshold}%** (${isEnabled ? 'enabled' : 'disabled'})`;
}

async function handleGraph(nodeName: string, hours: number = 24): Promise<EmbedBuilder> {
  const embed = new EmbedBuilder()
    .setTitle(`${nodeName}`)
    .setColor(0x2f3136)
    .setTimestamp()
    .setFooter({ text: `Last ${hours}h` });
  
  const cpuHist = db.getMetricHistory(nodeName, 'cpu', hours);
  const memHist = db.getMetricHistory(nodeName, 'memory', hours);
  
  if (cpuHist.length === 0 && memHist.length === 0) {
    embed.setDescription('No data collected yet');
    return embed;
  }
  
  const sections: string[] = [];
  
  // CPU Graph
  if (cpuHist.length > 0) {
    const cpuValues = cpuHist.map(h => h.value);
    const cpuStats = charts.getStats(cpuValues);
    sections.push(
      `**CPU**`,
      `\`\`\`${charts.createLineChart(cpuValues, 45, 6)}\`\`\``,
      `Min \`${cpuStats.min.toFixed(1)}%\` Max \`${cpuStats.max.toFixed(1)}%\` Avg \`${cpuStats.avg.toFixed(1)}%\``
    );
  }
  
  // Memory Graph
  if (memHist.length > 0) {
    const memValues = memHist.map(h => h.value);
    const memStats = charts.getStats(memValues);
    sections.push(
      `\n**Memory**`,
      `\`\`\`${charts.createLineChart(memValues, 45, 6)}\`\`\``,
      `Min \`${memStats.min.toFixed(1)}%\` Max \`${memStats.max.toFixed(1)}%\` Avg \`${memStats.avg.toFixed(1)}%\``
    );
  }
  
  embed.setDescription(sections.join('\n'));
  return embed;
}

async function handleTestProxmox(): Promise<EmbedBuilder> {
  const embed = new EmbedBuilder().setTitle('API Test').setColor(0x2f3136).setTimestamp();
  const nodeNames = proxmox.getNodeNames();
  
  if (nodeNames.length === 0) {
    embed.setColor(0xff0000);
    embed.setDescription('❌ No nodes configured\nCheck `.env`: `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET`');
    return embed;
  }

  const results: string[] = [];
  for (const nodeName of nodeNames) {
    const r = await proxmox.testNodeConnection(nodeName);
    if (r.success) {
      results.push(`✅ **${nodeName}** │ ${r.responseTime}ms │ ${r.vmCount} VMs │ CF: ${r.cfAccess ? 'Yes' : 'No'}`);
    } else {
      results.push(`❌ **${nodeName}** │ ${r.error}`);
      embed.setColor(0xff0000);
    }
  }
  
  embed.setDescription(results.join('\n'));
  return embed;
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const { commandName } = interaction;
  console.log(`/${commandName}`);
  
  try {
    await interaction.deferReply();
    let response: EmbedBuilder | string;
    
    switch (commandName) {
      case 'nodes': response = await handleNodes(); break;
      case 'status': response = await handleStatus(interaction.options.getString('node') || undefined); break;
      case 'vms': response = await handleVMs(interaction.options.getString('node') || undefined); break;
      case 'vm': response = await handleVM(interaction.options.getInteger('vmid', true)); break;
      case 'start': response = await handleVMAction(interaction.options.getInteger('vmid', true), 'start'); break;
      case 'stop': response = await handleVMAction(interaction.options.getInteger('vmid', true), 'stop'); break;
      case 'restart': response = await handleVMAction(interaction.options.getInteger('vmid', true), 'restart'); break;
      case 'logs': response = await handleLogs(interaction.options.getString('node') || undefined); break;
      case 'alerts':
        response = interaction.options.getSubcommand() === 'list' ? await handleAlertsList() : await handleAlertsHistory();
        break;
      case 'setalert':
        response = handleSetAlert(
          interaction.options.getString('metric', true),
          interaction.options.getInteger('threshold', true),
          interaction.options.getBoolean('enabled') ?? undefined
        );
        break;
      case 'graph':
        response = await handleGraph(
          interaction.options.getString('node', true),
          interaction.options.getInteger('hours') || 24
        );
        break;
      case 'testproxmox': response = await handleTestProxmox(); break;
      default: response = '❌ Unknown command';
    }
    
    if (typeof response === 'string') {
      await interaction.editReply({ content: response });
    } else {
      await interaction.editReply({ embeds: [response] });
    }
  } catch (error) {
    console.error('Command error:', error);
    await interaction.editReply({ content: `❌ Error: ${error}` });
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`\n╔${'═'.repeat(60)}╗`);
  console.log(`║ 🤖 Proxmox Discord Bot                                     ║`);
  console.log(`║ Logged in as ${c.user.tag.padEnd(45)} ║`);
  console.log(`║ Nodes: ${proxmox.getNodeNames().join(', ').padEnd(51)} ║`);
  console.log(`╚${'═'.repeat(60)}╝\n`);
});

async function init() {

  if (!DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN not set!');
    process.exit(1);
  }
  
  if (proxmox.getNodeNames().length === 0) {
    console.error('No Proxmox nodes configured!');
  }
  
  db.initDatabase();
  await registerCommands();
  startAlertSystem();
  client.login(DISCORD_TOKEN);
}

init();
