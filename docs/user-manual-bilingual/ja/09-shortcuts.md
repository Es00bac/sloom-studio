# ショートカットと入力方法

> **現行ソース基準 — 0.9.16-b（2026-08-27）。** ショートカットはユーザー設定可能で、
> プラットフォームにも依存します。現在の **設定 → Keyboard Shortcuts** が正本です。
> 本章の表は馴染みのある例であり、すべての既定値がビルド間で不変であるという契約ではありません。

Sloom Studio は、キーボードショートカット、コマンドパレット、ゲームパッド入力、およびプラットフォームが
提供する場合のデスクトップ/グローバルアプリケーションメニューに対応しています。本章では、グローバル、
Flow、Video、Image、Paper ごとに便利なコマンドを整理します。

## 信頼できる入力の設定

**設定 → Keyboard Shortcuts** を開き、コマンドを検索し、実際の割り当てを確認して、バインドをクリックし
置換キーコードを入力します。競合チェッカーは既存の割り当てを示し、未解決の重複は受け付けません。ローカル
設定が分かりにくくなった場合は、コマンドまたはすべての既定値を復元します。設定は端末に保存されます。別の
インストールへ移す場合は、Settings のバックアップ/書き出し経路を使用します。

デスクトップ利用時は、グローバルアプリケーションメニューも発見可能なコマンド面です。File、Edit、View、
Workspace、Window、Help の操作と、そのランタイムで有効な割り当てを表示します。ブラウザや OS の予約により
Sloom Studio が受け取る前にキーコードが横取りされる場合があるため、重要なショートカットは本章の例ではなく
Settings で確認してください。

### キーボードと支援技術による操作

UI はメニュー、ダイアログ、永続 Flow ノードにキーボードフォーカスを提供します。`Tab` / `Shift+Tab` で
フォーカスを移動し、`Enter` または `Space` で操作を有効化し、`Esc` でダイアログを離れるか対象操作を
キャンセルします。ノードはアクセシブル名とキーボードフォーカス処理を保持します。ツールバーやメニューに
到達しにくい場合はコマンドパレットが便利です。アクセシブル Paper 出力は別の作成作業です。タグ付き PDF の
前に文書言語と作成者による代替テキストを設定してください。

## 修飾キーの表記

- `Ctrl` は Windows と Linux で使用されます。
- `Cmd` は macOS で使用され、他のプラットフォームの `Ctrl` と同等です。
- `Alt` は Windows と Linux で使用されます。
- `Option` は macOS で使用され、他のプラットフォームの `Alt` と同等です。

本章では、ショートカットを `Ctrl/Cmd+X` のように表記します。これは、Windows/Linux では `Ctrl+X`、macOS では `Cmd+X` を押すことを意味します。

## グローバルショートカット

これらのショートカットは、どのワークスペースからでも動作します。

| アクション | ショートカット |
|--------|----------|
| 新規プロジェクト | `Ctrl/Cmd+N` |
| プロジェクトを開く | `Ctrl/Cmd+O` |
| プロジェクトを保存 | `Ctrl/Cmd+S` |
| 名前を付けて保存 | `Ctrl/Cmd+Shift+S` |
| 元に戻す | `Ctrl/Cmd+Z` |
| やり直し | `Ctrl/Cmd+Y` または `Ctrl/Cmd+Shift+Z` |
| 切り取り | `Ctrl/Cmd+X` |
| コピー | `Ctrl/Cmd+C` |
| 貼り付け | `Ctrl/Cmd+V` |
| 元の位置に貼り付け | `Ctrl/Cmd+Shift+V` |
| すべて選択 | `Ctrl/Cmd+A` |
| 選択解除 | `Ctrl/Cmd+D` または `Esc` |
| 削除 | `Delete` または `Backspace` |
| 設定 | `Ctrl/Cmd+,` |
| コマンドパレット | `Ctrl/Cmd+Shift+P` |
| 全画面表示の切り替え | `F11` または `Ctrl/Cmd+Shift+F` |
| Source Bin の切り替え | `Ctrl/Cmd+B` |
| Inspector の切り替え | `Ctrl/Cmd+I` |
| Activity Trail の切り替え | `Ctrl/Cmd+Shift+A` |
| 次のワークスペース | `Ctrl/Cmd+Tab` |
| 前のワークスペース | `Ctrl/Cmd+Shift+Tab` |
| ヘルプ | `F1` |
| 検索 | `Ctrl/Cmd+F` |

## コマンドパレット

コマンドパレットは `Ctrl/Cmd+Shift+P` で開きます。そこからコマンド名を入力し、`Enter` を押して実行します。パレットは以下をサポートしています。

- ファジーマッチング: コマンド名の単語の一部を入力するだけで検索できます。
- 最近使用したコマンド: 最近使用したコマンドが上部に表示されます。
- ワークスペースフィルタリング: 現在のワークスペース向けのコマンドが優先されます。

