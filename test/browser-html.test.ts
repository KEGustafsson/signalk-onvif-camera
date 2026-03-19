import * as fs from 'fs';
import * as path from 'path';

describe('browser html', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  test('includes manual credential inputs in the connect form', () => {
    expect(html).toContain('name="user"');
    expect(html).toContain('name="pass"');
  });

  test('does not depend on external CDN assets', () => {
    expect(html).not.toContain('code.jquery.com');
    expect(html).not.toContain('maxcdn.bootstrapcdn.com');
  });
});
