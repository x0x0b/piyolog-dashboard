import type { FeedErrorKind } from '../data/feedClient';

export function feedErrorMessage(
  kind: FeedErrorKind | 'cooldown' | null,
  waitSeconds: number,
): string | null {
  switch (kind) {
    case 'invalid-url':
      return 'ぴよログからコピーした24h Feed URLをそのまま貼り付けてください。URLのパスやクエリは変更しないでください。';
    case 'unavailable':
      return 'データフィードを利用できません。URLの誤り、期限切れ、失効などの可能性があります。ぴよログアプリの設定を確認してFeed URLを設定し直してください。無料Feedの有効期限は90日です。この状態では自動更新を停止しています。';
    case 'too-large':
      return 'データフィードのレスポンスが大きすぎます。公式仕様では、より短い取得期間のFeedを作成するよう案内されています。このMVPは24時間Feedに対応しています。この状態では自動更新を停止しています。';
    case 'rate-limit':
      return 'アクセスが多すぎるため、しばらく取得を停止しています。時間を置いて自動で再試行します。';
    case 'server':
      return 'ぴよログ側で一時的な問題が発生しています。時間を置いて自動で再試行します。';
    case 'network':
      return 'Feedに接続できませんでした。ネットワーク状態を確認してください。接続が回復すると自動で再試行します。';
    case 'invalid-response':
      return 'Data Feedのレスポンスを読み取れませんでした。時間を置いて自動で再試行します。';
    case 'unsupported-schema':
      return 'このData Feedの仕様バージョンにはまだ対応していないため、自動更新を停止しています。';
    case 'cooldown':
      return (
        '同じFeed URLへの連続アクセスを避けるため、あと' +
        String(waitSeconds) +
        '秒後に自動で再試行します。'
      );
    default:
      return null;
  }
}
