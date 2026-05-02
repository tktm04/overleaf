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

## Claude Review 機能（fork 拡張）

`Ask Claude` ボタンで未解決コメントを Claude に投げ、提案を thread に返信させる
機能。Claude は **ホスト側で動く claude-sidecar** 経由で呼ばれ、Claude Code の
サブスク認証を流用する（API キー不要）。

### 1. ホストで `claude` をログイン

```bash
claude /login   # 一度だけ
```

### 2. sidecar を起動

```bash
cd tools/claude-sidecar
npm install
npm start          # 127.0.0.1:8888 で待ち受け
```

別タブで動かしっぱなしにする。`npm run dev` だと watch モード。

#### 2b. 自動起動にする（任意・推奨）

毎回 `npm start` を打たなくて済むよう launchd に登録できる:

```bash
cd tools/claude-sidecar
./launchd/install.sh
```

- `~/Library/LaunchAgents/com.overleaf.claude-sidecar.plist` が作成される
- ログイン時に自動起動、クラッシュ時に再起動
- ログ: `~/Library/Logs/claude-sidecar/{out,err}.log`
- 動作確認: `curl http://127.0.0.1:8888/health`

外す時:

```bash
./launchd/uninstall.sh
```

### 3. Overleaf web の env 設定（既に dev.env に入っている）

```
OVERLEAF_CLAUDE_SIDECAR_URL=http://host.docker.internal:8888
```

dev.env を変更したら `docker compose up -d web` で再起動。

### 4. プロジェクトの設定（GUI推奨）

レビューパネル右上の **⚙ Configure Claude** ボタンから設定モーダルを開いて
保存すれば、`_claude/config.json` が自動生成される。手書きしたい場合の
スキーマ:

```json
{
  "sidecar_url": "",
  "experiment_repo": "/Users/tkdtmhs04/my_dev/typography-jailbreak/papers/neurips2026",
  "allowed_tools": ["Read", "Glob", "Grep"],
  "model": "claude-opus-4-7",
  "permission_mode": "default"
}
```

- `sidecar_url`: 空ならフォーク全体の env (`OVERLEAF_CLAUDE_SIDECAR_URL`) を使う。
  プロジェクトごとに別の sidecar に向けたい時だけ書く（例: SSH/Tailscale 先）
- `experiment_repo`: sidecar ホスト側の絶対パス。Claude の cwd になる
- `allowed_tools`: `Read/Glob/Grep` だけならコメント返信のみ。
  `Edit/Write/Bash` を加えると実ファイル編集・実験実行が可能
- `permission_mode`: `default` / `acceptEdits` / `plan` / `bypassPermissions`

任意で `_claude/WRITING_GUIDE.md`, `_claude/FEEDBACK_LESSONS.md`,
`_claude/related/*.tex` を置けば、自動でプロンプトに同梱される。

### 4b. SSH 先 (Ubuntu + Tailscale) で sidecar を動かす

実験リポジトリが Ubuntu サーバ上にある場合、その Ubuntu 上で sidecar を
動かして `sidecar_url` で指す:

```bash
# Ubuntu 側で
sudo apt-get install -y nodejs npm    # Node 22 系
npm i -g @anthropic-ai/claude-code    # claude バイナリ
claude /login                          # ブラウザで OAuth、サブスク認証

git clone git@github.com:tktm04/overleaf.git
cd overleaf/tools/claude-sidecar
npm install
PORT=8888 npm start                    # 127.0.0.1:8888 で待機
# Tailscale 越しにアクセスしたい場合は --host 0.0.0.0 が必要なら server.mjs を編集
```

`/etc/systemd/system/claude-sidecar.service` 等で常駐化推奨。

Mac 側の Overleaf プロジェクトの設定モーダルで:
- **Sidecar URL**: `http://ubuntu-tailscale:8888`（Tailscale の MagicDNS 名）
- **Experiment repo**: Ubuntu 側の絶対パス
  例: `/home/tkdtmhs04/typography-jailbreak/papers/neurips2026`

### 5. 動作確認

1. プロジェクトの本文にコメントを残す（ネイティブのコメント機能）
2. レビューパネル右上の Ask Claude（auto_awesome アイコン）をクリック
3. 数十秒待つと該当 thread に Claude の返信が追加される

