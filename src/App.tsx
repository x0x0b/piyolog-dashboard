import { useCallback, useEffect, useRef, useState } from 'react';
import Dashboard, { type ThemePreference } from './components/Dashboard';
import FeedSetup from './components/FeedSetup';
import { createMockFeed } from './data/mockFeed';
import { FeedRequestError, fetchFeed, isValidFeedUrl } from './data/feedClient';
import type { FeedErrorKind } from './data/feedClient';
import type { PiyologFeedV1 } from './types/feed';

const FEED_STORAGE_KEY = 'piyolog-dashboard:feed-url';
const PREFERENCES_STORAGE_KEY = 'piyolog-dashboard:preferences';

interface Preferences {
  feedingInterval: number;
  theme: ThemePreference;
}

type Screen = 'setup' | 'dashboard';
type AppErrorKind = FeedErrorKind | 'cooldown';

function readSavedUrl(): string | null {
  try {
    const saved = window.localStorage.getItem(FEED_STORAGE_KEY);
    return saved && saved.length > 0 ? saved : null;
  } catch {
    return null;
  }
}

function readPreferences(): Preferences {
  const defaults: Preferences = { feedingInterval: 3, theme: 'system' };
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const candidate = parsed as Record<string, unknown>;
    const feedingInterval =
      typeof candidate.feedingInterval === 'number' &&
      [2, 2.5, 3, 3.5, 4].includes(candidate.feedingInterval)
        ? candidate.feedingInterval
        : defaults.feedingInterval;
    const theme =
      candidate.theme === 'system' || candidate.theme === 'light' || candidate.theme === 'dark'
        ? candidate.theme
        : defaults.theme;
    return { feedingInterval, theme };
  } catch {
    return defaults;
  }
}

function writeSavedUrl(url: string | null): boolean {
  try {
    if (url === null) {
      window.localStorage.removeItem(FEED_STORAGE_KEY);
    } else {
      window.localStorage.setItem(FEED_STORAGE_KEY, url);
    }
    return true;
  } catch {
    return false;
  }
}

function cooldownFor(kind: FeedErrorKind, failures: number): number {
  if (kind === 'network' || kind === 'server' || kind === 'rate-limit') {
    const exponential = Math.min(15 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 4));
    const serverFloor = kind === 'rate-limit' ? 120_000 : 0;
    return Math.max(exponential, serverFloor) + Math.floor(Math.random() * 5000);
  }
  return 60_000;
}

