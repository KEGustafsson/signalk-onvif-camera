import * as fs from 'fs';
import * as path from 'path';

describe('browser html', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  test('keeps the connect form focused on device selection', () => {
    expect(html).toContain('name="device"');
    expect(html).not.toContain('name="user"');
    expect(html).not.toContain('name="pass"');
    expect(html).not.toContain('connect-credentials');
  });

  test('does not depend on external CDN assets', () => {
    expect(html).not.toContain('code.jquery.com');
    expect(html).not.toContain('maxcdn.bootstrapcdn.com');
  });

  test('uses the original overlay glyphicon classes locally', () => {
    expect(html).toContain('glyphicon glyphicon-eye-open');
    expect(html).toContain('glyphicon glyphicon-home');
    expect(html).toContain('glyphicon glyphicon-link');
    expect(html).toContain('glyphicon glyphicon-menu-left');
    expect(html).toContain('glyphicon glyphicon-zoom-in');
    expect(html).toContain('glyphicon glyphicon-copy');
  });

  test('does not contain garbled PTZ control glyphs', () => {
    expect(html).not.toContain('Ã¢â€”â‚¬');
    expect(html).not.toContain('Ã¢â€“Â¶');
    expect(html).not.toContain('Ã¢â€“Â²');
    expect(html).not.toContain('Ã¢â€“Â¼');
  });
});
