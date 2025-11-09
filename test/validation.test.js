/**
 * Tests for input validation utilities
 */

const {
  ValidationError,
  isValidIP,
  isValidPort,
  isValidSpeed,
  validateDeviceAddress,
  validatePTZCommand,
  validatePluginOptions,
  sanitizeString
} = require('../lib/utils/validation');

describe('Validation utilities', () => {
  describe('isValidIP', () => {
    test('should validate correct IPv4 addresses', () => {
      expect(isValidIP('192.168.1.1')).toBe(true);
      expect(isValidIP('10.0.0.1')).toBe(true);
      expect(isValidIP('172.16.0.1')).toBe(true);
      expect(isValidIP('255.255.255.255')).toBe(true);
    });

    test('should reject invalid IP addresses', () => {
      expect(isValidIP('256.1.1.1')).toBe(false);
      expect(isValidIP('192.168.1')).toBe(false);
      expect(isValidIP('192.168.1.1.1')).toBe(false);
      expect(isValidIP('not.an.ip.address')).toBe(false);
      expect(isValidIP('')).toBe(false);
      expect(isValidIP(null)).toBe(false);
      expect(isValidIP(undefined)).toBe(false);
    });
  });

  describe('isValidPort', () => {
    test('should validate correct port numbers', () => {
      expect(isValidPort(80)).toBe(true);
      expect(isValidPort(8880)).toBe(true);
      expect(isValidPort(1)).toBe(true);
      expect(isValidPort(65535)).toBe(true);
    });

    test('should reject invalid port numbers', () => {
      expect(isValidPort(0)).toBe(false);
      expect(isValidPort(65536)).toBe(false);
      expect(isValidPort(-1)).toBe(false);
      expect(isValidPort('8080')).toBe(false);
      expect(isValidPort(null)).toBe(false);
    });
  });

  describe('isValidSpeed', () => {
    test('should validate correct speed values', () => {
      expect(isValidSpeed(0)).toBe(true);
      expect(isValidSpeed(1.0)).toBe(true);
      expect(isValidSpeed(-1.0)).toBe(true);
      expect(isValidSpeed(0.5)).toBe(true);
    });

    test('should reject invalid speed values', () => {
      expect(isValidSpeed(1.1)).toBe(false);
      expect(isValidSpeed(-1.1)).toBe(false);
      expect(isValidSpeed('0.5')).toBe(false);
      expect(isValidSpeed(null)).toBe(false);
    });
  });

  describe('validateDeviceAddress', () => {
    test('should validate correct device addresses', () => {
      expect(validateDeviceAddress('192.168.1.100')).toBe('192.168.1.100');
    });

    test('should throw ValidationError for invalid addresses', () => {
      expect(() => validateDeviceAddress()).toThrow(ValidationError);
      expect(() => validateDeviceAddress('')).toThrow('Device address is required');
      expect(() => validateDeviceAddress(123)).toThrow('Device address must be a string');
      expect(() => validateDeviceAddress('invalid')).toThrow('Invalid IP address format');
    });
  });

  describe('validatePTZCommand', () => {
    test('should validate correct PTZ commands', () => {
      const validCommand = {
        address: '192.168.1.100',
        speed: { x: 0.5, y: -0.5, z: 0 },
        timeout: 30
      };
      expect(validatePTZCommand(validCommand)).toEqual(validCommand);
    });

    test('should validate PTZ commands without speed', () => {
      const validCommand = {
        address: '192.168.1.100'
      };
      expect(validatePTZCommand(validCommand)).toEqual(validCommand);
    });

    test('should throw ValidationError for invalid PTZ commands', () => {
      expect(() => validatePTZCommand(null)).toThrow(ValidationError);
      expect(() => validatePTZCommand({})).toThrow('Device address is required');

      expect(() => validatePTZCommand({
        address: '192.168.1.100',
        speed: { x: 2.0, y: 0, z: 0 }
      })).toThrow('Speed X must be between');

      expect(() => validatePTZCommand({
        address: '192.168.1.100',
        timeout: 400
      })).toThrow('Timeout must be between');
    });
  });

  describe('validatePluginOptions', () => {
    test('should validate correct plugin options', () => {
      const validOptions = {
        port: 8880,
        secure: false,
        userName: 'admin',
        password: 'password123',
        ipAddress: '192.168.1.1'
      };
      expect(validatePluginOptions(validOptions)).toEqual(validOptions);
    });

    test('should throw ValidationError for invalid options', () => {
      expect(() => validatePluginOptions(null)).toThrow(ValidationError);

      expect(() => validatePluginOptions({
        port: 70000
      })).toThrow('Invalid port number');

      expect(() => validatePluginOptions({
        ipAddress: 'invalid'
      })).toThrow('Invalid IP address format');

      expect(() => validatePluginOptions({
        secure: 'yes'
      })).toThrow('Secure flag must be a boolean');
    });
  });

  describe('sanitizeString', () => {
    test('should remove dangerous characters', () => {
      expect(sanitizeString('normal text')).toBe('normal text');
      expect(sanitizeString('<script>alert("xss")</script>')).toBe('scriptalert(xss)/script');
      expect(sanitizeString('test&value=123')).toBe('testvalue=123');
      expect(sanitizeString("test'value\"")).toBe('testvalue');
    });

    test('should handle non-string inputs', () => {
      expect(sanitizeString(null)).toBe('');
      expect(sanitizeString(undefined)).toBe('');
      expect(sanitizeString(123)).toBe('');
    });
  });
});