export default function App() {
  const [initialSavedUrl] = useState(readSavedUrl);
  const usableInitialUrl =
    initialSavedUrl && isValidFeedUrl(initialSavedUrl) ? initialSavedUrl : null;
  const [screen, setScreen] = useState<Screen>(usableInitialUrl ? 'dashboard' : 'setup');
  const [activeUrl, setActiveUrl] = useState<string | null>(usableInitialUrl);
  const [hasSavedFeed, setHasSavedFeed] = useState(initialSavedUrl !== null);
  const [feed, setFeed] = useState<PiyologFeedV1 | null>(null);
  const [isLoading, setIsLoading] = useState(usableInitialUrl !== null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [errorKind, setErrorKind] = useState<AppErrorKind | null>(null);
  const [nextAllowedAt, setNextAllowedAt] = useState(0);
  const [isMock, setIsMock] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [preferences, setPreferences] = useState(readPreferences);
  const [savingNotice, setSavingNotice] = useState<string | null>(null);

  const inFlight = useRef(false);
  const nextAllowedAtRef = useRef(0);
  const failureCount = useRef(0);

  const requestFeed = useCallback(async (url: string, preserveData: boolean): Promise<boolean> => {
    if (inFlight.current) return false;
    const attemptedAt = Date.now();
    if (attemptedAt < nextAllowedAtRef.current) {
      setErrorKind('cooldown');
      return false;
    }

    inFlight.current = true;
    setIsLoading(true);
    setErrorKind(null);
    if (!preserveData) setFeed(null);

    try {
      const result = await fetchFeed(url);
      const completedAt = Date.now();
      setFeed(result);
      setLastFetchedAt(completedAt);
      setErrorKind(null);
      failureCount.current = 0;
      const allowedAt = completedAt + 60_000;
      nextAllowedAtRef.current = allowedAt;
      setNextAllowedAt(allowedAt);
      return true;
    } catch (error) {
      const kind: FeedErrorKind = error instanceof FeedRequestError ? error.kind : 'network';
      setErrorKind(kind);
      failureCount.current += 1;
      const allowedAt = Date.now() + cooldownFor(kind, failureCount.current);
      nextAllowedAtRef.current = allowedAt;
      setNextAllowedAt(allowedAt);
      return false;
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (usableInitialUrl) void requestFeed(usableInitialUrl, false);
  }, [requestFeed, usableInitialUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (errorKind === 'cooldown' && now >= nextAllowedAt) setErrorKind(null);
  }, [errorKind, nextAllowedAt, now]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // The dashboard remains usable when browser storage is disabled.
    }
  }, [preferences]);

  useEffect(() => {
    const root = document.documentElement;
    if (preferences.theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', preferences.theme);
    }
  }, [preferences.theme]);

  const retryInSeconds = Math.max(0, Math.ceil((nextAllowedAt - now) / 1000));

  async function connect(url: string, remember: boolean): Promise<void> {
    if (!isValidFeedUrl(url)) {
      setErrorKind('invalid-url');
      return;
    }
    setSavingNotice(null);
    setActiveUrl(url);
    setIsMock(false);
    setFeed(null);
    setLastFetchedAt(null);
    setErrorKind(null);

    const storageWorked = writeSavedUrl(remember ? url : null);
    setHasSavedFeed(storageWorked ? remember : hasSavedFeed);
    if (!storageWorked) {
      setSavingNotice(
        remember
          ? 'このブラウザではlocalStorageに保存できませんでした。今回の表示中はメモリ内で接続します。'
          : 'このブラウザで保存済みURLを削除できませんでした。ブラウザのサイトデータを確認してください。',
      );
    }

    const connected = await requestFeed(url, false);
    if (connected) setScreen('dashboard');
  }

  function changeFeed() {
    if (isLoading) return;
    removeSavedFeed();
    setScreen('setup');
    setActiveUrl(null);
    setFeed(null);
    setLastFetchedAt(null);
    setErrorKind(null);
    setIsMock(false);
  }

  function removeSavedFeed() {
    const removed = writeSavedUrl(null);
    if (removed) setHasSavedFeed(false);
    if (!removed) {
      setSavingNotice(
        'このブラウザでは保存済みURLを削除できませんでした。ブラウザのサイトデータから削除してください。',
      );
    } else {
      setSavingNotice(null);
    }
  }

  function useMock() {
    setFeed(createMockFeed(new Date()));
    setActiveUrl(null);
    setLastFetchedAt(null);
    setErrorKind(null);
    setIsLoading(false);
    setIsMock(true);
    setScreen('dashboard');
  }

  function refresh() {
    if (activeUrl) void requestFeed(activeUrl, true);
  }

  function changeFeedingInterval(hours: number) {
    setPreferences((current) => ({ ...current, feedingInterval: hours }));
  }

  function changeTheme(theme: ThemePreference) {
    setPreferences((current) => ({ ...current, theme }));
  }

  if (screen === 'setup') {
    return (
      <FeedSetup
        hasSavedFeed={hasSavedFeed}
        errorKind={errorKind}
        retryInSeconds={retryInSeconds}
        savingNotice={savingNotice}
        onConnect={connect}
        onDeleteSaved={removeSavedFeed}
        onUseMock={useMock}
      />
    );
  }

  return (
    <Dashboard
      feed={feed}
      now={now}
      lastFetchedAt={lastFetchedAt}
      errorKind={errorKind}
      retryInSeconds={retryInSeconds}
      isLoading={isLoading}
      isMock={isMock}
      feedingInterval={preferences.feedingInterval}
      theme={preferences.theme}
      savingNotice={savingNotice}
      onRefresh={refresh}
      onChangeFeed={changeFeed}
      onFeedingIntervalChange={changeFeedingInterval}
      onThemeChange={changeTheme}
    />
  );
}
