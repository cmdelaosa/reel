/* Titled placeholder screen used while a tab's real content is pending. */
export function PagePlaceholder({ title, sub, note }: { title: string; sub: string; note: string }) {
  return (
    <div className="mq-page screen">
      <header className="mq-header">
        <h1 className="mq-h1">{title}</h1>
        <p className="dim mq-sub">{sub}</p>
      </header>
      <div className="card" style={{ padding: "28px 24px" }}>
        <p className="dim" style={{ margin: 0, fontSize: 14 }}>{note}</p>
      </div>
    </div>
  );
}
