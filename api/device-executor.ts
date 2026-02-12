import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';

/**
 * Device Executor — Uses DroidRun OSS (https://github.com/droidrun/droidrun)
 * 
 * DroidRun is an open-source Android agent framework that lets LLMs control
 * real phones via ADB. No cloud API, no paid service — runs fully local.
 * 
 * Prerequisites:
 *   - ADB installed and device connected (USB or WiFi)
 *   - DroidRun agent installed on target device
 *   - Python 3.10+ with `pip install droidrun`
 */

const CONFIG_PATH = path.join(process.env.HOME || '/root', '.config/clawdbot/config.json');

interface DeviceConfig {
  /** ADB device serial or IP:port for WiFi ADB */
  adb_target: string;
  /** LLM provider to use (e.g. 'openai', 'anthropic') */
  llm_provider?: string;
  /** LLM model name */
  llm_model?: string;
}

interface ClawdbotConfig {
  devices: Record<string, DeviceConfig>;
  default_device?: string;
  llm_api_key?: string;
}

function loadConfig(): ClawdbotConfig {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return config;
}

/**
 * List ADB-connected devices
 */
export function listConnectedDevices(): string[] {
  const output = execSync('adb devices', { encoding: 'utf-8' });
  const lines = output.trim().split('\n').slice(1); // skip header
  return lines
    .map(line => line.split('\t'))
    .filter(parts => parts[1] === 'device')
    .map(parts => parts[0]);
}

/**
 * Connect to a device over WiFi ADB
 */
export function connectDevice(ipPort: string): boolean {
  try {
    const output = execSync(`adb connect ${ipPort}`, { encoding: 'utf-8' });
    return output.includes('connected');
  } catch {
    return false;
  }
}

/**
 * Execute a task on a real phone using DroidRun OSS via ADB.
 * 
 * DroidRun runs as a Python CLI that controls the device through ADB.
 * The phone must have the DroidRun agent app installed and ADB enabled.
 */
export async function executeTask(deviceId: string, instruction: string): Promise<any> {
  const config = loadConfig();
  const deviceKey = deviceId || config.default_device || Object.keys(config.devices)[0];
  const device = config.devices[deviceKey];

  if (!device) {
    throw new Error(`Device "${deviceKey}" not found in config. Available: ${Object.keys(config.devices).join(', ')}`);
  }

  // Ensure device is connected via ADB
  const connected = listConnectedDevices();
  if (!connected.includes(device.adb_target)) {
    const ok = connectDevice(device.adb_target);
    if (!ok) {
      throw new Error(`Cannot connect to device ${device.adb_target} via ADB. Ensure device is on the same network with ADB enabled.`);
    }
  }

  // Run DroidRun CLI to execute the task locally
  // See: https://github.com/droidrun/droidrun
  const args = [
    '-m', 'droidrun',
    '--device', device.adb_target,
    '--task', instruction,
  ];

  if (device.llm_model) {
    args.push('--model', device.llm_model);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('python3', args, {
      env: {
        ...process.env,
        ...(config.llm_api_key ? { OPENAI_API_KEY: config.llm_api_key } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code: number) => {
      if (code === 0) {
        resolve({
          status: 'completed',
          device: deviceKey,
          adb_target: device.adb_target,
          output: stdout.trim(),
          steps: stdout.split('\n').filter(l => l.includes('Step')).length,
        });
      } else {
        reject(new Error(`DroidRun exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Get a screenshot from the device via ADB (no cloud API needed).
 */
export async function getScreenshot(deviceId: string): Promise<Buffer> {
  const config = loadConfig();
  const deviceKey = deviceId || config.default_device || Object.keys(config.devices)[0];
  const device = config.devices[deviceKey];

  if (!device) {
    throw new Error(`Device "${deviceKey}" not found in config.`);
  }

  const tmpPath = `/tmp/screenshot-${Date.now()}.png`;
  execSync(`adb -s ${device.adb_target} exec-out screencap -p > ${tmpPath}`);
  const data = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);
  return data;
}

/**
 * Check if DroidRun is installed and available.
 */
export function checkDroidRunInstalled(): boolean {
  try {
    execSync('python3 -m droidrun --help', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
