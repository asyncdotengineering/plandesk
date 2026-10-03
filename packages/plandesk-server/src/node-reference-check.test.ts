import { describe, expect, it } from 'vitest';
import { referenceCheckFsFor } from './node.js';

// A member can PATCH folder_path to any absolute path, so a disk probe on a
// server other people can reach is a host-filesystem existence oracle.
describe('reference-check filesystem access', () => {
  it('is granted on a loopback bind, where the only caller is the machine owner', () => {
    expect(referenceCheckFsFor('127.0.0.1')).toBeDefined();
    expect(referenceCheckFsFor('localhost')).toBeDefined();
  });

  it('is withheld on a network bind, so the check reports unknown', () => {
    expect(referenceCheckFsFor('0.0.0.0')).toBeUndefined();
    expect(referenceCheckFsFor('192.168.1.20')).toBeUndefined();
  });
});
