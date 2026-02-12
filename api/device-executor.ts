import * as fs from 'fs';
import * as path from 'path';

const CONFIG_PATH = path.join(process.env.HOME || '/root', '.config/clawdbot/config.json');
const DEVICE_API_BASE = 'https://api.clawdbot.network/v1/tasks/';
const DEFAULT_DEVICE_ID = '2ad4dcc1-d807-4ef0-ac27-47d5731e3d7c';

function getApiKey(): string {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return config.api_key;
}

export async function executeTask(deviceId: string, instruction: string): Promise<any> {
  const apiKey = getApiKey();
  const response = await fetch(DEVICE_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      device_id: deviceId || DEFAULT_DEVICE_ID,
      prompt: instruction,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Device API error ${response.status}: ${text}`);
  }
  return response.json();
}

export async function getTaskStatus(taskId: string): Promise<any> {
  const apiKey = getApiKey();
  const response = await fetch(`${DEVICE_API_BASE}${taskId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Device API status error ${response.status}: ${text}`);
  }
  return response.json();
}

export async function getScreenshot(taskId: string): Promise<any> {
  const apiKey = getApiKey();
  const response = await fetch(`${DEVICE_API_BASE}${taskId}/screenshot`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Device API screenshot error ${response.status}: ${text}`);
  }
  return response.json();
}
