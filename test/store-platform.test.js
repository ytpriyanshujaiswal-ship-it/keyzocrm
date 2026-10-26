import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createStore } = require('../server/store.js');

test('platform organization and billing data persist across file-store restart', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'keyzo-store-test-'));
  const previousDbUrl = process.env.DATABASE_URL;
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATABASE_URL = '';
  process.env.DATA_DIR = temp;
  try {
    const first = createStore({ dataDir: temp });
    await first.init();
    await first.updatePlatformData((data) => {
      data.organizations.push({ id: 'org-test', name: 'Test Org' });
      data.billing['org-test'] = { balance: 100, transactions: [] };
      return data;
    });
    await first.close();
    const second = createStore({ dataDir: temp });
    await second.init();
    const data = await second.getPlatformData();
    assert.equal(data.organizations.find((org) => org.id === 'org-test').name, 'Test Org');
    assert.equal(data.billing['org-test'].balance, 100);
    await second.close();
  } finally {
    if (previousDbUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDbUrl;
    if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