便利なパレットコマンドの例:

- `Switch to Flow`
- `Switch to Video`
- `Run Flow`
- `Clean Flow`
- `Import Media`
- `Export Project`
- `Open Settings`
- `Toggle Source Bin`
- `Toggle Bookmarks`
- `Layout Defaults`

## メニューコマンド

メニューコマンドは、Compact または Menubar スタイルのアプリメニューから利用できます。多くのメニュー項目には右側にキーボードショートカットが表示されます。メニューには以下が含まれます。

- **File** — New、Open、Save、Import、Export、Scratch Folder、Recent Projects、Exit。
- **Edit** — Undo、Redo、Cut、Copy、Paste、Delete、Select All、Preferences。
- **View** — Source Bin、Inspector、Bookmarks、Activity Trail、Command Palette、Layout Defaults、Fullscreen。
- **Workspace** — Flow、Video、Image、Paper。
- **Window** — New Window、Close Window、Minimize、Zoom（デスクトップのみ）。
- **Help** — Documentation、Keyboard Shortcuts、OSS Licenses、About。

## Flow ワークスペースのショートカット

| アクション | ショートカット |
|--------|----------|
| Flow を実行 | `Ctrl/Cmd+Enter` |
| Flow を停止 | `Esc` |
| ノードを追加 | `Tab` または `キャンバスをダブルクリック` |
| 中クリック検索 | キャンバスを `中クリック` |
| すべてのノードを選択 | `Ctrl/Cmd+A` |
| ノードをコピー | `Ctrl/Cmd+C` |
| ノードを貼り付け | `Ctrl/Cmd+V` |
| ノードを複製 | `Ctrl/Cmd+D` |
| 選択を削除 | `Delete` または `Backspace` |
| 選択をグループ化 | `Ctrl/Cmd+G` |
| グループ化を解除 | `Ctrl/Cmd+Shift+G` |
| ズームイン | `Ctrl/Cmd+=` |
| ズームアウト | `Ctrl/Cmd+-` |
| 全体表示 | `Ctrl/Cmd+0` |
| キャンバスをパン | `中クリックドラッグ` または `Space ドラッグ` |
| Clean Flow | `Ctrl/Cmd+Shift+L` |
| 選択ノードを強制実行 | `Ctrl/Cmd+R` |
| ノードブックマークの切り替え | `Ctrl/Cmd+D` |
| Source Bin の切り替え | `Ctrl/Cmd+B` |

## Video ワークスペースのショートカット

| アクション | ショートカット |
|--------|----------|
| 再生 / 一時停止 | `Space` |
| シャトル逆再生 | `J` |
| シャトル停止 | `K` |
| シャトル順再生 | `L` |
| 1 フレーム戻る | `Left Arrow` |
| 1 フレーム進む | `Right Arrow` |
| 先頭へ移動 | `Home` |
| 末尾へ移動 | `End` |
| In を設定 | `I` |
| Out を設定 | `O` |
| In をクリア | `Alt+I` |
| Out をクリア | `Alt+O` |
| 挿入 | `,`（コンマ） |
| 上書き | `.`（ピリオド） |
| 選択ツール | `V` |
| カット / カミソリツール | `C` |
| スリップツール | `Y` |
| ハンドツール | `H` |
| スナップの切り替え | `S` |
| 再生ヘッド位置で分割 | `C`（選択ツール時） |
| リップルトリム先頭 | `Q` |
| リップルトリム末尾 | `W` |
| ロール編集 | `E` |
| マーカーを追加 | `M` |
| クリップを微調整 | `矢印キー` |
| 10 フレーム微調整 | `Shift+矢印` |

## Image Editor ワークスペースのショートカット

| アクション | ショートカット |
|--------|----------|
| Move | `V` |
| Hand | `H` |
| Marquee | `M` |
| Lasso | `L` |
| Magic Wand | `W` |
| Quick Mask | `Q` |
| Brush | `B` |
| Eraser | `E` |
| Background Eraser | `Alt+E` |
| Magic Eraser | `Shift+E` |
| Clone Stamp | `S` |
| Spot Heal | `J` |
| Blur | `R` |
| Sharpen | `Shift+R` |
| Smudge | `U` |
| Dodge | `O` |
| Burn | `Shift+O` |
| Sponge Saturate | `P` |
| Sponge Desaturate | `Shift+P` |
| Paint Bucket | `G` |
| Gradient | `Shift+G` |
| Pen | `Shift+B` |
| Rectangle | `X` |
| Ellipse | `Shift+X` |
| Crop | `C` |
| Text | `T` |
| Eyedropper | `I` |
| ブラシサイズを小さく | `[` |
| ブラシサイズを大きく | `]` |
| 硬度を下げる | `{` |
| 硬度を上げる | `}` |
| 前景色で塗りつぶし | `Alt+Delete` / `Option+Delete` |
| 背景色で塗りつぶし | `Ctrl+Delete` / `Cmd+Delete` |
| 自由変形 | `Ctrl/Cmd+T` |
| 選択解除 | `Ctrl/Cmd+D` |
| 選択範囲を反転 | `Ctrl/Cmd+Shift+I` |
| 新規レイヤー | `Ctrl/Cmd+Shift+N` |
| レイヤーをグループ化 | `Ctrl/Cmd+G` |
| 下のレイヤーとマージ | `Ctrl/Cmd+E` |

