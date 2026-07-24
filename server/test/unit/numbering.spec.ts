import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers';
import { NumberingService } from '../../src/common/numbering/numbering.service';

describe('NumberingService 单据编号器', () => {
  let ds: DataSource;
  let svc: NumberingService;
  const day1 = new Date('2026-07-24T10:00:00');
  const day2 = new Date('2026-07-25T10:00:00');

  beforeEach(async () => {
    ds = await createTestDataSource();
    svc = new NumberingService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('编号格式：类型码 + yyyyMMdd + 4 位流水', async () => {
    const no = await svc.next('RCV', day1);
    expect(no).toBe('RCV20260724-0001');
  });

  it('同日并发 20 次取号：不重号且连续', async () => {
    const nos = await Promise.all(
      Array.from({ length: 20 }, () => svc.next('RCV', day1)),
    );
    const uniq = new Set(nos);
    expect(uniq.size).toBe(20);
    const seqs = [...uniq]
      .map((n) => Number(n.split('-')[1]))
      .sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('跨日流水重置；不同类型码互不影响', async () => {
    await svc.next('RCV', day1);
    await svc.next('RCV', day1);
    const nextDay = await svc.next('RCV', day2);
    expect(nextDay).toBe('RCV20260725-0001');
    const otherType = await svc.next('PREP', day1);
    expect(otherType).toBe('PREP20260724-0001');
    const continueDay1 = await svc.next('RCV', day1);
    expect(continueDay1).toBe('RCV20260724-0003');
  });
});
