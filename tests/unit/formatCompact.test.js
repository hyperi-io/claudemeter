import { describe, it, expect } from 'vitest';
const { formatCompact } = require('../../src/utils');

describe('formatCompact', () => {
    it.each([
        [999, '999'],
        [999.6, '1.0K'],
        [1500, '1.5K'],
        [999_949, '999.9K'],
        [999_999, '1.0M'],
        [1_500_000, '1.5M'],
    ])('%d -> %s', (value, expected) => {
        expect(formatCompact(value)).toBe(expected);
    });
});
