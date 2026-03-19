'use strict';

import type { PluginOptions } from '../../shared/protocol';

interface CameraConfigEntry {
  name: string;
  nickname: string;
  userName?: string;
  password?: string;
}

function sanitizeNickname(rawNickname: unknown, address: string): string {
  let sanitizedNickname = String(rawNickname || '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  if (!/[a-z0-9]/.test(sanitizedNickname)) {
    sanitizedNickname = 'camera_' + String(address).replace(/\./g, '_');
  }
  return sanitizedNickname;
}

function buildCameraConfigs(options: PluginOptions): Record<string, CameraConfigEntry> {
  const cameraConfigs: Record<string, CameraConfigEntry> = {};
  if (options.cameras && Array.isArray(options.cameras)) {
    options.cameras.forEach((camera) => {
      if (!camera.address) {
        return;
      }
      const rawNickname = camera.nickname || camera.name || camera.address;
      cameraConfigs[camera.address] = {
        name: camera.name || camera.address,
        nickname: sanitizeNickname(rawNickname, camera.address),
        userName: camera.userName || options.userName,
        password: camera.password || options.password
      };
    });
  }
  return cameraConfigs;
}

module.exports = {
  buildCameraConfigs,
  sanitizeNickname
};
