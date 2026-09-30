import { lazy, Suspense, useEffect, useState } from 'react';
import {
  durationLabel,
  formatLocalDateTime,
  formatLocalTime,
  getFeedAnalytics,
  nextFeedingEstimate,
  recordMilkAmount,
} from '../lib/analytics';
import { feedErrorMessage } from '../lib/feedErrorMessage';
import type { FeedErrorKind } from '../data/feedClient';
import type { FeedRecord, PiyologFeedV1 } from '../types/feed';
import Disclaimer from './Disclaimer';

export type ThemePreference = 'light' | 'dark';

interface DashboardProps {
  feed: PiyologFeedV1 | null;
  now: number;
  lastFetchedAt: number | null;
  errorKind: FeedErrorKind | 'cooldown' | null;
  retryInSeconds: number;
  isLoading: boolean;
  isMock: boolean;
  feedingInterval: number;
  theme: ThemePreference;
  savingNotice: string | null;
  onChangeFeed: () => void;
  onFeedingIntervalChange: (hours: number) => void;
  onThemeChange: (theme: ThemePreference) => void;
}

const numberFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
const FormulaChart = lazy(() => import('./FormulaChart'));

interface TimelineHourTick {
  timestamp: number;
  position: number;
  hour: number;
  label: string;
}

function timelineHourTicks(from: number, to: number): TimelineHourTick[] {
  const ticks: TimelineHourTick[] = [];
  const firstMinute = Math.floor(from / 60_000) * 60_000 + 60_000;
  for (let timestamp = firstMinute; timestamp < to; timestamp += 60_000) {
    const date = new Date(timestamp);
    if (date.getMinutes() === 0) {
      ticks.push({
        timestamp,
        position: ((timestamp - from) / (to - from)) * 100,
        hour: date.getHours(),
        label: formatLocalTime(date.toISOString()),
      });
    }
  }
  return ticks;
}

function timelineAxisLabelClass(tick: TimelineHourTick): string {
  const cadenceClasses = [
    tick.hour % 3 === 0 ? 'timeline-axis-label-wide' : '',
    tick.hour % 4 === 0 ? 'timeline-axis-label-medium' : '',
    tick.hour % 6 === 0 ? 'timeline-axis-label-narrow' : '',
  ];
  return ['timeline-axis-label', ...cadenceClasses].filter(Boolean).join(' ');
}

function amountText(value: number | null, eventCount: number): string {
  if (value === null) return eventCount === 0 ? '0 ml' : '—';
  return numberFormat.format(value) + ' ml';
}

function timeText(iso: string | null): string {
  return iso === null ? '—' : formatLocalTime(iso);
}

function CountTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="summary-tile">
      <dt className="tile-label">{label}</dt>
      <dd className="tile-value">
        {value === '—'
          ? value
          : value
              .split(/(\d[\d,.]*)/g)
              .filter(Boolean)
              .map((part, index) =>
                /\d/.test(part) ? (
                  part
                ) : (
                  <span className="metric-unit" key={index}>
                    {part.trim()}
                  </span>
                ),
              )}
      </dd>
      <dd className="tile-detail">{detail}</dd>
    </div>
  );
}

function validFeedRecords(feed: PiyologFeedV1, types: string[]): FeedRecord[] {
  const from = Date.parse(feed.range.from);
  const to = Date.parse(feed.range.to);
  return feed.records.filter((record) => {
    const time = Date.parse(record.datetime);
    return types.includes(record.type) && time >= from && time < to;
  });
}

function xPercent(iso: string, from: number, to: number): number {
  if (to <= from) return 0;
  return Math.max(0, Math.min(100, ((Date.parse(iso) - from) / (to - from)) * 100));
}

interface TimelineTooltipInfo {
  heading: string;
  time: string;
  primary?: string;
  details: string[];
}

