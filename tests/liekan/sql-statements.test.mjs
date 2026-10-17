import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqlStatements } from '../../scripts/liekan-sql-statements.mjs';
test('retains function bodies, quoted semicolons, nested comments and escaped quotes', () => {
  const sql =
    "SELECT 'a;''b'; -- ; comment\nCREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN PERFORM 1; END; $body$; /* outer; /* inner; */ done */ SELECT 2;";
  const statements = sqlStatements(sql);
  assert.equal(statements.length, 3);
  assert.match(statements[1], /PERFORM 1; END;/);
  assert.throws(() => sqlStatements('SELECT $$unfinished;'), /Unterminated/);
  const migration = readFileSync('db/liekan/migrations/026_crawler_workflow.sql', 'utf8');
  const functions = sqlStatements(migration).filter(s => s.includes('CREATE FUNCTION'));
  assert.equal(functions.length, 1);
  assert.match(functions[0], /RETURN NEW;/);
});
