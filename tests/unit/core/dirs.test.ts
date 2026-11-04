import { describe, expect, it } from 'vitest';
import { D, L, R, U, degree, dirsOf, rotBy, rotCCW, rotCW } from '../../../src/core/dirs';

describe('rotCW', () => {
  it('turns clockwise: U→R→D→L→U', () => {
    expect(rotCW(U)).toBe(R);
    expect(rotCW(R)).toBe(D);
    expect(rotCW(D)).toBe(L);
    expect(rotCW(L)).toBe(U);
  });
  it('is the identity after four turns for every shape', () => {
    for (let b = 1; b <= 15; b++) expect(rotCW(rotCW(rotCW(rotCW(b))))).toBe(b);
  });
  it('rotates multi-link shapes', () => {
    expect(rotCW(U | R)).toBe(R | D);
    expect(rotCW(U | D)).toBe(L | R);
    expect(rotCW(U | L | R)).toBe(U | R | D);
  });
});

describe('rotCCW / rotBy', () => {
  it('turns counter-clockwise: U→L→D→R→U', () => {
    expect(rotCCW(U)).toBe(L);
    expect(rotCCW(L)).toBe(D);
    expect(rotCCW(D)).toBe(R);
    expect(rotCCW(R)).toBe(U);
  });
  it('undoes a clockwise turn, and equals three of them, for all 16 bit patterns', () => {
    for (let b = 0; b < 16; b++) {
      expect(rotCCW(rotCW(b))).toBe(b);
      expect(rotCW(rotCCW(b))).toBe(b);
      expect(rotCCW(b)).toBe(rotCW(rotCW(rotCW(b))));
    }
  });
  it('rotBy picks the direction: 1 is clockwise, -1 counter-clockwise', () => {
    for (let b = 0; b < 16; b++) {
      expect(rotBy(b, 1)).toBe(rotCW(b));
      expect(rotBy(b, -1)).toBe(rotCCW(b));
    }
  });
});

describe('degree / dirsOf', () => {
  it('counts links', () => {
    expect(degree(U | D | L | R)).toBe(4);
    expect(degree(L)).toBe(1);
    expect(dirsOf(U | L)).toEqual([U, L]);
  });
});