function timelineRecordInfo(
  label: string,
  record: FeedRecord,
  sleepIntervals: Array<{ startAt: string; endAt: string | null }> = [],
): TimelineTooltipInfo {
  const info: TimelineTooltipInfo = {
    heading: label,
    time: formatLocalDateTime(record.datetime),
    details: [],
  };
  if (record.type === 'Formula') {
    const amount = recordMilkAmount(record);
    info.primary = amount === null ? '量の記録なし' : numberFormat.format(amount) + ' ml';
    if (amount === null) info.details.push('粉ミルク');
  } else if (record.type === 'ExpressedBreastMilk') {
    const amount = recordMilkAmount(record);
    info.primary = amount === null ? '量の記録なし' : numberFormat.format(amount) + ' ml';
  } else if (record.type === 'BreastFeeding') {
    const amount = recordMilkAmount(record);
    if (amount !== null) info.primary = numberFormat.format(amount) + ' ml';
    info.details = breastfeedingDetails(record);
  } else if (record.type === 'Poop') {
    info.details = poopDetailsText(record)?.split(' · ') ?? ['詳細の記録なし'];
  } else if (record.type === 'Sleep') {
    info.heading = '睡眠開始';
    const interval = sleepIntervals.find((item) => item.startAt === record.datetime);
    if (interval) {
      info.details.push(
        interval.endAt === null
          ? '睡眠中'
          : '睡眠時間 ' + durationLabel(Date.parse(interval.endAt) - Date.parse(interval.startAt)),
      );
    }
  } else if (record.type === 'WakeUp') {
    info.heading = '起床';
  }
  return info;
}

