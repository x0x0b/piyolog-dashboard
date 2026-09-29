const licenseUrl = 'https://github.com/x0x0b/piyolog-dashboard/blob/main/LICENSE';

export default function Disclaimer() {
  return (
    <section className="disclaimer-note" aria-labelledby="disclaimer-title">
      <h2 id="disclaimer-title">免責事項</h2>
      <p>
        このアプリはぴよログ公式とは関係のない非公式ツールです。表示内容は取得したData Feedをもとに集計した参考情報で、正確性・完全性・最新性を保証しません。必要な記録はぴよログアプリでもご確認ください。
      </p>
      <p>
        ミルク時間の目安は前回の粉ミルク記録に選択した間隔を加えた表示であり、医療上の助言や授乳の推奨ではありません。健康や授乳に関する判断は、お子さまの状態や医療専門家の指示を優先してください。
      </p>
      <p>
        法令上認められる範囲で、本アプリの利用または利用不能によって生じた損害について、開発者は責任を負いません。
      </p>
      <a href={licenseUrl} target="_blank" rel="noopener noreferrer">
        ソフトウェアライセンス（MIT）
      </a>
    </section>
  );
}
