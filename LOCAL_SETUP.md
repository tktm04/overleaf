# ローカル起動メモ（自分用）

macOS + Docker Desktop で develop 環境を立ち上げた時の手順と、ハマったポイント。

## 起動手順

```bash
cd develop
bin/build   # 初回のみ。約30〜60分（メモリ8GBなら逐次が安全、下記参照）
bin/up      # 全15サービス起動
```

ブラウザで `http://localhost/launchpad` → 初回管理者アカウント作成。

停止・再起動:

```bash
bin/down    # 停止
bin/up      # 再起動（再ビルド不要、ボリュームのデータは保持）
```

## ハマりどころと対処

### 1. ビルド時のメモリ不足

並列ビルドで `project-history` の yarn install が OOM Killed になる。

**対処**: `develop/.env` を作って下記を入れる（既に作成済み）。

```
COMPOSE_PARALLEL_LIMIT=1
```

逐次ビルドになって時間はかかるが安全。Docker Desktop のメモリを 12GB 以上に増やせば並列でも通る。

### 2. アップロード時の `EACCES: permission denied`

`web-data` ボリュームの `uploads/` が root 所有で、web プロセス（UID 1000）が書けない。

**症状**: zip プロジェクトをアップロードすると "Upload failed"。
web ログに `EACCES: permission denied, open '/overleaf/services/web/data/uploads/...'`。

**対処**: 一時コンテナでボリューム所有者を修正。

```bash
docker run --rm -v develop_web-data:/data alpine chown -R 1000:1000 /data
```

ブラウザでアップロードを Retry。

### 3. コンパイル時の Server Error（`Invalid URL`）

`dev.env` の `DOWNLOAD_HOST` にスキーム（`http://`）が付いていない。

**症状**: PDF コンパイルすると "Sorry, something went wrong... could not be compiled"。
web ログに `TypeError: Invalid URL` (`ClsiManager.mjs:720`)。

**対処**: `develop/dev.env` を修正（修正済み）。

```diff
-DOWNLOAD_HOST=clsi-nginx
+DOWNLOAD_HOST=http://clsi-nginx
```

CLSI を再起動:

```bash
docker compose up -d clsi
```

## 開発モード（ホットリロード）

通常起動は `bin/up`（コード変更で再ビルド要）。コードを書き換えながら開発するなら:

```bash
bin/dev                  # 全サービスを node --watch で起動
bin/dev web webpack      # 一部サービスだけ dev モード
```

フロントエンド変更を即反映したい場合は `webpack` も dev モードにする必要あり。

## デバッグポート

`bin/dev` 起動時、各サービスが Node inspector を expose する。Chrome の `chrome://inspect` から接続。

| サービス | ポート |
|---|---|
| web | 9229 |
| clsi | 9230 |
| chat | 9231 |
| contacts | 9232 |
| docstore | 9233 |
| document-updater | 9234 |
| filestore | 9235 |
| notifications | 9236 |
| real-time | 9237 |
| history-v1 | 9239 |
| project-history | 9240 |

## upstream 追従

```bash
git fetch upstream
git checkout main
git merge upstream/main   # または rebase
```

自分の改造は `feature/*` や `custom/*` ブランチで管理し、`main` は upstream 追従用に保つ。
