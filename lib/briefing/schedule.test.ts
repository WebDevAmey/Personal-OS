import { describe, expect, it } from 'vitest';
import { parseZoned } from '@/lib/time';
import { briefingDue } from './schedule';

const at0630 = (timeZone: string) => ({ timeZone, briefingHour: 6, briefingMinute: 30 });

describe('briefingDue (ADR-010 TZ selection)', () => {
  it('America/New_York: not due at 06:29 local, due at 06:30 local, for the local date', () => {
    expect(briefingDue(parseZoned('2026-10-22 06:29 America/New_York'), at0630('America/New_York'))).toEqual({ due: false, localDate: '2026-10-22' });
    expect(briefingDue(parseZoned('2026-10-22 06:30 America/New_York'), at0630('America/New_York'))).toEqual({ due: true, localDate: '2026-10-22' });
  });

  it('America/New_York: 22:00 UTC is still the same local day; 04:00 UTC next day is the previous local date', () => {
    expect(briefingDue(new Date('2026-10-22T22:00:00Z'), at0630('America/New_York'))).toEqual({ due: true, localDate: '2026-10-22' });
    // 00:00 EDT on 10-23 is 04:00Z: local time 00:00 < 06:30, new local date not due yet.
    expect(briefingDue(new Date('2026-10-23T04:00:00Z'), at0630('America/New_York'))).toEqual({ due: false, localDate: '2026-10-23' });
  });

  it('America/New_York across DST spring-forward: a 02:30 briefing (inside the gap) fires at 03:00 local', () => {
    const pref = { timeZone: 'America/New_York', briefingHour: 2, briefingMinute: 30 };
    expect(briefingDue(new Date('2026-03-08T06:59:00Z'), pref)).toEqual({ due: false, localDate: '2026-03-08' }); // 01:59 EST
    expect(briefingDue(new Date('2026-03-08T07:00:00Z'), pref)).toEqual({ due: true, localDate: '2026-03-08' }); // 03:00 EDT
  });

  it('Asia/Kolkata (+05:30): 01:00 UTC is 06:30 IST', () => {
    expect(briefingDue(new Date('2026-10-22T00:59:00Z'), at0630('Asia/Kolkata'))).toEqual({ due: false, localDate: '2026-10-22' });
    expect(briefingDue(new Date('2026-10-22T01:00:00Z'), at0630('Asia/Kolkata'))).toEqual({ due: true, localDate: '2026-10-22' });
  });

  it('Pacific/Auckland on its DST start day (2026-09-27, +12 → +13)', () => {
    // 06:30 NZDT on 09-27 is 17:30Z on 09-26.
    expect(briefingDue(new Date('2026-09-26T17:29:00Z'), at0630('Pacific/Auckland'))).toEqual({ due: false, localDate: '2026-09-27' });
    expect(briefingDue(new Date('2026-09-26T17:30:00Z'), at0630('Pacific/Auckland'))).toEqual({ due: true, localDate: '2026-09-27' });
    // The evening before (23:00 NZST on 09-26 = 11:00Z) belongs to 09-26.
    expect(briefingDue(new Date('2026-09-26T11:00:00Z'), at0630('Pacific/Auckland'))).toEqual({ due: true, localDate: '2026-09-26' });
  });

  it('Pacific/Auckland on its DST end day (2026-04-05, +13 → +12)', () => {
    // 06:30 NZST on 04-05 is 18:30Z on 04-04.
    expect(briefingDue(new Date('2026-04-04T18:29:00Z'), at0630('Pacific/Auckland'))).toEqual({ due: false, localDate: '2026-04-05' });
    expect(briefingDue(new Date('2026-04-04T18:30:00Z'), at0630('Pacific/Auckland'))).toEqual({ due: true, localDate: '2026-04-05' });
  });

  it('falls back to UTC for an unknown zone instead of throwing', () => {
    expect(briefingDue(new Date('2026-10-22T06:30:00Z'), at0630('Not/AZone'))).toEqual({ due: true, localDate: '2026-10-22' });
  });
});
