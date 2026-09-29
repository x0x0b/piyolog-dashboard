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

export type ThemePreference = 'system' | 'light' | 'dark';

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
  savedFeedExists: boolean;
  savingNotice: string | null;
  onRefresh: () => void;
  onChangeFeed: () => void;
  onDeleteSavedFeed: () => void;
  onFeedingIntervalChange: (hours: number) => void;
  onThemeChange: (theme: ThemePreference) => void;
}

const numberFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
const FormulaChart = lazy(() => import('./FormulaChart'));

function amountText(value: number | null, eventCount: number): string {
  if (value === null) return eventCount === 0 ? '0 ml' : '—';
  return numberFormat.format(value) + ' ml';
}

function timeText(iso: string | null): string {
  return iso === null ? '—' : formatLocalTime(iso);
}

function CountTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <article className={'summary-tile' + (tone ? ' ' + tone : '')}>
      <p className="tile-label">{label}</p>
      <p className="tile-value">{value}</p>
      <p className="tile-detail">{detail}</p>
    </article>
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

function TimelineTooltip({
  id,
  info,
}: {
  id: string;
  info: TimelineTooltipInfo;
}) {
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
          const position =
            (xPercent(interval.startAt, from, to) + xPercent(endAt, from, to)) / 2;
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
  const midpoint = new Date(from + (to - from) / 2).toISOString();
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
          <p className="eyebrow">ACTIVITY</p>
          <h2 id="timeline-title">24時間のタイムライン</h2>
        </div>
      </div>
      <div className="timeline-axis">
        <span>{formatLocalTime(feed.range.from)}</span>
        <span>{formatLocalTime(midpoint)}</span>
        <span>{formatLocalTime(feed.range.to)}</span>
      </div>
      <TimelineRow
        label="ミルク"
        records={formula}
        from={from}
        to={to}
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
  savedFeedExists,
  savingNotice,
  onRefresh,
  onChangeFeed,
  onDeleteSavedFeed,
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
  const elapsed = lastFormula ? feedClockNow - Date.parse(lastFormula) : null;
  const remaining = estimatedNext ? estimatedNext.getTime() - feedClockNow : null;
  const error = feedErrorMessage(errorKind, retryInSeconds);
  const canRefresh = !isLoading && retryInSeconds === 0 && !isMock;
  const rangeText = feed
    ? formatLocalDateTime(feed.range.from) + '〜' + formatLocalTime(feed.range.to)
    : '';
  const expressed = analytics?.expressedBreastMilk;
  const breastfeeding = analytics?.breastFeeding;

  return (
    <main className="dashboard-page">
      <header className="app-header">
        <a className="wordmark" href="./" aria-label="きょうの育児ログ ホーム">
          <span className="wordmark-icon" aria-hidden="true">
            ひ
          </span>
          <span>
            <strong>きょうの育児ログ</strong>
            <small>{isMock ? 'サンプルデータ' : '非公式 · 24時間Feed'}</small>
          </span>
        </a>
        <div className="header-actions">
          <label className="theme-control">
            <span className="sr-only">テーマ</span>
            <span className="theme-symbol" aria-hidden="true">
              {theme === 'system' ? '◐' : theme === 'dark' ? '☾' : '☀'}
            </span>
            <select
              aria-label="テーマ"
              value={theme}
              onChange={(event) => onThemeChange(event.target.value as ThemePreference)}
            >
              <option value="system">自動テーマ</option>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </label>
          <button
            className="button button-refresh"
            onClick={onRefresh}
            disabled={!canRefresh}
            type="button"
          >
            <span aria-hidden="true">↻</span>
            {isLoading ? '更新中' : retryInSeconds > 0 ? retryInSeconds + '秒後' : '更新'}
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        <section className="page-intro">
          <div>
            <p className="eyebrow">
              {new Intl.DateTimeFormat('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              }).format(new Date(now))}
            </p>
            <h1>今日のようす</h1>
          </div>
          <div className="feed-actions">
            <button
              className="text-button"
              type="button"
              onClick={onChangeFeed}
              disabled={isLoading}
            >
              Feed URLを変更
            </button>
            {savedFeedExists && (
              <button
                className="text-button text-button-muted"
                type="button"
                onClick={onDeleteSavedFeed}
              >
                保存URLを削除
              </button>
            )}
          </div>
        </section>

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
            <section className="last-feed-card">
              <div className="last-feed-top">
                <div>
                  <p className="eyebrow">LAST FORMULA</p>
                  <h2>前回のミルク</h2>
                </div>
                <label className="interval-picker">
                  <span>間隔の参考設定</span>
                  <select
                    value={feedingInterval}
                    onChange={(event) => onFeedingIntervalChange(Number(event.target.value))}
                    aria-label="次回目安の計算に使う間隔"
                  >
                    <option value={2}>2時間</option>
                    <option value={2.5}>2時間30分</option>
                    <option value={3}>3時間</option>
                    <option value={3.5}>3時間30分</option>
                    <option value={4}>4時間</option>
                  </select>
                </label>
              </div>
              {lastFormula ? (
                <div className="last-feed-main">
                  <div className="last-feed-amount">
                    <strong>{formatLocalTime(lastFormula)}</strong>
                    <span>
                      {lastFormulaAmount !== null
                        ? numberFormat.format(lastFormulaAmount) + ' ml'
                        : '量の記録なし'}
                    </span>
                  </div>
                  <div className="last-feed-elapsed">
                    <span>
                      {elapsed === null
                        ? ''
                        : elapsed < 0
                          ? '経過時間を表示できません'
                          : durationLabel(elapsed) + '経過'}
                    </span>
                    <div className="estimate-box">
                      {estimatedNext && remaining !== null && remaining > 0 ? (
                        <>
                          <strong>あと{durationLabel(remaining)}</strong>
                          <span>次回目安 {formatDueTime(estimatedNext)}</span>
                        </>
                      ) : (
                        <>
                          <strong>{estimatedNext ? '参考時刻' : '次回目安'}</strong>
                          <span>
                            {estimatedNext ? '過ぎています · ' + formatDueTime(estimatedNext) : '—'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="empty-inline last-empty">直近24時間のミルク記録はありません</p>
              )}
              <p className="reference-caption">
                次回目安は最終ミルク時刻に設定間隔を足した参考表示です。ぴよログの提供値や医療的な推奨ではありません。
              </p>
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
                  <p className="eyebrow">SUMMARY</p>
                  <h2 id="summary-title">サマリー</h2>
                </div>
                <span className="section-note">今日と直近24時間</span>
              </div>
              <div className="summary-grid">
                <CountTile
                  label="今日のミルク"
                  value={amountText(formula.todayTotal, formula.today)}
                  detail={'今日 ' + String(formula.today) + '回'}
                  tone="tile-formula"
                />
                <CountTile
                  label="直近24時間のミルク"
                  value={amountText(formula.last24HoursTotal, formula.last24Hours)}
                  detail={'直近24時間 ' + String(formula.last24Hours) + '回'}
                  tone="tile-formula"
                />
                <CountTile
                  label="1回平均量"
                  value={
                    formula.average === null ? '—' : numberFormat.format(formula.average) + ' ml'
                  }
                  detail="量が記録されたミルク"
                />
                <CountTile
                  label="平均ミルク間隔"
                  value={
                    formula.averageIntervalMillis === null
                      ? '—'
                      : durationLabel(formula.averageIntervalMillis)
                  }
                  detail="直近24時間の記録から計算"
                />
                <CountTile
                  label="おしっこ"
                  value={String(analytics.pee.today) + '回'}
                  detail={
                    '直近24時間 ' +
                    String(analytics.pee.last24Hours) +
                    '回 · 最終 ' +
                    timeText(analytics.pee.lastAt)
                  }
                  tone="tile-pee"
                />
                <CountTile
                  label="うんち"
                  value={String(analytics.poop.today) + '回'}
                  detail={
                    '直近24時間 ' +
                    String(analytics.poop.last24Hours) +
                    '回 · 最終 ' +
                    timeText(analytics.poop.lastAt)
                  }
                  tone="tile-poop"
                />
                <CountTile
                  label="搾母乳"
                  value={amountText(
                    expressed?.last24HoursTotal ?? null,
                    expressed?.last24Hours ?? 0,
                  )}
                  detail={
                    '直近24時間 ' + String(expressed?.last24Hours ?? 0) + '回 · 粉ミルクとは別集計'
                  }
                  tone="tile-expressed"
                />
                <CountTile
                  label="母乳"
                  value={String(breastfeeding?.last24Hours ?? 0) + '回'}
                  detail={
                    (breastfeeding?.totalMillis == null
                      ? '授乳時間の記録なし'
                      : '授乳時間 ' + durationLabel(breastfeeding.totalMillis)) +
                    (breastfeeding?.measuredAmount == null
                      ? ''
                      : ' · 入力量 ' + numberFormat.format(breastfeeding.measuredAmount) + ' ml')
                  }
                />
                <CountTile
                  label="確定した睡眠時間"
                  value={
                    analytics.sleep.confirmedMillis === 0
                      ? '—'
                      : durationLabel(analytics.sleep.confirmedMillis)
                  }
                  detail={
                    analytics.sleep.currentSleepStart
                      ? '睡眠中 · ' + formatLocalTime(analytics.sleep.currentSleepStart) + 'から'
                      : analytics.sleep.intervals.length === 0
                        ? '睡眠の記録なし'
                        : 'Sleepから次のWakeUpまで'
                  }
                  tone="tile-sleep"
                />
              </div>
            </section>

            <Suspense
              fallback={<div className="chart-loading panel">グラフを読み込んでいます…</div>}
            >
              <FormulaChart feed={feed} />
            </Suspense>
            <Timeline feed={feed} sleepIntervals={analytics.sleep.intervals} />

            <footer className="data-footer">
              <span>対象範囲 {rangeText}</span>
              <span>
                {isMock
                  ? '開発用サンプルデータ'
                  : '最終取得 ' +
                    (lastFetchedAt
                      ? formatLocalDateTime(new Date(lastFetchedAt).toISOString())
                      : '—') +
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
      </div>
    </main>
  );
}
