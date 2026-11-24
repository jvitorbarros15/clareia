import test from 'node:test';
import assert from 'node:assert/strict';
import {auditRecord} from '../src/audit-record.ts';

const found={status:'passed',failures:[],checkedAt:'2026-11-24T12:00:00.000Z',selected:3};
const builtAt='2026-02-01T00:00:00.000Z';

test('uses the latest input audit date and preserves the build date and audit fields',()=>{
  assert.deepEqual(auditRecord(found,[
    {checkedAt:'2026-01-05T10:00:00.000Z'},
    {checkedAt:'2026-01-07T09:00:00.000Z'},
  ],builtAt),{
    status:'passed',
    failures:[],
    checkedAt:'2026-01-07T09:00:00.000Z',
    selected:3,
    builtAt:'2026-02-01T00:00:00.000Z',
  });
});

test('throws when input audits are empty',()=>{
  assert.throws(()=>auditRecord(found,[],builtAt));
});

test('throws when input audit dates are invalid',()=>{
  assert.throws(()=>auditRecord(found,[{checkedAt:'bad'}],builtAt));
});
