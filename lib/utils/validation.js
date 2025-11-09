/**
 * Input validation utilities for WebSocket commands and parameters
 */

const config = require('../config/defaults');

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Validate IP address format
 */
function isValidIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;

  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * Validate port number
 */
function isValidPort(port) {
  if (typeof port !== 'number') return false;
  return port >= 1 && port <= 65535;
}

/**
 * Validate PTZ speed value
 */
function isValidSpeed(speed) {
  if (typeof speed !== 'number') return false;
  return speed >= config.ptz.minSpeed && speed <= config.ptz.maxSpeed;
}

/**
 * Validate device address parameter
 */
function validateDeviceAddress(address) {
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
function validatePTZCommand(params) {
  if (!params || typeof params !== 'object') {
    throw new ValidationError('Invalid PTZ command parameters', 'params');
  }

  // Validate address
  validateDeviceAddress(params.address);

  // Validate speed if provided
  if (params.speed) {
    if (typeof params.speed !== 'object') {
      throw new ValidationError('Speed must be an object', 'speed');
    }

    const { x = 0, y = 0, z = 0 } = params.speed;

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
  if (params.timeout !== undefined) {
    if (typeof params.timeout !== 'number' || params.timeout < 1 || params.timeout > 300) {
      throw new ValidationError('Timeout must be between 1 and 300 seconds', 'timeout');
    }
  }

  return params;
}

/**
 * Validate plugin configuration options
 */
function validatePluginOptions(options) {
  if (!options || typeof options !== 'object') {
    throw new ValidationError('Invalid plugin options', 'options');
  }

  // Validate port
  if (options.port !== undefined && !isValidPort(options.port)) {
    throw new ValidationError('Invalid port number (1-65535)', 'port');
  }

  // Validate IP address if provided
  if (options.ipAddress && !isValidIP(options.ipAddress)) {
    throw new ValidationError('Invalid IP address format', 'ipAddress');
  }

  // Validate username
  if (options.userName && typeof options.userName !== 'string') {
    throw new ValidationError('Username must be a string', 'userName');
  }

  // Validate password
  if (options.password && typeof options.password !== 'string') {
    throw new ValidationError('Password must be a string', 'password');
  }

  // Validate secure flag
  if (options.secure !== undefined && typeof options.secure !== 'boolean') {
    throw new ValidationError('Secure flag must be a boolean', 'secure');
  }

  return options;
}

/**
 * Sanitize string input (prevent injection attacks)
 */
function sanitizeString(str) {
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
