/**
 * Input validation utilities for WebSocket commands and parameters
 */

import type { UnknownRecord } from '../types';

const config = require('../config/defaults');

interface SpeedParams extends UnknownRecord {
  x?: unknown;
  y?: unknown;
  z?: unknown;
}

interface PTZCommandParams extends UnknownRecord {
  address?: unknown;
  speed?: unknown;
  timeout?: unknown;
}

interface PluginOptionsValidationParams extends UnknownRecord {
  ipAddress?: unknown;
  userName?: unknown;
  password?: unknown;
}

class ValidationError extends Error {
  field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Validate IP address format
 */
function isValidIP(ip: unknown): ip is string {
  if (!ip || typeof ip !== 'string') return false;
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;

  const parts = ip.split('.');
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * Validate port number
 */
function isValidPort(port: unknown): port is number {
  if (typeof port !== 'number') return false;
  return port >= 1 && port <= 65535;
}

/**
 * Validate PTZ speed value
 */
function isValidSpeed(speed: unknown): speed is number {
  if (typeof speed !== 'number') return false;
  return speed >= config.ptz.minSpeed && speed <= config.ptz.maxSpeed;
}

/**
 * Validate device address parameter
 */
function validateDeviceAddress(address: unknown): string {
  if (!address) {
    throw new ValidationError('Device address is required', 'address');
  }
  if (typeof address !== 'string') {
    throw new ValidationError('Device address must be a string', 'address');
  }
  if (!isValidIP(address)) {
    throw new ValidationError('Invalid IP address format', 'address');
  }
  return address;
}

/**
 * Validate PTZ command parameters
 */
function validatePTZCommand(params: unknown): PTZCommandParams {
  if (!params || typeof params !== 'object') {
    throw new ValidationError('Invalid PTZ command parameters', 'params');
  }
  const command = params as PTZCommandParams;

  // Validate address
  validateDeviceAddress(command.address);

  // Validate speed if provided
  if (command.speed) {
    if (typeof command.speed !== 'object') {
      throw new ValidationError('Speed must be an object', 'speed');
    }
    const speed = command.speed as SpeedParams;

    const { x = 0, y = 0, z = 0 } = speed;

    if (!isValidSpeed(x)) {
      throw new ValidationError(
        `Speed X must be between ${config.ptz.minSpeed} and ${config.ptz.maxSpeed}`,
        'speed.x'
      );
    }
    if (!isValidSpeed(y)) {
      throw new ValidationError(
        `Speed Y must be between ${config.ptz.minSpeed} and ${config.ptz.maxSpeed}`,
        'speed.y'
      );
    }
    if (!isValidSpeed(z)) {
      throw new ValidationError(
        `Speed Z must be between ${config.ptz.minSpeed} and ${config.ptz.maxSpeed}`,
        'speed.z'
      );
    }
  }

  // Validate timeout if provided
  if (command.timeout !== undefined) {
    if (typeof command.timeout !== 'number' || command.timeout < 1 || command.timeout > 300) {
      throw new ValidationError('Timeout must be between 1 and 300 seconds', 'timeout');
    }
  }

  return command;
}

/**
 * Validate plugin configuration options
 */
function validatePluginOptions(options: unknown): PluginOptionsValidationParams {
  if (!options || typeof options !== 'object') {
    throw new ValidationError('Invalid plugin options', 'options');
  }
  const configOptions = options as PluginOptionsValidationParams;

  // Validate IP address if provided
  if (configOptions.ipAddress && !isValidIP(configOptions.ipAddress)) {
    throw new ValidationError('Invalid IP address format', 'ipAddress');
  }

  // Validate username
  if (configOptions.userName && typeof configOptions.userName !== 'string') {
    throw new ValidationError('Username must be a string', 'userName');
  }

  // Validate password
  if (configOptions.password && typeof configOptions.password !== 'string') {
    throw new ValidationError('Password must be a string', 'password');
  }

  return configOptions;
}

/**
 * Sanitize string input (prevent injection attacks)
 */
function sanitizeString(str: unknown): string {
  if (typeof str !== 'string') return '';
  // Remove any potential XSS or injection characters
  return str.replace(/[<>'"&]/g, '');
}

module.exports = {
  ValidationError,
  isValidIP,
  isValidPort,
  isValidSpeed,
  validateDeviceAddress,
  validatePTZCommand,
  validatePluginOptions,
  sanitizeString
};
