import type { MetricHistory } from './types.js';

export function createProgressBar(value: number, max: number = 100, width: number = 10): string {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function createSparkline(values: number[]): string {
  if (values.length === 0) return '';
  
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  return values.slice(-20).map(v => {
    const normalized = (v - min) / range;
    const idx = Math.min(chars.length - 1, Math.floor(normalized * chars.length));
    return chars[idx];
  }).join('');
}

export function createLineChart(values: number[], width: number = 40, height: number = 8): string {
  if (values.length === 0) return 'No data';

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const step = Math.max(1, Math.floor(values.length / width));
  const sampled: number[] = [];
  for (let i = 0; i < values.length; i += step) {
    sampled.push(values[i]);
  }
  while (sampled.length > width) sampled.pop();

  const lines: string[] = [];
  for (let row = height - 1; row >= 0; row--) {
    const threshold = min + (range * row / (height - 1));
    let line = '';
    for (const v of sampled) {
      if (v >= threshold) {
        line += '█';
      } else if (v >= threshold - (range / height)) {
        line += '▄';
      } else {
        line += ' ';
      }
    }
    const label = row === height - 1 ? `${max.toFixed(0)}%` : row === 0 ? `${min.toFixed(0)}%` : '';
    lines.push(`${label.padStart(4)} │${line}`);
  }
  lines.push(`     └${'─'.repeat(sampled.length)}`);

  return lines.join('\n');
}

export function createMultiLineChart(
  datasets: { name: string; values: number[] }[],
  width: number = 40,
  height: number = 8
): string {
  if (datasets.length === 0) return 'No data';

  const lines: string[] = [];
  const symbols = ['█', '▓', '▒', '░', '▪'];

  lines.push(datasets.map((d, i) => `${symbols[i % symbols.length]} ${d.name}`).join('  '));
  lines.push('');

  const allValues = datasets.flatMap(d => d.values);
  const max = Math.max(...allValues, 1);
  const min = Math.min(...allValues, 0);
  const range = max - min || 1;

  const sampledSets = datasets.map(d => {
    const step = Math.max(1, Math.floor(d.values.length / width));
    const sampled: number[] = [];
    for (let i = 0; i < d.values.length; i += step) {
      sampled.push(d.values[i]);
    }
    while (sampled.length > width) sampled.pop();
    return sampled;
  });

  const chartWidth = Math.max(...sampledSets.map(s => s.length));

  for (let row = height - 1; row >= 0; row--) {
    const threshold = min + (range * row / (height - 1));
    let line = '';
    for (let col = 0; col < chartWidth; col++) {
      let char = ' ';
      for (let di = 0; di < sampledSets.length; di++) {
        const v = sampledSets[di][col];
        if (v !== undefined && v >= threshold) {
          char = symbols[di % symbols.length];
          break;
        }
      }
      line += char;
    }
    const label = row === height - 1 ? `${max.toFixed(0)}%` : row === 0 ? `${min.toFixed(0)}%` : '';
    lines.push(`${label.padStart(4)} │${line}`);
  }
  lines.push(`     └${'─'.repeat(chartWidth)}`);

  return lines.join('\n');
}

export function getStats(values: number[]): { min: number; max: number; avg: number } {
  if (values.length === 0) return { min: 0, max: 0, avg: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { min, max, avg };
}

export function generateAsciiChart(
  data: MetricHistory[], 
  title: string,
  width: number = 40,
  height: number = 10
): string {
  if (data.length === 0) return 'No data available.';
  const values = data.map(d => d.value);
  return createLineChart(values, width, height);
}

export function generateSparkline(values: number[]): string {
  return createSparkline(values);
}
