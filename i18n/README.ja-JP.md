# 9Router

> これは短い翻訳版の要約です。正式なドキュメントは英語版の
> [README.md](../README.md) と [docs/README.md](../docs/README.md) です。

9Router はローカルで動作する AI ルーティングゲートウェイとダッシュボードです。
OpenAI 互換のエンドポイントを `/v1/*` にひとつだけ公開し、選択したプロバイダー
が求める形式へリクエストを変換します。モデル間とアカウント間の切り替えも行うた
め、あるプロバイダーがクォータを使い切ったり、レート制限にかかったり、障害を起
こしたりしても、クライアント側の設定はひとつのままで動き続けます。

<p align="center">
  <img src="../images/9router.png" alt="9Router のダッシュボード" width="800"/>
</p>

## インストール

```bash
npm install -g 9router
9router
```

ダッシュボードは `http://localhost:20128/dashboard`、OpenAI 互換 API は
`http://localhost:20128/v1` で提供されます。最初のログインには
`INITIAL_PASSWORD` が使われ、既定値は `123456` です。必ず変更してください。

詳しい手順は [docs/getting-started.md](../docs/getting-started.md) にあります。

## フォークの位置づけ

このリポジトリは [decolua/9router](https://github.com/decolua/9router) から
独立して保守されているフォークです。上流を追いかけながら、独自のスケジュールで
ローカルの修正と統合を取り込んでいます。9Router という名称、上流の履歴、
ライセンス、著作者表示はすべて維持しています。

上流は読み取り専用の参照であり、開発はすべてこちらで行われます。このフォークは
上流プロジェクトから承認されたものではなく、上流を代弁するものでもありません。

同期の手順を含む全文は、英語版 [README.md](../README.md) の "Fork status"
セクションにあります。

## ドキュメント

- [README.md](../README.md) 英語版のトップページ。
- [docs/README.md](../docs/README.md) ドキュメントの索引。

## ライセンス

MIT。[LICENSE](../LICENSE) を参照してください。
