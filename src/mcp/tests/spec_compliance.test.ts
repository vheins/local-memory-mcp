import { describe, it, expect } from 'vitest';
import { createMcpResponse } from '../utils/mcp-response';

describe('MCP Spec Compliance', () => {
  it('should return structuredContent and not data', () => {
    const mockData = { id: 'mem_1', title: 'Test' };
    const response = createMcpResponse(mockData, 'Summary');
    
    expect(response).not.toHaveProperty('content');
    expect(response).toHaveProperty('structuredContent');
    expect(response).not.toHaveProperty('data');
    expect(response.isError).toBe(false);
  });

  it('should prune metadata in structuredContent', () => {
    const mockData = { 
      id: 'mem_1', 
      title: 'Test',
      agent: 'test-agent',
      model: 'test-model',
      hit_count: 10
    };
    const response = createMcpResponse(mockData, 'Summary');
    const sc = response.structuredContent as any;
    
    expect(sc.id).toBe('mem_1');
    expect(sc.title).toBe('Test');
    expect(sc.agent).toBeUndefined();
    expect(sc.model).toBeUndefined();
    expect(sc.hit_count).toBeUndefined();
  });

  it('should handle nested arrays in structuredContent', () => {
    const mockData = { 
      results: [
        { id: '1', agent: 'a' },
        { id: '2', model: 'm' }
      ]
    };
    const response = createMcpResponse(mockData, 'Summary');
    const sc = response.structuredContent as any;
    
    expect(sc.results[0].id).toBe('1');
    expect(sc.results[0].agent).toBeUndefined();
    expect(sc.results[1].id).toBe('2');
    expect(sc.results[1].model).toBeUndefined();
  });
});
