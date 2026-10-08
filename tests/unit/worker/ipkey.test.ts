import { expect, it } from 'vitest';
import { rateKey } from '../../../worker/lib/http';

it('keeps IPv4 as it is', () => {
  expect(rateKey('203.0.113.7')).toBe('203.0.113.7');
  expect(rateKey('unknown')).toBe('unknown');
});

it('keys IPv6 by its /64, whatever the spelling', () => {
  const key = '2001:db8:aa:1::/64';
  for (const ip of ['2001:db8:aa:1::1', '2001:DB8:AA:1:ffff:0:0:2', '2001:0db8:00aa:0001:0000:0000:0000:0009', '2001:db8:aa:1:0:0:0:0', '[2001:db8:aa:1::5]', 'fe80::1%eth0'.replace('fe80::', '2001:db8:aa:1::')]) {
    expect(rateKey(ip), ip).toBe(key);
  }
  expect(rateKey('2001:db8:aa:2::1')).toBe('2001:db8:aa:2::/64');
  expect(rateKey('::1')).toBe('0:0:0:0::/64');
  expect(rateKey('2001:db8::')).toBe('2001:db8:0:0::/64');
  expect(rateKey('::ffff:192.0.2.1')).toBe('192.0.2.1'); // IPv4-mapped: an IPv4 client
  expect(rateKey('::FFFF:c000:201')).toBe('192.0.2.1');
  expect(rateKey('1:2:3:4:5:6:192.0.2.1')).toBe('1:2:3:4::/64');
});

it('leaves garbage alone (lower-cased), so it can only limit itself', () => {
  expect(rateKey('1:2:3')).toBe('1:2:3');
  expect(rateKey('1::2::3')).toBe('1::2::3');
  expect(rateKey('GGGG::1')).toBe('gggg::1');
  expect(rateKey('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9');
});