### セッション

同じプロジェクトで Ask Claude を押すたび、前回の Claude セッションを resume
する（projectId → sessionId を sidecar が保存）。文脈をクリアしたい時:

```bash
curl -X POST http://127.0.0.1:8888/session/clear -H 'content-type: application/json' \
  -d '{"projectId":"<overleaf project id>"}'
```

### ハマりどころ

- **`host.docker.internal` が解決しない**: Docker Desktop on macOS は標準で解決
  できる。Linux だと `--add-host=host.docker.internal:host-gateway` が必要
- **`claude /login` がない**: `npm install -g @anthropic-ai/claude-code` または
  Claude Code を最新版に
- **sidecar から Permission denied**: `_claude/config.json` の `allowed_tools`
  と `permission_mode` を見直す。読み取りだけにする時は `Read`/`Glob`/`Grep`
  に絞ると安全

## overleaf.com からコメントを取り込む（ブックマークレット）

`tools/bookmarklets/import-overleaf-comments.js` のスクリプトをブックマークに
登録し、overleaf.com を開いてる時にクリックすると、その project の未解決
コメントスレッドを local fork に取り込める（先生が overleaf.com 側に残した
コメントを取り込んで Claude に自動レビューさせる用途）。

### 1. ブックマークレットを作る

ソースを minify して `javascript:` を頭に付けた URL を、ブックマークの URL
欄に貼る。例えば Node が使える環境なら:

```bash
npx -y terser \
  tools/bookmarklets/import-overleaf-comments.js \
  --compress --mangle | \
  awk 'BEGIN{ORS=""}{print}' | \
  pbcopy
```

これで `javascript:(async()=>{...})()` の最後まで圧縮された 1 行が
クリップボードに入る。Mac なら頭に `javascript:` を付けて貼り付け。

ブックマークバー（または任意のフォルダ）に `New Bookmark` で:

- **Name**: `Import to Claude`
- **URL**: `javascript:(...minified script...)`

### 2. 使い方

1. local fork を立ち上げ、対象 project を `http://localhost/project/<localId>`
   で一度開いておく（CSRF token をブックマークレットが取りに来るため）
2. overleaf.com の対象 project を開く
3. ブックマークバーの **Import to Claude** をクリック
4. 初回のみ:
   - local-fork project id（`/project/` の後の id）
   - local-fork base URL（デフォルト `http://localhost`）
   を聞かれる。`localStorage` に保存される
5. 結果が alert で出る: `Imported: N` / `Skipped: M`
6. local fork の Claude rail Comments タブにスレッドが追加され、自動
   レビューが走る

### 3. 重複防止

ブックマークレットを再度クリックしても、すでに取り込んだ thread には
特殊マーカー `[overleaf-import:<remote_thread_id>]` が含まれているので
スキップされる。新規コメントだけが取り込まれる。

### 4. 制限事項

- 現状 anchor（PDF/source 上の付着位置）は取得できない。本文中に
  anchor_text が一致する箇所が 1 つだけあれば自動 anchoring を試みる
  が、`/threads` API ではその情報が返らないため省略している
- 戻し（local → overleaf.com）は git push で本文だけ反映する。コメント
  自体を逆方向に流すには別の経路が必要

## Server Pro 機能のロック解除（自分用）

CE は Track Changes など一部機能をハードコードで OFF にしている
(`ProjectEditorHandler.trackChangesAvailable = false` 等)。自分用の
self-hosted 環境であれば AGPL 内で改造して有効化できる。

`develop/dev.env` の `OVERLEAF_UNLOCK_PRO=true` を有効にし、`web` を再起動:

```
OVERLEAF_UNLOCK_PRO=true
```

これで Review Panel rail entry と Track Changes UI が CE でも表示される。
商用 SaaS として再配布する場合は Overleaf 社のライセンスポリシー要確認。

## upstream 追従

```bash
git fetch upstream
git checkout main
git merge upstream/main   # または rebase
```

自分の改造は `feature/*` や `custom/*` ブランチで管理し、`main` は upstream 追従用に保つ。
