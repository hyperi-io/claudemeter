// Tests for serviceStatus.parseServiceStatus - reduces a Statuspage
// summary.json payload to the worst of the Claude Code and Claude API
// components, ignoring the rest of the page.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const http = require('http');
const { parseServiceStatus, fetchJson, MAX_STATUS_BODY_BYTES, STATUS_PAGE_URL } = require('../../src/serviceStatus');

describe('fetchJson - response size', () => {
    let server;
    let base;
    let bodies;

    beforeAll(async () => {
        bodies = {
            '/small': JSON.stringify({ page: { updated_at: 'x' } }),
            '/huge': JSON.stringify({ pad: 'x'.repeat(MAX_STATUS_BODY_BYTES) }),
        };
        server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(bodies[req.url]);
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    it('parses a body under the cap', async () => {
        expect(await fetchJson(`${base}/small`, http)).toEqual({ page: { updated_at: 'x' } });
    });

    it('fails a body over the cap instead of buffering it', async () => {
        await expect(fetchJson(`${base}/huge`, http)).rejects.toThrow(/larger than/);
    });
});

const CLAUDE_CODE_ID = 'yyzkbfz2thpt';
const CONSOLE_ID = '0qbwn08sd68x';

function component(id, name, status, updatedAt = '2026-10-12T21:00:00.000Z') {
    return { id, name, status, updated_at: updatedAt, group: false, group_id: null };
}

// Shape of status.claude.com/api/v2/summary.json during a Console-only incident.
function consoleIncidentSummary(claudeCodeStatus = 'operational') {
    return {
        page: { updated_at: '2026-10-12T21:46:09.574Z' },
        status: { indicator: 'minor', description: 'Partially Degraded Service' },
        components: [
            component('rwppv331jlwc', 'claude.ai', 'operational'),
            component(CONSOLE_ID, 'Claude Console (platform.claude.com)', 'degraded_performance'),
            component('k8w3r06qmzrp', 'Claude API (api.anthropic.com)', 'operational'),
            component(CLAUDE_CODE_ID, 'Claude Code', claudeCodeStatus),
        ],
        incidents: [
            {
                name: 'Elevated errors on platform.claude.com',
                status: 'monitoring',
                components: [{ id: CONSOLE_ID, name: 'Claude Console (platform.claude.com)' }],
            },
        ],
    };
}

describe('parseServiceStatus - scoping to Claude Code', () => {
    it('ignores a degraded Console when Claude Code is operational', () => {
        const r = parseServiceStatus(consoleIncidentSummary());
        expect(r.indicator).toBe('none');
        expect(r.description).toBe('Claude Code: Operational');
        expect(r.pageUrl).toBe(STATUS_PAGE_URL);
    });

    it('does not attach an incident that names only another component', () => {
        const r = parseServiceStatus(consoleIncidentSummary('degraded_performance'));
        expect(r.indicator).toBe('minor');
        expect(r.description).toBe('Claude Code: Degraded performance');
    });

    it('uses the incident name when the incident names Claude Code', () => {
        const summary = consoleIncidentSummary('partial_outage');
        summary.incidents.push({
            name: 'Elevated errors on Claude Code',
            status: 'investigating',
            components: [{ id: CLAUDE_CODE_ID, name: 'Claude Code' }],
        });
        const r = parseServiceStatus(summary);
        expect(r.indicator).toBe('major');
        expect(r.description).toBe('Claude Code: Elevated errors on Claude Code');
    });

    it('reports the component updated_at, not the page updated_at', () => {
        const summary = consoleIncidentSummary();
        summary.components[3].updated_at = '2026-10-01T00:00:00.000Z';
        expect(parseServiceStatus(summary).updatedAt).toBe('2026-10-01T00:00:00.000Z');
    });
});

describe('parseServiceStatus - Claude API', () => {
    const API_INDEX = 2;

    it('reports an API outage while Claude Code itself is operational', () => {
        const summary = consoleIncidentSummary();
        summary.components[API_INDEX].status = 'major_outage';
        const r = parseServiceStatus(summary);
        expect(r.indicator).toBe('critical');
        expect(r.description).toBe('Claude API: Major outage');
    });

    it('uses the incident naming the API', () => {
        const summary = consoleIncidentSummary();
        summary.components[API_INDEX].status = 'partial_outage';
        summary.incidents.push({
            name: 'Elevated errors on the Messages API',
            components: [{ id: 'k8w3r06qmzrp', name: 'Claude API (api.anthropic.com)' }],
        });
        expect(parseServiceStatus(summary).description).toBe('Claude API: Elevated errors on the Messages API');
    });

    it('takes the worse of the two', () => {
        const summary = consoleIncidentSummary('degraded_performance');
        summary.components[API_INDEX].status = 'partial_outage';
        expect(parseServiceStatus(summary).indicator).toBe('major');
        expect(parseServiceStatus(summary).description).toBe('Claude API: Partial outage');
    });

    it('names Claude Code on a tie', () => {
        const summary = consoleIncidentSummary('partial_outage');
        summary.components[API_INDEX].status = 'partial_outage';
        expect(parseServiceStatus(summary).description).toBe('Claude Code: Partial outage');
    });

    it('still reports the API when the Claude Code component is missing', () => {
        const summary = consoleIncidentSummary();
        summary.components.splice(3, 1);
        summary.components[API_INDEX].status = 'degraded_performance';
        expect(parseServiceStatus(summary).indicator).toBe('minor');
    });
});

describe('parseServiceStatus - status mapping', () => {
    it.each([
        ['operational', 'none'],
        ['degraded_performance', 'minor'],
        ['under_maintenance', 'minor'],
        ['partial_outage', 'major'],
        ['major_outage', 'critical'],
        ['some_future_status', 'unknown'],
    ])('%s -> %s', (status, indicator) => {
        expect(parseServiceStatus(consoleIncidentSummary(status)).indicator).toBe(indicator);
    });
});

describe('parseServiceStatus - component lookup', () => {
    it('falls back to the name when the id has changed', () => {
        const summary = consoleIncidentSummary('major_outage');
        summary.components[3].id = 'recreated0001';
        expect(parseServiceStatus(summary).indicator).toBe('critical');
    });

    it('does not match a component whose name only starts with Claude Code', () => {
        const summary = consoleIncidentSummary();
        summary.components = [component('other', 'Claude Code Web', 'major_outage')];
        const r = parseServiceStatus(summary);
        expect(r.indicator).toBe('unknown');
        expect(r.description).toBe('Claude Code status not reported');
        expect(r.updatedAt).toBe('2026-10-12T21:46:09.574Z');
    });

    it.each([
        ['null payload', null],
        ['empty object', {}],
        ['components not an array', { components: 'nope' }],
        ['null component entries', { components: [null, undefined] }],
    ])('%s -> unknown, no throw', (_label, payload) => {
        const r = parseServiceStatus(payload);
        expect(r.indicator).toBe('unknown');
        expect(r.updatedAt).toBeNull();
    });

    it('tolerates malformed incidents', () => {
        const summary = consoleIncidentSummary('degraded_performance');
        summary.incidents = [null, { name: 'x' }, { name: 'y', components: 'bad' }];
        expect(parseServiceStatus(summary).description).toBe('Claude Code: Degraded performance');
    });
});
