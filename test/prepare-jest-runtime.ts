const fs = require('fs');
const path = require('path');

const stackUtilsPath = path.join(process.cwd(), 'node_modules', 'stack-utils', 'index.js');
const safeSource = `'use strict';\n\nclass StackUtils {\n  constructor(_opts) {}\n  static nodeInternals () { return []; }\n  clean (stack) { return Array.isArray(stack) ? stack.join('\\n') : String(stack || ''); }\n  captureString () { return ''; }\n  parseLine () { return null; }\n}\n\nmodule.exports = StackUtils;\n`;

if (fs.existsSync(stackUtilsPath)) {
  fs.writeFileSync(stackUtilsPath, safeSource);
}
