# GPTs 設定ガイドのスクリーンショット

このフォルダに PNG を置き、`src/GptSetupGuide.tsx` の各 `<Screenshot>` に `src` を渡すと画像が表示されます。
`title` / `caption` / `alt` は既に各ステップに記入済み。

例:
```tsx
<Screenshot
  title="① GPT を作成 → Actions を追加"
  alt="..."
  caption="..."
  src="/screenshots/step-1.png"
/>
```

推奨ファイル名: `step-1.png` 〜 `step-6.png`(ガイドの手順①〜⑥に対応)。
