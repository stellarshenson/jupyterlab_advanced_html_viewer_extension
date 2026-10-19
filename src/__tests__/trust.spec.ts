import { rememberedTrust, trustValue } from '../viewer';

const PAGE = '<!DOCTYPE html>\n<p>Hello world</p>\n';
const SIGNATURE = 'a'.repeat(64);

/** The page with a settings marker carrying a trust value. */
function withTrust(value: string): string {
  return `${PAGE}<!-- marks:settings panel=hidden trust=${value} -->\n`;
}

describe('the remembered trust of a file', () => {
  it('ACC-VIEW-90 reads the trust value out of the settings marker', () => {
    expect(trustValue(withTrust(SIGNATURE))).toBe(SIGNATURE);
    expect(trustValue(PAGE)).toBeUndefined();
    expect(trustValue(withTrust('not-a-signature'))).toBeUndefined();
  });

  it('ACC-VIEW-90 remembers a file only while the route signs its path', () => {
    expect(rememberedTrust(withTrust(SIGNATURE), SIGNATURE)).toBe(true);
  });

  it('ACC-VIEW-86 remembers nothing for a value the route did not sign', () => {
    expect(rememberedTrust(withTrust('b'.repeat(64)), SIGNATURE)).toBe(false);
  });

  it('ACC-VIEW-90 remembers nothing where the route gives no signature', () => {
    expect(rememberedTrust(withTrust(SIGNATURE), null)).toBe(false);
  });
});
