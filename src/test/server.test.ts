import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../server.js';

async function connectClient(): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return client;
}

describe('MCP server registration', () => {
  it('exposes exactly the four expected tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['bash', 'edit', 'read', 'write']);

    for (const tool of tools) {
      expect(tool.description && tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
    }

    await client.close();
  });

  it('each tool advertises its parameters in the input schema', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();

    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys((byName.read.inputSchema as any).properties)).toEqual(
      expect.arrayContaining(['path', 'offset', 'limit'])
    );
    expect(Object.keys((byName.edit.inputSchema as any).properties)).toEqual(
      expect.arrayContaining(['path', 'oldText', 'newText'])
    );
    expect(Object.keys((byName.bash.inputSchema as any).properties)).toEqual(
      expect.arrayContaining(['command', 'timeout'])
    );

    await client.close();
  });

  it('can call the bash tool end-to-end', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'bash', arguments: { command: 'echo e2e-ok' } });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .map((c) => c.text ?? '')
      .join('\n');
    expect(text).toContain('e2e-ok');
    await client.close();
  });
});
