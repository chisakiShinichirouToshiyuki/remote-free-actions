/**
 * Screenshot slot for the setup guide.
 *
 * Title / caption / alt are authored now; the actual image is added later by
 * dropping a PNG into `public/screenshots/` and passing its path as `src`
 * (e.g. src="/screenshots/step-1.png"). Until then a labelled placeholder box
 * is shown. `alt` doubles as the placeholder's accessible label.
 */
export function Screenshot({
  title,
  caption,
  alt,
  src,
}: {
  title: string;
  caption: string;
  alt: string;
  src?: string;
}) {
  return (
    <figure style={{ margin: '16px 0' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {src ? (
        <img src={src} alt={alt} style={{ maxWidth: '100%', border: '1px solid #ddd', borderRadius: 8 }} />
      ) : (
        <div
          role="img"
          aria-label={alt}
          style={{
            border: '2px dashed #cbd5e1',
            borderRadius: 8,
            padding: '28px 16px',
            color: '#64748b',
            fontSize: 13,
            background: '#f8fafc',
          }}
        >
          📷 スクリーンショット未添付 — <code>public/screenshots/</code> に画像を置き <code>src</code> を設定
          <br />
          <span style={{ fontSize: 12 }}>alt: {alt}</span>
        </div>
      )}
      <figcaption style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>{caption}</figcaption>
    </figure>
  );
}
