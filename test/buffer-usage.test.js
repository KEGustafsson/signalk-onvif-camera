/**
 * Test to ensure no deprecated Buffer constructors are used
 */

const fs = require('fs');
const path = require('path');

describe('Buffer API usage', () => {
  const jsFiles = [
    'lib/modules/http-auth.js',
    'lib/modules/soap.js'
  ];

  jsFiles.forEach((file) => {
    test(`${file} should not use deprecated Buffer constructor`, () => {
      const filePath = path.join(__dirname, '..', file);
      const content = fs.readFileSync(filePath, 'utf8');

      // Check for deprecated 'new Buffer()' usage
      expect(content).not.toMatch(/new\s+Buffer\s*\(/);

      // Verify it uses safe alternatives
      const hasBufferUsage = content.includes('Buffer.alloc') ||
                            content.includes('Buffer.from') ||
                            content.includes('Buffer.concat');

      if (content.includes('Buffer')) {
        expect(hasBufferUsage).toBe(true);
      }
    });
  });
});
