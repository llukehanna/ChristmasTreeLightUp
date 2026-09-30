import { describe, expect, it } from 'vitest';
import { D, L, R, U, degree, dirsOf, rotCW } from '../../../src/core/dirs';

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

describe('degree / dirsOf', () => {
  it('counts links', () => {
    expect(degree(U | D | L | R)).toBe(4);
    expect(degree(L)).toBe(1);
    expect(dirsOf(U | L)).toEqual([U, L]);
  });
});