function TimelineTooltip({ id, info }: { id: string; info: TimelineTooltipInfo }) {
  return (
    <span className="timeline-tooltip" id={id} role="tooltip">
      <span className="timeline-tooltip-heading">{info.heading}</span>
      <span className="timeline-tooltip-time">{info.time}</span>
      {info.primary && (
        <strong
          className={
            'timeline-tooltip-primary' +
            (info.primary === '量の記録なし' ? ' timeline-tooltip-muted' : '')
          }
        >
          {info.primary}
        </strong>
      )}
      {info.details.length > 0 && (
        <span className="timeline-tooltip-details">
          {info.details.map((detail) => (
            <span className="timeline-tooltip-detail" key={detail}>
              {detail}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function tooltipAlignment(position: number): string {
  if (position < 34) return 'tooltip-start';
  if (position > 66) return 'tooltip-end';
  return 'tooltip-center';
}

function TimelineRow({
  label,
  records,
  from,
  to,
  hourTicks,
  tone,
  sleepIntervals,
  pinnedTooltipId,
  onToggleTooltip,
  onClearPinnedTooltip,
}: {
  label: string;
  records: FeedRecord[];
  from: number;
  to: number;
  hourTicks: TimelineHourTick[];
  tone: string;
  sleepIntervals?: Array<{ startAt: string; endAt: string | null }>;
  pinnedTooltipId: string | null;
  onToggleTooltip: (id: string) => void;
  onClearPinnedTooltip: () => void;
}) {
  return (
    <div className="timeline-row">
      <span className="timeline-label">{label}</span>
      <div className="timeline-lane">
        {hourTicks.map((tick) => (
          <span
            className="timeline-hour-line"
            key={tick.timestamp}
            style={{ left: tick.position + '%' }}
            aria-hidden="true"
          />
        ))}
        {sleepIntervals?.map((interval) => {
          if (interval.endAt === null) return null;
          const endAt = interval.endAt;
          const id = 'sleep-' + encodeURIComponent(interval.startAt + endAt);
          const tooltipId = 'timeline-tooltip-' + id;
          const info: TimelineTooltipInfo = {
            heading: '睡眠時間',
            time: formatLocalDateTime(interval.startAt) + ' 〜 ' + formatLocalDateTime(endAt),
            primary: durationLabel(Date.parse(endAt) - Date.parse(interval.startAt)),
            details: [],
          };
          const position = (xPercent(interval.startAt, from, to) + xPercent(endAt, from, to)) / 2;
          const active = pinnedTooltipId === id;
          return (
            <button
              type="button"
              className={'sleep-interval-trigger ' + tooltipAlignment(position)}
              key={id}
              style={{
                left: xPercent(interval.startAt, from, to) + '%',
                width:
                  Math.max(0.5, xPercent(endAt, from, to) - xPercent(interval.startAt, from, to)) +
                  '%',
              }}
              data-pinned={active}
              onClick={() => onToggleTooltip(id)}
              onPointerEnter={(event) => {
                if (event.pointerType !== 'touch') onClearPinnedTooltip();
              }}
              onFocus={onClearPinnedTooltip}
              aria-label={info.heading + ' ' + info.time + '、' + info.primary}
              aria-describedby={tooltipId}
            >
              <span className="sleep-span" aria-hidden="true" />
              <TimelineTooltip id={tooltipId} info={info} />
            </button>
          );
        })}
        {records.map((record) => {
          const info = timelineRecordInfo(label, record, sleepIntervals);
          const id = 'record-' + encodeURIComponent(record.event_id);
          const tooltipId = 'timeline-tooltip-' + id;
          const active = pinnedTooltipId === id;
          const position = xPercent(record.datetime, from, to);
          return (
            <button
              type="button"
              className={
                'timeline-dot ' +
                tone +
                (record.type === 'Sleep' ? ' sleep-start' : '') +
                ' ' +
                tooltipAlignment(position)
              }
              key={record.event_id}
              style={{ left: position + '%' }}
              data-pinned={active}
              onClick={() => onToggleTooltip(id)}
              onPointerEnter={(event) => {
                if (event.pointerType !== 'touch') onClearPinnedTooltip();
              }}
              onFocus={onClearPinnedTooltip}
              aria-label={info.heading + ' ' + info.time}
              aria-describedby={tooltipId}
            >
              <TimelineTooltip id={tooltipId} info={info} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Timeline({
  feed,
  sleepIntervals,
}: {
  feed: PiyologFeedV1;
  sleepIntervals: Array<{ startAt: string; endAt: string | null }>;
}) {
  const [pinnedTooltipId, setPinnedTooltipId] = useState<string | null>(null);
  useEffect(() => {
    const dismissOnOutsidePress = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('.timeline-dot, .sleep-interval-trigger')
      ) {
        setPinnedTooltipId(null);
      }
    };
    document.addEventListener('pointerdown', dismissOnOutsidePress);
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePress);
  }, []);

  const toggleTooltip = (id: string) => {
    setPinnedTooltipId((current) => (current === id ? null : id));
  };
  const clearPinnedTooltip = () => setPinnedTooltipId(null);

  const from = Date.parse(feed.range.from);
  const to = Date.parse(feed.range.to);
  const hourTicks = timelineHourTicks(from, to);
  const formula = validFeedRecords(feed, ['Formula']);
  const expressed = validFeedRecords(feed, ['ExpressedBreastMilk']);
  const breastfeeding = validFeedRecords(feed, ['BreastFeeding']);
  const pee = validFeedRecords(feed, ['Pee']);
  const poop = validFeedRecords(feed, ['Poop']);
  const sleep = validFeedRecords(feed, ['Sleep', 'WakeUp']);

  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="section-heading">
        <div>
          <h2 id="timeline-title">24時間のタイムライン</h2>
        </div>
      </div>
      <div className="timeline-axis">
        {hourTicks.map((tick) => (
          <span
            className={timelineAxisLabelClass(tick)}
            key={tick.timestamp}
            style={{ left: tick.position + '%' }}
          >
            {tick.label}
          </span>
        ))}
      </div>
      <TimelineRow
        label="ミルク"
        records={formula}
        from={from}
        to={to}
        hourTicks={hourTicks}
        tone="formula-dot"
        pinnedTooltipId={pinnedTooltipId}
        onToggleTooltip={toggleTooltip}
        onClearPinnedTooltip={clearPinnedTooltip}
      />
      <TimelineRow
        label="搾母乳"
        records={expressed}
        from={from}
        to={to}
        hourTicks={hourTicks}
        tone="expressed-dot"
        pinnedTooltipId={pinnedTooltipId}
        onToggleTooltip={toggleTooltip}
        onClearPinnedTooltip={clearPinnedTooltip}
      />
      <TimelineRow
        label="母乳"
        records={breastfeeding}
        from={from}
        to={to}
        hourTicks={hourTicks}
        tone="breastfeeding-dot"
        pinnedTooltipId={pinnedTooltipId}
        onToggleTooltip={toggleTooltip}
        onClearPinnedTooltip={clearPinnedTooltip}
      />
      <TimelineRow
        label="おしっこ"
        records={pee}
        from={from}
        to={to}
        hourTicks={hourTicks}
        tone="pee-dot"
        pinnedTooltipId={pinnedTooltipId}
        onToggleTooltip={toggleTooltip}
        onClearPinnedTooltip={clearPinnedTooltip}
      />
      <TimelineRow
        label="うんち"
        records={poop}
        from={from}
        to={to}
        hourTicks={hourTicks}
        tone="poop-dot"
        pinnedTooltipId={pinnedTooltipId}
        onToggleTooltip={toggleTooltip}
        onClearPinnedTooltip={clearPinnedTooltip}
      />
      <TimelineRow
        label="睡眠"
        records={sleep}
        from={from}
        to={to}
        hourTicks={hourTicks}
        tone="sleep-dot"
        sleepIntervals={sleepIntervals}
        pinnedTooltipId={pinnedTooltipId}
        onToggleTooltip={toggleTooltip}
        onClearPinnedTooltip={clearPinnedTooltip}
      />
    </section>
  );
}

const poopDetailLabels: Record<string, Record<string, string>> = {
  amount: { minimum: 'ちょっと', small: '少なめ', normal: 'ふつう', large: '多め' },
  hardness: { diarrhea: '下痢', soft: 'やわらかめ', normal: 'ふつう', hard: 'かため' },
  color: {
    white: '白',
    yellow: '黄',
    orange: '橙',
    brown: '茶',
    green: '緑',
    red: '赤',
    black: '黒',
  },
};

function poopDetailsText(record: FeedRecord): string | null {
  const details = record.details;
  if (!details) return null;
  const parts = (['amount', 'hardness', 'color'] as const)
    .map((key) => {
      const raw = details[key];
      const label = typeof raw === 'string' ? poopDetailLabels[key]?.[raw] : undefined;
      if (!label) return null;
      const heading = key === 'amount' ? '量' : key === 'hardness' ? 'かたさ' : '色';
      return heading + ' ' + label;
    })
    .filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

function breastfeedingDetails(record: FeedRecord): string[] {
  const parts: string[] = [];
  if (
    typeof record.leftTime === 'number' &&
    Number.isFinite(record.leftTime) &&
    record.leftTime >= 0
  ) {
    parts.push('左 ' + durationLabel(record.leftTime * 1000));
  }
  if (
    typeof record.rightTime === 'number' &&
    Number.isFinite(record.rightTime) &&
    record.rightTime >= 0
  ) {
    parts.push('右 ' + durationLabel(record.rightTime * 1000));
  }
  if (record.last === 'left' || record.last === 'right') {
    parts.push('最後は' + (record.last === 'left' ? '左' : '右'));
  }
  return parts.length === 0 ? ['授乳時間の記録なし'] : parts;
}

function formatDueTime(date: Date): string {
  return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(date);
}

const feedingIntervalOptions = Array.from({ length: 25 }, (_, index) => 120 + index * 5);

function formatFeedingInterval(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return String(hours) + '時間' + (remainingMinutes > 0 ? String(remainingMinutes) + '分' : '');
}

export default function Dashboard({
  feed,
  now,
  lastFetchedAt,
  errorKind,
  retryInSeconds,
  isLoading,
  isMock,
  feedingInterval,
  theme,
  savingNotice,
  onChangeFeed,
  onFeedingIntervalChange,
  onThemeChange,
}: DashboardProps) {
  const analytics = feed ? getFeedAnalytics(feed, new Date(now)) : null;
  const formula = analytics?.formula;
  const lastFormula = formula?.lastAt ?? null;
  const lastFormulaRecord = feed
    ? validFeedRecords(feed, ['Formula'])
        .slice()
        .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime))
        .at(-1)
    : undefined;
  const lastFormulaAmount = lastFormulaRecord ? recordMilkAmount(lastFormulaRecord) : null;
  const estimatedNext = nextFeedingEstimate(lastFormula, feedingInterval);
  const feedClockNow =
    feed && lastFetchedAt !== null ? Date.parse(feed.generated_at) + (now - lastFetchedAt) : now;
  const remaining = estimatedNext ? estimatedNext.getTime() - feedClockNow : null;
  const error = feedErrorMessage(errorKind, retryInSeconds);
  const expressed = analytics?.expressedBreastMilk;
  const breastfeeding = analytics?.breastFeeding;

  return (
    <main className="dashboard-page">
      <header className="app-header">
        <a className="wordmark" href="./" aria-label="ぴよログ かんたんダッシュボード ホーム">
          <span className="wordmark-icon" aria-hidden="true">
            ぴ
          </span>
          <span>
            <strong>ぴよログ かんたんダッシュボード</strong>
            {isMock && <span className="sample-badge">サンプルデータ</span>}
          </span>
        </a>
        {feed && (
          <div className="range-context">
            <span className="range-context-label">対象範囲</span>
            <h1>
              <time dateTime={feed.range.from}>{formatLocalDateTime(feed.range.from)}</time>
              {' 〜 '}
              <time dateTime={feed.range.to}>{formatLocalDateTime(feed.range.to)}</time>
            </h1>
          </div>
        )}
        <button
          className="text-button header-feed-change"
          type="button"
          onClick={onChangeFeed}
          disabled={isLoading}
        >
          Feed URLを変更
        </button>
        <div className="header-actions">
          <button
            className="theme-toggle"
            type="button"
            aria-label={theme === 'dark' ? 'ライトモードに切り替える' : 'ダークモードに切り替える'}
            title={theme === 'dark' ? 'ライトモードに切り替える' : 'ダークモードに切り替える'}
            onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              {theme === 'light' ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                </>
              ) : (
                <path d="M21 12.8A9 9 0 0 1 11.2 3a9 9 0 1 0 9.8 9.8Z" />
              )}
            </svg>
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        {savingNotice && (
          <div className="alert alert-note" role="status">
            {savingNotice}
          </div>
        )}

        {error && (
          <div className={'alert ' + (feed ? 'alert-note' : 'alert-error')} role="alert">
            <strong>{feed ? '最新の取得に失敗しました' : 'Feedを読み込めませんでした'}</strong>
            <span>{error}</span>
            {feed && (
              <span>
                前回のデータ（取得{' '}
                {lastFetchedAt
                  ? formatLocalDateTime(new Date(lastFetchedAt).toISOString())
                  : '時刻不明'}
                ）を表示中です。
              </span>
            )}
          </div>
        )}

        {isLoading && !feed && (
          <section className="loading-panel" aria-live="polite">
            <span className="loading-spinner" />
            <p>24時間Feedを読み込んでいます…</p>
            <small>データはこのブラウザ内で表示します。</small>
          </section>
        )}

        {feed && analytics && formula && (
          <>
            <section className="next-feed-card" aria-label="ミルク記録と間隔">
              {estimatedNext && remaining !== null ? (
                <div className="next-feed-layout">
                  <div className="next-feed-origin">
                    <span className="next-feed-label">前回のミルク</span>
                    <strong>{lastFormula ? formatDueTime(new Date(lastFormula)) : '—'}</strong>
                    <small>
                      {lastFormulaAmount !== null
                        ? numberFormat.format(lastFormulaAmount) + ' ml'
                        : '量の記録なし'}
                    </small>
                  </div>
                  <div className="next-feed-result">
                    <div className="next-feed-estimate-line">
                      <div className="next-feed-interval">
                        <select
                          value={feedingInterval}
                          onChange={(event) => onFeedingIntervalChange(Number(event.target.value))}
                          aria-label="前回からの間隔"
                        >
                          {feedingIntervalOptions.map((minutes) => (
                            <option key={minutes} value={minutes / 60}>
                              {formatFeedingInterval(minutes)}
                            </option>
                          ))}
                        </select>
                        <span className="next-feed-after">後は</span>
                      </div>
                      <div className="next-feed-time">
                        <strong>{formatDueTime(estimatedNext)}</strong>
                        <span className="next-feed-countdown">
                          {remaining > 0
                            ? 'あと' + durationLabel(remaining)
                            : durationLabel(-remaining) + '経過'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="next-feed-empty">
                  <strong>—</strong>
                  <span>粉ミルクを記録すると、前回の時刻を表示できます</span>
                </div>
              )}
            </section>

            {feed.records.length === 0 && (
              <div className="empty-feed">
                <span aria-hidden="true">○</span>
                <strong>直近24時間の記録はありません</strong>
                <p>正常なData Feedを受け取りました。</p>
              </div>
            )}

            <section className="summary-section" aria-labelledby="summary-title">
              <div className="section-heading summary-heading">
                <div>
                  <h2 id="summary-title">サマリー</h2>
                </div>
                <span className="section-note">今日（0時〜現在）・直近24時間</span>
              </div>
              <dl className="summary-grid summary-milk">
                <CountTile
                  label="今日の合計ミルク量"
                  value={amountText(formula.todayTotal, formula.today)}
                  detail={'0時〜現在 · ' + String(formula.today) + '回'}
                />
                <CountTile
                  label="直近24時間の合計ミルク量"
                  value={amountText(formula.last24HoursTotal, formula.last24Hours)}
                  detail={String(formula.last24Hours) + '回'}
                />
                <CountTile
                  label="ミルク1回あたりの平均量"
                  value={
                    formula.average === null ? '—' : numberFormat.format(formula.average) + ' ml'
                  }
                  detail="直近24時間のうち、量が記録されたミルクから計算"
                />
                <CountTile
                  label="平均ミルク間隔"
                  value={
                    formula.averageIntervalMillis === null
                      ? '—'
                      : durationLabel(formula.averageIntervalMillis)
                  }
                  detail="直近24時間のミルク記録から計算"
                />
              </dl>
              <dl className="summary-care">
                <CountTile
                  label="搾母乳"
                  value={amountText(
                    expressed?.last24HoursTotal ?? null,
                    expressed?.last24Hours ?? 0,
                  )}
                  detail={'直近24時間 · ' + String(expressed?.last24Hours ?? 0) + '回'}
                />
                <CountTile
                  label="母乳"
                  value={String(breastfeeding?.last24Hours ?? 0) + '回'}
                  detail={
                    '直近24時間 · ' +
                    (breastfeeding?.totalMillis == null
                      ? '授乳時間の記録なし'
                      : '合計授乳時間 ' + durationLabel(breastfeeding.totalMillis)) +
                    (breastfeeding?.measuredAmount == null
                      ? ''
                      : ' · 記録量 ' + numberFormat.format(breastfeeding.measuredAmount) + ' ml')
                  }
                />
                <CountTile
                  label="今日のおしっこ"
                  value={String(analytics.pee.today) + '回'}
                  detail={
                    '直近24時間 ' +
                    String(analytics.pee.last24Hours) +
                    '回 · 最後 ' +
                    timeText(analytics.pee.lastAt)
                  }
                />
                <CountTile
                  label="今日のうんち"
                  value={String(analytics.poop.today) + '回'}
                  detail={
                    '直近24時間 ' +
                    String(analytics.poop.last24Hours) +
                    '回 · 最後 ' +
                    timeText(analytics.poop.lastAt)
                  }
                />
                <CountTile
                  label="睡眠"
                  value={
                    analytics.sleep.confirmedMillis === 0
                      ? '—'
                      : durationLabel(analytics.sleep.confirmedMillis)
                  }
                  detail={
                    analytics.sleep.currentSleepStart
                      ? '直近24時間 · 睡眠中（' +
                        formatLocalTime(analytics.sleep.currentSleepStart) +
                        '〜）'
                      : analytics.sleep.intervals.length === 0
                        ? '直近24時間 · 睡眠の記録なし'
                        : '直近24時間 · 起床までの合計'
                  }
                />
              </dl>
            </section>

            <Timeline feed={feed} sleepIntervals={analytics.sleep.intervals} />
            <Suspense
              fallback={<div className="chart-loading panel">グラフを読み込んでいます…</div>}
            >
              <FormulaChart feed={feed} />
            </Suspense>

            <footer className="data-footer">
              <span>
                {isMock
                  ? '開発用サンプルデータ'
                  : '最終取得 ' +
                    (lastFetchedAt
                      ? formatLocalDateTime(new Date(lastFetchedAt).toISOString())
                      : '—') +
                    (isLoading
                      ? ' · 更新中'
                      : errorKind
                        ? ' · 自動更新エラー'
                        : ' · 自動更新 約1分ごと') +
                    ' · Feed生成 ' +
                    formatLocalDateTime(feed.generated_at)}
              </span>
            </footer>
          </>
        )}

        {!feed && !isLoading && !error && (
          <section className="loading-panel">
            <p>Data Feedの接続状態を確認してください。</p>
            <button className="button button-primary" type="button" onClick={onChangeFeed}>
              Feed URLを設定
            </button>
          </section>
        )}

        <Disclaimer />
      </div>
    </main>
  );
}
