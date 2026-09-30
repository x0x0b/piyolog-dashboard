import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatLocalTime, recordMilkAmount } from '../lib/analytics';
import type { FeedRecord, PiyologFeedV1 } from '../types/feed';

const numberFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });

function formulaRecords(feed: PiyologFeedV1): FeedRecord[] {
  const from = Date.parse(feed.range.from);
  const to = Date.parse(feed.range.to);
  return feed.records.filter((record) => {
    const time = Date.parse(record.datetime);
    return record.type === 'Formula' && time >= from && time < to;
  });
}

export default function FormulaChart({ feed }: { feed: PiyologFeedV1 }) {
  const records = formulaRecords(feed).flatMap((record) => {
    const amount = recordMilkAmount(record);
    return amount === null ? [] : [{ time: Date.parse(record.datetime), amount }];
  });
  const rangeStart = Date.parse(feed.range.from);
  const rangeEnd = Date.parse(feed.range.to);

  return (
    <section className="panel chart-panel" aria-labelledby="formula-chart-title">
      <div className="section-heading">
        <div>
          <h2 id="formula-chart-title">ミルク量</h2>
        </div>
        <span className="section-note">直近24時間</span>
      </div>
      {records.length === 0 ? (
        <div className="chart-empty">量が記録されたミルクはありません</div>
      ) : (
        <div className="chart-wrap" role="img" aria-label="直近24時間のミルク量グラフ">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={records} margin={{ top: 12, right: 4, left: 0, bottom: 2 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="4 5" />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={[rangeStart, rangeEnd]}
                tickFormatter={(value: number) => formatLocalTime(new Date(value).toISOString())}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                minTickGap={28}
              />
              <YAxis
                unit=" ml"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                width={56}
                tickFormatter={(value: number) => String(value)}
              />
              <Tooltip
                cursor={{ fill: 'var(--chart-cursor)' }}
                labelFormatter={(value) => formatLocalTime(new Date(Number(value)).toISOString())}
                formatter={(value) => [numberFormat.format(Number(value)) + ' ml', 'ミルク量']}
                contentStyle={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  boxShadow: 'var(--shadow-lg)',
                }}
              />
              <Bar dataKey="amount" fill="var(--formula)" maxBarSize={22} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