## Paper ワークスペースのショートカット

| アクション | ショートカット |
|--------|----------|
| Select | `V` |
| Hand | `H` |
| Text | `T` |
| Image | `Shift+I` |
| Eyedropper | `I` |
| Gutter Knife | `K` |
| Duplicate | `Ctrl/Cmd+D` |
| Group | `Ctrl/Cmd+G` |
| Ungroup | `Ctrl/Cmd+Shift+G` |
| Lock | `Ctrl/Cmd+L` |
| Unlock | `Ctrl/Cmd+Shift+L` |
| 微調整 | `矢印キー` |
| 10 倍微調整 | `Shift+矢印` |
| 背面へ | `Ctrl/Cmd+[` |
| 前面へ | `Ctrl/Cmd+]` |
| 最背面へ | `Ctrl/Cmd+Shift+[` |
| 最前面へ | `Ctrl/Cmd+Shift+]` |
| ガイドの切り替え | `Ctrl/Cmd+;` |
| グリッドの切り替え | `Ctrl/Cmd+'` |
| ページを全体表示 | `Ctrl/Cmd+0` |
| ズームイン | `Ctrl/Cmd+=` |
| ズームアウト | `Ctrl/Cmd+-` |
| 改ページ | `Ctrl/Cmd+Return`（テキスト内） |
| プレビューモードの切り替え | `W` |

## ゲームパッドの基本

Sloom Studio は、ナビゲーション、再生、一部の編集アクションにゲームパッド入力に対応しています。デフォルトの割り当てはワークスペースによって異なります。

### グローバルゲームパッドデフォルト

| コントロール | アクション |
|---------|--------|
| 左スティック | ビューポートをパン |
| 右スティック | ズーム / スクラブ |
| A / Cross | 確定 / 選択 |
| B / Circle | キャンセル / 選択解除 |
| X / Square | コンテキストメニュー |
| Y / Triangle | コマンドパレット |
| 左ショルダー | 前のアイテム / フレーム |
| 右ショルダー | 次のアイテム / フレーム |
| 左トリガー | 速度を下げる |
| 右トリガー | 速度を上げる |
| 方向パッド | 選択を微調整 |
| Start | 再生 / 一時停止 |
| Select | Source Bin の切り替え |

ゲームパッドの割り当ては **設定 > ゲームパッド** でカスタマイズできます。すべてのアクションがゲームパッドで利用できるわけではありません。

## ショートカットのカスタマイズ

1. **設定 > Keyboard** を開きます。
2. 変更したいコマンドを検索します。
3. 現在のショートカットをクリックします。
4. 新しいキー組み合わせを押します。
5. 保存します。

ショートカットが別のコマンドと競合する場合、競合チェッカーは既存の割り当てを報告します。別のキーコードを
選ぶか、既存の割り当てを削除/再割り当てしてください。未解決の重複は有効な保存済みショートカットではありません。

## ショートカットのインポートとエクスポート

Settings のバックアップ/書き出し操作を使用して、キーボードとゲームパッドの割り当てをエクスポートおよび
インポートできます。マシン間やチームメンバー間で設定を共有する際に便利ですが、読み込んだ割り当てについて
ローカル OS とブラウザの競合を確認してください。

## アクセシビリティ

Sloom Studio は、ほとんどのタスクをキーボードのみで操作できます。メニューとダイアログは `Tab`、
`Shift+Tab`、`Enter`、`Esc` で操作でき、永続 Flow ノードはキーボードフォーカス可能な名前付きグループです。
コマンドパレットとデスクトップ/グローバルメニューは、コマンドへの補完的な経路です。

## OS とのショートカット競合

一部のショートカットは OS のデフォルトと競合する可能性があります。ショートカットが動作しない場合:

- **設定 > Keyboard** で割り当てを確認してください。
- 他のアプリケーションがそのショートカットを横取りしていないか確認してください。
- macOS では、`Cmd+Space` や `Cmd+Tab` などのショートカットが予約されていることがあります。
- Linux では、ウィンドウマネージャーが `Alt` ショートカットを横取りすることがあります。

最新のショートカットデフォルトについては、アプリ内の Keyboard 設定ページを確認してください。
