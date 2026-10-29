p='src/lib/demoFixture.ts'
s=open(p,encoding='utf-8',newline='').read()
nl='\r\n' if '\r\n' in s else '\n'
t=s.replace('\r\n','\n')
pairs=[
("type Kind = 'pdf' | 'docx' | 'xlsx' | 'md' | 'png' | 'jpg' | 'eml';","type Kind = 'pdf' | 'docx' | 'xlsx' | 'md' | 'png' | 'jpg' | 'eml' | 'zip' | 'mp4' | 'pptx' | 'csv' | 'txt';"),
("  pdf: { typeName: 'PDF Document', minSize: 60 * 1024, maxSize: 3 * MB },\n  docx: { typeName: 'Microsoft Word Document', minSize: 30 * 1024, maxSize: 700 * 1024 },\n  xlsx: { typeName: 'Microsoft Excel Worksheet', minSize: 20 * 1024, maxSize: 900 * 1024 },\n  md: { typeName: 'Markdown File', minSize: 2 * 1024, maxSize: 40 * 1024 },",
 "  pdf: { typeName: 'PDF Document', minSize: 40 * 1024, maxSize: 6 * MB },\n  docx: { typeName: 'Microsoft Word Document', minSize: 12 * 1024, maxSize: 700 * 1024 },\n  xlsx: { typeName: 'Microsoft Excel Worksheet', minSize: 8 * 1024, maxSize: 2 * MB },\n  md: { typeName: 'Markdown File', minSize: 1024, maxSize: 40 * 1024 },"),
("  eml: { typeName: 'Outlook Item', minSize: 5 * 1024, maxSize: 80 * 1024 },\n};",
 "  eml: { typeName: 'Outlook Item', minSize: 3 * 1024, maxSize: 80 * 1024 },\n  zip: { typeName: 'Compressed (zipped) Folder', minSize: 4 * MB, maxSize: 300 * MB },\n  mp4: { typeName: 'MP4 Video', minSize: 60 * MB, maxSize: 900 * MB },\n  pptx: { typeName: 'Microsoft PowerPoint Presentation', minSize: 1 * MB, maxSize: 40 * MB },\n  csv: { typeName: 'Microsoft Excel Comma Separated Values File', minSize: 4 * 1024, maxSize: 4 * MB },\n  txt: { typeName: 'Text Document', minSize: 400, maxSize: 30 * 1024 },\n};"),
("  add('Archive\\2022', 'year-end-report.pdf', 'pdf', 48 * MB);",
 """  for (const quarter of ['q1', 'q2', 'q3', 'q4']) add('Finance\\Exports', `invoices-export-${quarter}-2024.csv`, 'csv');
  for (const client of CLIENTS) add('Finance\\Exports', `invoices-${client.toLowerCase()}-all-time.csv`, 'csv');
  for (const name of ['pricing', 'kickoff-template', 'quarterly-review', 'pitch', 'training']) add('Presentations', `${name}-invoice-process.pptx`, 'pptx');
  for (const name of ['todo', 'phone-numbers', 'invoice-reminders', 'ideas', 'passwords-hint', 'shopping', 'travel']) add('Notes', `${name}.txt`, 'txt');
  for (const quarter of ['2023-q1', '2023-q2', '2023-q3', '2023-q4', '2024-q1']) add('Backups', `invoice-archive-${quarter}.zip`, 'zip');
  for (const month of ['03', '06', '09']) add('Recordings\\Walkthroughs', `billing-walkthrough-2024-${month}.mp4`, 'mp4');
  add('Recordings\\Walkthroughs', 'invoice-system-demo-full.mp4', 'mp4', 1.4 * 1024 * MB);
  add('Archive\\2022', 'year-end-report.pdf', 'pdf', 48 * MB);"""),
]
for a,b in pairs:
    assert a in t,a[:60]
    t=t.replace(a,b,1)
open(p,'w',encoding='utf-8',newline='').write(t.replace('\n',nl))
p='src/lib/demoFixture.test.ts'
s=open(p,encoding='utf-8',newline='').read()
s=s.replace("toBeLessThanOrEqual(450)","toBeLessThanOrEqual(500)")
s=s.replace("""    expect(rows.filter((row) => row.size < 100 * 1024).length).toBeGreaterThan(40);
""","""    expect(rows.filter((row) => row.size < 100 * 1024).length).toBeGreaterThan(40);
  });

  it('puts files in every size band the map colors, so the map shows the whole range', () => {
    const rows = demoRows(NOW);
    const bands = [16 * 1024, 256 * 1024, 4 * 1024 * 1024, 64 * 1024 * 1024, 1024 * 1024 * 1024];
    const bandOf = (size: number) => bands.filter((limit) => size >= limit).length;
    const seen = new Set(rows.map((row) => bandOf(row.size)));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
""",1)
open(p,'w',encoding='utf-8',newline='').write(s)
