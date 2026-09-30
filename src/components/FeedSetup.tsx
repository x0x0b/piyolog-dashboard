import { useState, type FormEvent } from 'react';
import { isValidFeedUrl } from '../data/feedClient';
import type { FeedErrorKind } from '../data/feedClient';
import { feedErrorMessage } from '../lib/feedErrorMessage';
import Disclaimer from './Disclaimer';

interface FeedSetupProps {
  hasSavedFeed: boolean;
  errorKind: FeedErrorKind | 'cooldown' | null;
  retryInSeconds: number;
  savingNotice: string | null;
  onConnect: (url: string, remember: boolean) => Promise<void>;
  onDeleteSaved: () => void;
  onUseMock: () => void;
}

export default function FeedSetup({
  hasSavedFeed,
  errorKind,
  retryInSeconds,
  savingNotice,
  onConnect,
  onDeleteSaved,
  onUseMock,
}: FeedSetupProps) {
  const [url, setUrl] = useState('');
  const [remember, setRemember] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const error = validationError ?? feedErrorMessage(errorKind, retryInSeconds);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    if (!isValidFeedUrl(url)) {
      setValidationError(feedErrorMessage('invalid-url', 0));
      return;
    }
    setIsSubmitting(true);
    try {
      await onConnect(url, remember);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="setup-page">
      <div className="setup-card">
        <img
          className="brand-mark"
          src={import.meta.env.BASE_URL + 'dashboard-icon.svg'}
          alt=""
          width="48"
          height="48"
        />
        <h1>
          ぴよログ<span>かんたんダッシュボード</span>
        </h1>
        <p className="setup-lead">ぴよログの直近24時間の記録を見やすくまとめます。</p>

        <form onSubmit={submit}>
          <label className="field-label" htmlFor="feed-url">
            Feed URL
          </label>
          <input
            id="feed-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setValidationError(null);
            }}
            placeholder="https://feed.piyolog.com/v1/feed/24h/12345678-1234-4123-8123-123456789abc/ExampleToken_0123456789abcdefghijklmnopqrstu"
            aria-describedby={error ? 'feed-url-hint feed-url-error' : 'feed-url-hint'}
          />
          <p className="field-hint" id="feed-url-hint">
            ぴよログで「期間」を「直近24時間」に設定したFeed URLを貼り付けてください。
          </p>

          {error && (
            <div className="alert alert-error" id="feed-url-error" role="alert">
              {error}
            </div>
          )}

          <label className="check-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>この端末に保存する</span>
          </label>
          <p className="field-hint check-hint">
            初期状態ではオンです。保存しない場合はチェックを外してください。
          </p>

          {savingNotice && <div className="alert alert-note">{savingNotice}</div>}

          <aside className="privacy-note">
            <h2>プライバシーについて</h2>
            <p>
              Feed URLはこのブラウザから<code>feed.piyolog.com</code>
              へ直接送信し、このアプリの運営者には送信しません。育児記録はブラウザ内で表示し、保存しません。
            </p>
          </aside>

          <Disclaimer />

          <button
            className="button button-primary button-wide"
            type="submit"
            disabled={isSubmitting || retryInSeconds > 0}
          >
            {isSubmitting ? '接続を確認しています…' : '接続してダッシュボードを開く'}
          </button>
        </form>

        {hasSavedFeed && (
          <button
            className="button button-quiet button-wide delete-saved"
            type="button"
            onClick={onDeleteSaved}
          >
            保存済みFeed URLを削除
          </button>
        )}

        {import.meta.env.DEV && (
          <button className="button button-quiet button-wide mock-button" onClick={onUseMock}>
            サンプルデータで表示を試す
          </button>
        )}
        <p className="setup-footnote">
          無料版Data Feedは直近24時間を取得し、作成から90日で期限切れになります。
        </p>
      </div>
    </main>
  );
}
