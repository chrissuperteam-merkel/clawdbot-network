import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { executeTask, getTaskStatus, getScreenshot } from './device-executor';

// Try to import Solana contract helpers (optional)
let registerDeviceOnChain: ((wallet: string, deviceId: string) => Promise<any>) | null = null;
let releasePaymentOnChain: ((taskId: string, reward: number, recipient: string) => Promise<any>) | null = null;
try {
  const contracts = require('../contracts');
  registerDeviceOnChain = contracts.registerDevice;
  releasePaymentOnChain = contracts.releasePayment;
} catch {
  console.warn('[WARN] Solana contracts not found — on-chain calls will be skipped');
}

// Types
interface Device {
  deviceId: string;
  name: string;
  capabilities: string[];
  wallet: string;
  status: 'available' | 'busy';
  registeredAt: string;
}

interface Task {
  taskId: string;
  description: string;
  reward_lamports: number;
  creator_wallet: string;
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
  assignedDevice?: string;
  deviceTaskId?: string;
  resultHash?: string;
  screenshotUrl?: string;
  createdAt: string;
  completedAt?: string;
}

// In-memory state
const devices = new Map<string, Device>();
const tasks = new Map<string, Task>();

const app = express();
app.use(cors());
app.use(express.json());

// Health
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', devices: devices.size, tasks: tasks.size, timestamp: new Date().toISOString() });
});

// List devices
app.get('/api/devices', (_req, res) => {
  res.json(Array.from(devices.values()));
});

// Register device
app.post('/api/devices/register', async (req, res) => {
  try {
    const { deviceId, name, capabilities, wallet } = req.body;
    if (!deviceId || !name || !wallet) {
      return res.status(400).json({ error: 'deviceId, name, and wallet are required' });
    }

    const device: Device = {
      deviceId,
      name,
      capabilities: capabilities || [],
      wallet,
      status: 'available',
      registeredAt: new Date().toISOString(),
    };
    devices.set(deviceId, device);

    // Register on-chain (fire and forget)
    if (registerDeviceOnChain) {
      registerDeviceOnChain(wallet, deviceId).catch(err =>
        console.error('[Solana] Register device failed:', err.message)
      );
    }

    res.json({ success: true, device });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List tasks
app.get('/api/tasks', (_req, res) => {
  res.json(Array.from(tasks.values()));
});

// Create task
app.post('/api/tasks/create', (req, res) => {
  try {
    const { description, reward_lamports, creator_wallet } = req.body;
    if (!description || !creator_wallet) {
      return res.status(400).json({ error: 'description and creator_wallet are required' });
    }

    const task: Task = {
      taskId: uuidv4(),
      description,
      reward_lamports: reward_lamports || 0,
      creator_wallet,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    tasks.set(task.taskId, task);
    res.json({ success: true, task });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Assign task
app.post('/api/tasks/:taskId/assign', async (req, res) => {
  try {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'pending') return res.status(400).json({ error: `Task is ${task.status}, not pending` });

    // Find available device
    const availableDevice = Array.from(devices.values()).find(d => d.status === 'available');
    if (!availableDevice) return res.status(400).json({ error: 'No available devices' });

    // Assign
    task.status = 'assigned';
    task.assignedDevice = availableDevice.deviceId;
    availableDevice.status = 'busy';

    // Trigger device execution
    task.status = 'running';
    try {
      const deviceResult = await executeTask(availableDevice.deviceId, task.description);
      task.deviceTaskId = deviceResult.task_id || deviceResult.id;
      console.log(`[DeviceAPI] Task started: ${task.deviceTaskId}`);
    } catch (err: any) {
      console.error('[DeviceAPI] Execute failed:', err.message);
      // Don't fail the assignment — device is still assigned
    }

    res.json({ success: true, task, device: availableDevice });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Complete task
app.post('/api/tasks/:taskId/complete', async (req, res) => {
  try {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const { resultHash, screenshotUrl } = req.body;
    task.status = 'completed';
    task.resultHash = resultHash;
    task.screenshotUrl = screenshotUrl;
    task.completedAt = new Date().toISOString();

    // Free device
    if (task.assignedDevice) {
      const device = devices.get(task.assignedDevice);
      if (device) device.status = 'available';
    }

    // Release payment on-chain
    if (releasePaymentOnChain && task.assignedDevice) {
      const device = devices.get(task.assignedDevice);
      if (device) {
        releasePaymentOnChain(task.taskId, task.reward_lamports, device.wallet).catch(err =>
          console.error('[Solana] Payment release failed:', err.message)
        );
      }
    }

    res.json({ success: true, task });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 Clawdbot Router API running on port ${PORT}`);
});
