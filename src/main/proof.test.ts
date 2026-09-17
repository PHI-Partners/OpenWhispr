import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('better-sqlite3 N-API proof', () => {
  it('opens an in-memory database under Node', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO proof (value) VALUES (?)').run('hello');
    const row = db.prepare('SELECT value FROM proof WHERE id = 1').get() as {
      value: string;
    };
    expect(row.value).toBe('hello');
    db.close();
  });
});
