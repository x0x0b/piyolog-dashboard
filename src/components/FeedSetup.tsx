import { useEffect, useState, type FormEvent } from 'react';
import { isValidFeedUrl } from '../data/feedClient';
import type { FeedErrorKind } from '../data/feedClient';
import { feedErrorMessage } from '../lib/feedErrorMessage';

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
  const [remember, setRemember] = useState(hasSavedFeed);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const error = validationError ?? feedErrorMessage(errorKind, retryInSeconds);

  useEffect(() => {
    if (!hasSavedFeed) setRemember(false);
  }, [hasSavedFeed]);

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
        <div className="brand-mark" aria-hidden="true">
          <span>ぴ</span>
        </div>
        <h1>ぴよログ かんたんダッシュボード</h1>
        <p className="setup-lead">
          ぴよログアプリからコピーした24時間Feed URLを貼り付けて、直近24時間の記録を見やすくまとめます。
        </p>

        <form onSubmit={submit}>
          <label className="field-label" htmlFor="feed-url">
            Feed URL
          </label>
          <input
            id="feed-url"
            type="password"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setValidationError(null);
            }}
            placeholder="ぴよログからコピーしたURLを貼り付け"
            aria-describedby="feed-url-hint"
          />
          <p className="field-hint" id="feed-url-hint">
            URL全体をそのまま貼り付けてください。入力内容は画面上では伏せて表示します。
          </p>

          <label className="check-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>この端末に保存する</span>
          </label>
          <p className="field-hint check-hint">
            保存を選んだ場合だけ、このブラウザのlocalStorageにFeed URLを保存します。
          </p>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          {savingNotice && <div className="alert alert-note">{savingNotice}</div>}

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

        <aside className="privacy-note">
          <h2>プライバシーについて</h2>
          <p>
            Feed URLはパスワードと同じように扱ってください。通信はこのブラウザから
            <code>feed.piyolog.com</code>へ直接行い、このアプリの運営者には送信しません。
            育児記録はブラウザ内のメモリで表示し、保存しません。
          </p>
        </aside>

        {import.meta.env.DEV && (
          <button className="button button-quiet button-wide mock-button" onClick={onUseMock}>
            サンプルデータで表示を試す（開発用）
          </button>
        )}
        <p className="setup-footnote">
          無料版Data Feedは直近24時間を取得し、作成から90日で期限切れになります。
        </p>
      </div>
    </main>
  );
}
